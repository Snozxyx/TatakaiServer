import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './core.mjs';
import { createNetwork, publicUrl } from './security.mjs';
import { nodeStorage } from './node-storage.mjs';
import { createRequire } from 'node:module';
import { vault } from './security.mjs';
import { createNativeCatalog } from './native-host.mjs';
import { nodeNetwork } from './node-network.mjs';
import { nodeInterpreter } from './node-extension.mjs';
import { resolveNodeSecrets } from './node-secrets.mjs';
import { startupBanner } from './startup-banner.mjs';
import { createFileLookupCache } from './file-lookup-cache.mjs';

export async function serveNodeRequest(handler, req, res, base) {
  const abort = new AbortController();
  req.on('aborted', () => abort.abort()); res.on('close', () => { if (!res.writableEnded) abort.abort(); });
  try {
    let cancelled = false;
    const body = !['GET', 'HEAD'].includes(req.method) ? new ReadableStream({
      start(controller) {
        req.on('data', chunk => { if (!cancelled) { controller.enqueue(chunk); if (controller.desiredSize <= 0) req.pause(); } });
        req.on('end', () => { if (!cancelled) controller.close(); });
        req.on('error', error => { if (!cancelled) controller.error(error); });
      }, pull() { req.resume(); }, cancel() { cancelled = true; req.resume(); },
    }) : undefined;
    const request = new Request(new URL(req.url, base), { method: req.method, headers: req.headers,
      ...(body ? { body, duplex: 'half' } : {}), signal: abort.signal });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res); else res.end();
  } catch {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ success: false, error: { code: 'transport_error', message: 'The server could not complete this request. Retry and check server configuration if it continues.' } }));
  }
}
export async function startNode(options = {}) {
  const root = options.root || process.env.DATA_DIR || './data';
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  if (process.env.REQUIRE_PERSISTENT_STORAGE === '1' && !databaseUrl) throw Error('Set DATABASE_URL to your Postgres database. This deployment has no persistent disk; temporary local files cannot preserve your server configuration.');
  if (databaseUrl && (!(options.secret || process.env.SERVER_SECRET) || !(options.bootstrapSecret || process.env.BOOTSTRAP_SECRET))) throw Error('Postgres deployments require persistent SERVER_SECRET and BOOTSTRAP_SECRET environment variables.');
  const storage = databaseUrl ? await (await import('./postgres-storage.mjs')).nodePostgresStorage(databaseUrl) : await nodeStorage(root);
  const secrets = await resolveNodeSecrets(root, { secret: options.secret || process.env.SERVER_SECRET,
    bootstrapSecret: options.bootstrapSecret || process.env.BOOTSTRAP_SECRET, hasState: !!await storage.store.read() });
  const { interpreter } = await import('../dist/interpreter.mjs');
  const publicNetwork = nodeNetwork();
  const secret = secrets.secret, encryption = await vault(secret);
  const persistentLookupCache = await createFileLookupCache({ root: path.join(root, 'response-cache'), vault: encryption });
  let broker;
  const network = async (url, init) => {
    if (url.startsWith('tatakai-native:')) {
      const entry = await encryption.open(url.slice(15));
      if (!broker || new URL(entry.url).origin !== broker.host.base) throw Error('Internal native resource is unavailable');
      const response = await fetch(entry.url, { ...init, headers: { ...entry.headers, ...init.headers }, redirect: 'error' });
      return { response, url: entry.url, headers: init.headers, resourceUrl: async target => new URL(target).origin === new URL(entry.url).origin ? 'tatakai-native:' + await encryption.seal({ url: target, headers: entry.headers }) : target };
    }
    return publicNetwork(url, init);
  };
  const hosts = { ...(options.hosts || {}) };
  if (process.env.ENABLE_NATIVE_EXTENSIONS === '1') {
    const require = createRequire(import.meta.url), { CompatibilityBroker } = require('../dist/compatibility/broker.cjs');
    let browser;
    if (process.env.ENABLE_BROWSER_RUNTIME === '1') {
      const { chromium } = await import('playwright'); const { PlaywrightBrowser } = await import('./playwright-browser.mjs'); browser = new PlaywrightBrowser(chromium);
    }
    broker = new CompatibilityBroker({ root: path.resolve(root, 'compatibility/mihon'), browser, proxy: async (url, headers) => {
      if (new URL(url).origin === broker.host.base) return 'tatakai-native:' + await encryption.seal({ url, headers });
      return url;
    } });
    hosts.catalog = createNativeCatalog({ broker });
    for (const family of ['mihon', 'cloudstream', 'aniyomi']) hosts[family] = true;
  }
  const ui = fileURLToPath(new URL('../dist/ui/', import.meta.url));
  const handler = await createServer({ ...storage, platform: 'node', interpreter, nodeInterpreter, network,
    persistentLookupCache,
    mediaProxyUrl: options.mediaProxyUrl || process.env.MEDIA_PROXY_URL,
    mediaProxyPassword: options.mediaProxyPassword || process.env.MEDIA_PROXY_PASSWORD,
    originRelayHosts: options.originRelayHosts || process.env.ORIGIN_RELAY_HOSTS,
    secret, bootstrapSecret: secrets.bootstrapSecret,
    hosts, staticResponse: async request => {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const relative = pathname.startsWith('/assets/') ? pathname.slice(1) : 'index.html';
      const filename = path.resolve(ui, relative);
      if (!filename.startsWith(ui)) return new Response('Not found', { status: 404 });
      try { const body = await readFile(filename); const type = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html'; return new Response(body, { headers: { 'content-type': type, 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" } }); }
      catch { return new Response('Dashboard unavailable. Run npm run build.', { status: 503 }); }
    } });
  const port = Number(options.port ?? process.env.PORT ?? 8787), bind = options.bind || process.env.HOST || '127.0.0.1';
  let origin = options.publicUrl || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
  const server = http.createServer((req, res) => serveNodeRequest(handler, req, res, origin));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, bind, resolve); });
  if (!options.publicUrl && !process.env.PUBLIC_URL && !process.env.RENDER_EXTERNAL_URL && port === 0) origin = `http://localhost:${server.address().port}`;
  const listenHost = bind.includes(':') ? `[${bind}]` : bind;
  return { server, handler, origin: new URL(origin).origin, listenUrl: `http://${listenHost}:${server.address().port}`, close: async () => { broker?.stop(); await new Promise(resolve => server.close(resolve)); await storage.close(); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile?.(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  startNode().then(runtime => {
    console.log(startupBanner(runtime.origin, runtime.listenUrl));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.close().then(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
