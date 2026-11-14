import { vault, digest, equal, passwordHash, verifyPassword, random, fail, createNetwork, limitedText, HttpError, stripCredentials, publicUrl } from './security.mjs';
import { createExtensions, sourceDescriptor, families, capability } from './extensions.mjs';
import { createProxy } from './proxy.mjs';
import { createMediaCache } from './cache.mjs';
import { createLookupCache } from './lookup-cache.mjs';
import { appendServerLog, logRoute } from './logs.mjs';

export const API = '/api/server/v1';
const nativeOrigins = ['app://tatakai.me', 'capacitor://localhost', 'http://localhost', 'https://localhost'];
export const defaults = { name: 'Tatakai Server', languages: [], timeoutMs: 25000, concurrency: 4,
  cacheSeconds: 300, mediaCacheMb: 32, mediaCacheSeconds: 300, proxyEnabled: true, allowedOrigins: ['https://tatakai.me', 'https://www.tatakai.me', 'https://tatakai.app', 'https://www.tatakai.app', ...nativeOrigins] };
const redactExtension = row => ({ id: row.id, manifestId: row.manifest.id, ecosystem: row.ecosystem, name: row.manifest.name, version: row.manifest.version,
  enabled: row.enabled, priority: row.priority, languages: row.languages, kind: row.kind, updatedAt: row.updatedAt,
  hasPreferences: !!row.preferences, runtime: row.runtime || 'interpreter', autoResolve: row.autoResolve !== false });
function settings(input, current = defaults) {
  const out = { ...current };
  if (input.name !== undefined) { if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) fail(400, 'invalid_name'); out.name = input.name.trim(); }
  if (input.logoUrl !== undefined) {
    if (typeof input.logoUrl !== 'string' || input.logoUrl.length > 2048) fail(400, 'invalid_logo');
    if (input.logoUrl) { try { const url = new URL(input.logoUrl); if (url.protocol !== 'https:' || url.username || url.password) fail(400, 'invalid_logo'); } catch { fail(400, 'invalid_logo'); } }
    out.logoUrl = input.logoUrl;
  }
  for (const [key, min, max] of [['timeoutMs', 1000, 25000], ['concurrency', 1, 8], ['cacheSeconds', 0, 3600], ['mediaCacheMb', 0, 64], ['mediaCacheSeconds', 30, 3600]]) {
    if (input[key] !== undefined) { if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) fail(400, 'invalid_setting', `${key} must be between ${min} and ${max}`); out[key] = input[key]; }
  }
  if (input.proxyEnabled !== undefined) { if (typeof input.proxyEnabled !== 'boolean') fail(400, 'invalid_setting'); out.proxyEnabled = input.proxyEnabled; }
  for (const key of ['languages', 'allowedOrigins']) if (input[key] !== undefined) {
    if (!Array.isArray(input[key]) || input[key].length > 50 || input[key].some(v => typeof v !== 'string' || v.length > 300)) fail(400, 'invalid_setting');
    if (key === 'allowedOrigins' && input[key].some(v => { if (nativeOrigins.includes(v)) return false; try { return new URL(v).origin !== v || !/^https?:/.test(v); } catch { return true; } })) fail(400, 'invalid_origin');
    out[key] = [...new Set(input[key])];
  }
  return out;
}
export async function createServer({ store, artifacts, secret, bootstrapSecret, platform = 'node', network = createNetwork(), interpreter, nodeInterpreter, hosts = {}, staticResponse, legacyVerify, mediaProxyUrl, mediaProxyPassword, persistentLookupCache, originRelayHosts }) {
  const startedAt = Date.now(), startedClock = performance.now();
  const encryption = await vault(secret);
  const extensions = createExtensions({ network, artifacts, interpreter, nodeInterpreter, platform, hosts, vault: encryption });
  const lookups = createLookupCache({ persistence: persistentLookupCache });
  const mediaCache = createMediaCache({ store, artifacts, vault: encryption });
  const proxy = createProxy({ vault: encryption, network, platform, cache: mediaCache, mediaProxyUrl, mediaProxyPassword, originRelayHosts });
  const sourceRows = async state => [...state.extensions, ...(hosts.catalog ? await hosts.catalog.list() : [])];
  const checkPassword = (value, stored) => stored?.legacyHash && legacyVerify ? (typeof value === 'string' && value.length <= 1024 ? legacyVerify(value, stored) : false) : verifyPassword(value, stored);
  async function edit(fn) { return store.mutate(async state => { if (!state) fail(409, 'setup_required'); return { state, value: await fn(state) }; }); }
  async function body(request) {
    try { return JSON.parse(await limitedText(request, ['node', 'desktop'].includes(platform) ? 14 * 1024 * 1024 : 4 * 1024 * 1024)); }
    catch (error) { if (error.status) throw error; fail(400, 'invalid_json'); }
  }
  async function authorize(request, state, admin = false) {
    const value = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!value && !admin && state && !state.viewer) return { role: 'viewer', id: `public:${state.publicEpoch || state.id}` };
    const id = value && await digest(value), session = id && state?.sessions[id];
    if (!session || session.expires < Date.now()) fail(401, 'authentication_required');
    if (admin && session.role !== 'admin') fail(403, 'admin_required');
    return { ...session, id };
  }
  async function token(role, label) {
    const value = random() + random(), id = await digest(value);
    await edit(state => {
      for (const [key, session] of Object.entries(state.sessions)) if (session.expires < Date.now()) delete state.sessions[key];
      if (Object.keys(state.sessions).length >= 200) fail(409, 'device_limit');
      state.sessions[id] = { role, label: String(label || 'Device').slice(0, 100), createdAt: Date.now(), expires: Date.now() + (role === 'admin' ? 12 * 3600000 : 90 * 86400000) };
    });
    return { token: value, role, deviceId: id };
  }
  async function proxify(value, base, session, state, inherited) {
    if (Array.isArray(value)) return Promise.all(value.map(item => proxify(item, base, session, state, inherited)));
    if (!value || typeof value !== 'object') return value;
    const out = { ...value };
    const parent = value.url ? { url: value.url, headers: value.headers || inherited?.headers || {} } : inherited;
    for (const key of ['url', 'imageUrl', 'image', 'poster', 'thumbnail', 'icon']) {
      if (typeof out[key] === 'string' && /^(https?:\/\/|tatakai-native:)/i.test(out[key])) {
        if (key === 'url' && (out.sourceType === 'custom' || out.sourceType === 'embed' || out.isEmbed)) { publicUrl(out[key]); continue; }
        if (!state.settings.proxyEnabled) fail(409, 'proxy_disabled', 'Enable the proxy to access source media');
        let headers = out.headers || inherited?.headers || {};
        if (!out.headers && inherited?.url && /^https?:/.test(inherited.url) && /^https?:/.test(out[key]) && new URL(inherited.url).origin !== new URL(out[key]).origin) headers = stripCredentials(headers);
        out[key] = await proxy.mint({ url: out[key], headers, ...(key !== 'url' ? { resourceType: 'image' } : {}) }, base, session.id);
      }
    }
    delete out.headers; delete out.originalUrl; delete out.behaviorHints;
    for (const key of ['subtitles', 'pages', 'sources', 'streams', 'metas', 'videos', 'results', 'items', 'sections']) if (out[key]) out[key] = await proxify(out[key], base, session, state, parent);
    return out;
  }
  async function invokeRaw(row, op, args, signal, onProgress) {
    if (row.external) return hosts.catalog.invoke(row, op, args, signal);
    // Catalog-based requests must use an exact title match, never the first result.
    if (['stremio', 'seanime', 'sora', 'mangayomi'].includes(row.ecosystem) && op === 'resolve' && !args.id && args.title) {
      const results = await extensions.invoke(row, 'search', { query: args.title, type: args.type }, signal);
      const normalize = value => String(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const matches = results.filter(item => normalize(item.name || item.title) === normalize(args.title));
      if (matches.length !== 1) fail(422, 'title_match_required', 'Browse this server’s catalog to select the exact title');
      const match = matches[0];
      if (row.ecosystem === 'seanime') return extensions.invoke(row, op, { ...args, id: match.id, titleId: match.id }, signal);
      const info = await extensions.invoke(row, 'info', { id: match.id, type: match.type || args.type }, signal);
      const episode = (info?.videos || info?.entries || [])?.find(item => Number(item.episode ?? item.number) === Number(args.episode || 1) && Number(item.season || 1) === Number(args.season || 1));
      args = { ...args, id: episode?.id || (match.type === 'movie' ? match.id : undefined), url: episode?.id, titleId: match.id, episodeId: episode?.id, type: match.type || args.type };
    }
    return extensions.invoke(row, op, args, signal, onProgress);
  }
  async function invoke(row, op, args, signal, state, progressive = false, onProgress) {
    const seconds = state?.settings.cacheSeconds || 0;
    if (!seconds || args.forceRefresh === true || !['browse', 'search', 'info', 'episodes', 'chapters', 'pages', 'novelChapters', 'novelContent', 'resolve'].includes(op)) return invokeRaw(row, op, args, signal, onProgress);
    const key = await digest(JSON.stringify([row.id, row.updatedAt, row.preferences, op, args]));
    const cached = state.cache?.[key];
    if (cached?.expires > Date.now()) { const value = await encryption.open(cached.value); return progressive ? {chapters:value,partial:false} : value; }
    // Keep large chapter lists in a bounded memory cache instead of bloating
    // the SQLite state (which is also rewritten for logs and authentication).
    return lookups.get(key, async publish => {
      const result = await invokeRaw(row, op, args, AbortSignal.timeout(state.settings.timeoutMs), publish);
      const serialized = JSON.stringify(result);
      if (!persistentLookupCache && op !== 'resolve' && serialized && serialized.length <= 16 * 1024) {
        const encrypted = await encryption.seal(result);
        await edit(current => {
          current.cache ||= {};
          for (const [id, item] of Object.entries(current.cache)) if (item.expires < Date.now()) delete current.cache[id];
          if (Object.keys(current.cache).length >= 16) delete current.cache[Object.keys(current.cache)[0]];
          const empty = Array.isArray(result) ? !result.length : Array.isArray(result?.chapters) && !result.chapters.length;
          current.cache[key] = { value: encrypted, expires: Date.now() + Math.min(seconds * 1000, empty ? 30000 : seconds * 1000) };
        });
      }
      return result;
    }, ['resolve', 'pages'].includes(op) ? Math.min(seconds * 1000, 120000) : seconds * 1000, signal, progressive, onProgress);
  }
  async function dispatch(request, state, url) {
    const path = url.pathname.slice(API.length), method = request.method;
    const base = url.origin;
    if (path === '/health' && method === 'GET') return { protocolVersion: 1, serverId: state?.id || null, name: state?.settings.name || defaults.name, platform,
      logoUrl: state?.settings.logoUrl || null,
      ...(['node', 'desktop'].includes(platform) ? { startedAt: new Date(startedAt).toISOString(), uptimeSeconds: Math.floor((performance.now() - startedClock) / 1000) } : {}),
      setupRequired: !state, accessPasswordRequired: !!state?.viewer, adminPasswordRequired: !!state?.admin, capabilities: families.map(ecosystem => ({ ecosystem, ...capability(ecosystem, platform, hosts) })),
      proxy: { hls: true, range: true, maxResponseBytes: platform === 'vercel' ? 4000000 : null }, desktop: platform === 'desktop' };
    if (path === '/setup' && method === 'POST') {
      if (state) fail(409, 'already_configured');
      if (!bootstrapSecret || !await equal(request.headers.get('x-tatakai-bootstrap') || '', bootstrapSecret)) fail(403, 'bootstrap_required');
      const input = await body(request);
      const admin = input.adminPassword ? await passwordHash(input.adminPassword) : null, viewer = input.viewerPassword ? await passwordHash(input.viewerPassword) : null;
      await store.mutate(current => { if (current) fail(409, 'already_configured'); return { state: { schema: 1, id: random(), settings: settings(input), admin, viewer, sessions: {}, extensions: [], repositories: [], attempts: {}, pairs: {}, audit: [] } }; });
      return token('admin', 'Owner dashboard');
    }
    if (path === '/auth/login' && method === 'POST') {
      if (!state) fail(409, 'setup_required');
      const input = await body(request), role = input.role === 'admin' ? 'admin' : 'viewer';
      // Shared durable budget prevents cold-start bypass. Global limit deliberately
      // avoids trusting spoofable forwarded-IP headers on self-hosted deployments.
      await edit(current => {
        const now = Date.now(), attempt = current.attempts[role];
        if (attempt && attempt.until > now && attempt.count >= 10) fail(429, 'login_throttled');
        current.attempts[role] = { count: attempt?.until > now ? attempt.count + 1 : 1, until: attempt?.until > now ? attempt.until : now + 60000 };
      });
      if (!state[role]) {
        if (role === 'admin' && (!bootstrapSecret || !await equal(request.headers.get('x-tatakai-bootstrap') || '', bootstrapSecret))) fail(403, 'owner_key_required', 'Use the deployment setup key for owner access');
      } else if (state[role]?.legacyHash && legacyVerify) {
        if (!await legacyVerify(input.password, state[role])) fail(401, 'invalid_password');
        if (input.password.length >= 10) { const hashed = await passwordHash(input.password); await edit(current => { current[role] = hashed; }); }
      } else if (!await verifyPassword(input.password, state[role])) fail(401, 'invalid_password');
      return token(role, input.label);
    }
    if (path === '/auth/pair' && method === 'POST') {
      const input = await body(request), key = await digest(String(input.code || ''));
      await edit(current => { if (!current.pairs[key] || current.pairs[key] < Date.now()) fail(401, 'pairing_expired'); delete current.pairs[key]; });
      return token('viewer', input.label);
    }
    if (path.startsWith('/media/') && ['GET', 'HEAD'].includes(method)) {
      if (!state) fail(409, 'setup_required');
      return proxy.serve(request, path.slice(7), base, state);
    }
    const owner = /^\/(extensions|repositories|settings|devices|diagnostics|logs|export|import|native|cache|auth\/password|auth\/pairing)/.test(path);
    const session = await authorize(request, state, owner);
    if (path === '/logs' && method === 'GET') {
      const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
      return { entries: (state.logs || []).filter(entry => entry.id > after), cursor: state.logSequence || 0 };
    }
    if (path === '/cache' && method === 'GET') return { lookupEntries: Object.values(state.cache || {}).filter(item => item.expires > Date.now()).length,
      mediaEntries: Object.values(state.mediaCache || {}).filter(item => item.expires > Date.now()).length,
      mediaBytes: Object.values(state.mediaCache || {}).filter(item => item.expires > Date.now()).reduce((sum, item) => sum + item.bytes, 0),
      maxMediaBytes: (state.settings.mediaCacheMb || 0) * 1024 * 1024, responseCache: persistentLookupCache?.stats() || null };
    if (path === '/cache' && method === 'DELETE') { await lookups.clear(); await mediaCache.clear(); return { success: true }; }
    if (path === '/native' && method === 'POST') {
      if (!hosts.catalog?.manage) fail(422, 'unsupported_runtime', 'Native extension management requires the optional Node runtime or desktop');
      return hosts.catalog.manage(await body(request), request.signal);
    }
    if (path === '/media/refresh' && method === 'POST') {
      const input = await body(request), entry = await encryption.open(String(input.ticket || ''));
      if (entry.sessionId !== session.id) fail(403, 'media_owner_mismatch');
      return { url: await proxy.mint({ url: entry.url, headers: entry.headers }, base, session.id) };
    }
    if (path === '/auth/logout' && method === 'POST') { await edit(current => { delete current.sessions[session.id]; }); return { success: true }; }
    if (path === '/auth/pairing' && method === 'POST') {
      const code = random() + random(), key = await digest(code);
      await edit(current => { for (const [id, expires] of Object.entries(current.pairs)) if (expires < Date.now()) delete current.pairs[id]; if (Object.keys(current.pairs).length >= 50) fail(409, 'pairing_limit'); current.pairs[key] = Date.now() + 300000; });
      return { code, expiresIn: 300, url: `https://tatakai.me/connect-server?server=${encodeURIComponent(base)}&code=${encodeURIComponent(code)}` };
    }
    if (path === '/auth/password' && method === 'POST') {
      const input = await body(request);
      if (state.admin && !await checkPassword(input.currentPassword, state.admin)) fail(401, 'invalid_password');
      const role = input.role === 'viewer' ? 'viewer' : 'admin', hashed = input.password ? await passwordHash(input.password) : null;
      await edit(current => { current[role] = hashed; for (const [key, device] of Object.entries(current.sessions)) if (device.role === role && key !== session.id) delete current.sessions[key]; if (role === 'viewer') { current.pairs = {}; current.publicEpoch = random(); } });
      return { success: true };
    }
    if (path === '/settings') {
      if (method === 'GET') return state.settings;
      if (method === 'PATCH') { const input = await body(request); return edit(current => { current.cache = {}; return current.settings = settings(input, current.settings); }); }
    }
    if (path === '/devices' && method === 'GET') return Object.entries(state.sessions).map(([id, device]) => ({ id, ...device, current: id === session.id }));
    if (path.startsWith('/devices/') && method === 'DELETE') { await edit(current => { delete current.sessions[path.slice(9)]; }); return { success: true }; }
    if (path === '/extensions' && method === 'GET') return state.extensions.map(redactExtension);
    if (path === '/extensions' && method === 'POST') {
      const input = await body(request), prepared = await extensions.prepare(input, request.signal);
      try { await edit(current => { if (current.extensions.length >= 512) fail(409, 'extension_limit'); current.extensions.push(prepared); }); }
      catch (error) { if (prepared.artifact) await artifacts.remove(prepared.artifact); throw error; }
      return redactExtension(prepared);
    }
    const extensionPath = /^\/extensions\/([^/]+)(?:\/(update|preferences))?$/.exec(path);
    if (extensionPath) {
      const row = state.extensions.find(item => item.id === extensionPath[1]); if (!row) fail(404, 'extension_not_found');
      if (extensionPath[2] === 'preferences' && method === 'GET') return encryption.open(row.preferences);
      if (extensionPath[2] === 'update' && method === 'POST') {
        const input = await body(request);
        const prepared = await extensions.prepare({ ...input, runtime: input.runtime || row.runtime, id: row.id, url: input.url || (row.origin && await encryption.open(row.origin)), ecosystem: row.ecosystem, preferences: await encryption.open(row.preferences) }, request.signal);
        try { await edit(current => { const index = current.extensions.findIndex(item => item.id === row.id); if (index < 0 || current.extensions[index].updatedAt !== row.updatedAt) fail(409, 'configuration_conflict'); current.extensions[index] = { ...prepared, enabled: row.enabled, priority: row.priority, languages: row.languages, kind: row.kind, autoResolve: row.autoResolve !== false }; }); }
        catch (error) { if (prepared.artifact) await artifacts.remove(prepared.artifact); throw error; }
        return redactExtension(prepared);
      }
      if (method === 'DELETE') { await edit(current => { current.extensions = current.extensions.filter(item => item.id !== row.id); }); return { success: true }; }
      if (method === 'PATCH') {
        const input = await body(request);
        if (input.enabled !== undefined && typeof input.enabled !== 'boolean') fail(400, 'invalid_setting');
        if (input.autoResolve !== undefined && typeof input.autoResolve !== 'boolean') fail(400, 'invalid_setting');
        if (input.priority !== undefined && (!Number.isInteger(input.priority) || Math.abs(input.priority) > 1000)) fail(400, 'invalid_priority');
        if (input.languages !== undefined && (!Array.isArray(input.languages) || input.languages.some(v => typeof v !== 'string'))) fail(400, 'invalid_languages');
        if (input.preferences !== undefined && JSON.stringify(input.preferences).length > 8192) fail(413, 'preferences_too_large');
        const preferences = input.preferences === undefined ? undefined : await encryption.seal(input.preferences);
        return edit(current => { const item = current.extensions.find(v => v.id === row.id); if (!item) fail(404, 'extension_not_found'); for (const key of ['enabled', 'autoResolve', 'priority', 'languages']) if (input[key] !== undefined) item[key] = input[key]; if (preferences) item.preferences = preferences; return redactExtension(item); });
      }
    }
    if (path === '/repositories') {
      if (method === 'GET') return state.repositories;
      if (method === 'POST') {
        const input = await body(request); const { publicUrl } = await import('./security.mjs'); const origin = publicUrl(input.url).href;
        return edit(current => { if (current.repositories.length >= 50) fail(409, 'repository_limit'); const row = { id: random(), name: String(input.name || new URL(origin).hostname).slice(0, 100), url: origin }; current.repositories.push(row); return row; });
      }
    }
    const repo = /^\/repositories\/([^/]+)(?:\/(catalog))?$/.exec(path);
    if (repo) {
      const row = state.repositories.find(item => item.id === repo[1]); if (!row) fail(404, 'repository_not_found');
      if (method === 'DELETE') { await edit(current => { current.repositories = current.repositories.filter(item => item.id !== row.id); }); return { success: true }; }
      if (method === 'GET') { const { response } = await network(row.url, { signal: request.signal }); if (!response.ok) fail(502, 'repository_unavailable'); return JSON.parse(await limitedText(response)); }
    }
    if (path === '/sources' && method === 'GET') return (await sourceRows(state)).filter(row => row.enabled).sort((a, b) => b.priority - a.priority).flatMap(row => {
      const descriptor = sourceDescriptor(row, state.id, platform, hosts);
      const result = [descriptor];
      if (row.kind !== 'read' && row.manifest.capabilities?.includes('manga')) result.push({ ...descriptor, id: descriptor.id + '~read', name: descriptor.name + ' · Manga', kind: 'read' });
      if (row.manifest.capabilities?.includes('novel')) result.push({ ...descriptor, id: descriptor.id + '~novel', name: descriptor.name + ' · Novels', kind: 'novel' });
      return result;
    });
    if (path === '/invoke' && method === 'POST') {
      const input = await body(request), extensionId = String(input.sourceId || '').replace(`${state.id}/`, '').replace(/~(?:read|novel)$/, '');
      if (!['browse', 'search', 'info', 'episodes', 'resolve', 'chapters', 'pages', 'novelChapters', 'novelContent'].includes(input.op)) fail(403, 'data_operation_required');
      const row = (await sourceRows(state)).find(item => item.id === extensionId); if (!row) fail(404, 'source_not_found');
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(state.settings.timeoutMs)]);
      let result = await invoke(row, input.op, input.args || {}, signal, state, input.progressive === true && ['chapters','novelChapters'].includes(input.op));
      if (input.op === 'pages' && Array.isArray(result)) result = result.map(page => typeof page === 'string' ? { imageUrl: page } : page);
      return proxify(result, base, session, state);
    }
    if (path === '/resolve' && method === 'POST') {
      const input = await body(request), rows = (await sourceRows(state)).filter(row => row.enabled && row.autoResolve !== false && row.kind !== 'read'
        && (row.ecosystem !== 'stremio' || (row.manifest.resources || []).some(resource => (typeof resource === 'string' ? resource : resource.name) === 'stream'))
        && (!state.settings.languages.length || !row.languages.length || row.languages.some(lang => state.settings.languages.includes(lang)))).sort((a, b) => b.priority - a.priority);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(state.settings.timeoutMs)]);
      const run = async publish => {
        const sources = [], statuses = rows.map(row => ({ provider: `${state.id}/${row.id}`, name: row.manifest.name, ecosystem: row.ecosystem, kind: 'anime', status: 'loading', count: 0, durationMs: 0 })); let next = 0;
        const orderedSources = () => [...sources].sort((a, b) => (Number.isFinite(a.providerPriority) ? a.providerPriority : Number.MAX_SAFE_INTEGER) - (Number.isFinite(b.providerPriority) ? b.providerPriority : Number.MAX_SAFE_INTEGER));
        const snapshot = () => publish?.({ sources: orderedSources(), subtitles: [], statuses: statuses.map(item => ({ ...item })) });
        snapshot();
        await Promise.all(Array.from({ length: Math.min(state.settings.concurrency, rows.length) }, async () => {
          while (next < rows.length && !signal.aborted) {
            const row = rows[next++], provider = `${state.id}/${row.id}`, started = Date.now();
            const status = statuses.find(item => item.provider === provider), seen = new Set();
            let publication = Promise.resolve(), publicationError;
            const append = items => {
              publication = publication.then(async () => {
                const fresh = items.filter(source => {
                  const key = JSON.stringify([source.url, source.source || source.providerName || row.manifest.name, source.quality || 'auto', source.language || source.audioLanguage || '', source.fileIndex]);
                  if (seen.has(key) || seen.size >= 500 || sources.length >= 2000) return false;
                  seen.add(key); return true;
                }).slice(0, Math.max(0, 2000 - sources.length));
                const proxied = await proxify(fresh, base, session, state);
                sources.push(...proxied.map(source => ({ ...source, sourceName: source.sourceName || source.providerName || source.server || source.source || source.providerKey || row.manifest.name,
                  providerKey: provider, extensionId: provider, extensionName: row.manifest.name, extensionServerName: state.settings.name,
                  providerName: `${row.manifest.name} · ${state.settings.name}`, ecosystem: row.ecosystem })));
                status.count = seen.size; status.durationMs = Date.now() - started; snapshot();
              }).catch(error => { publicationError = error; });
            };
            try {
              const result = await invoke(row, 'resolve', input, signal, state, false, append);
              append(Array.isArray(result) ? result : result?.sources || []); await publication;
              if (publicationError) throw publicationError;
              status.status = status.count ? 'ok' : 'empty';
            } catch (error) {
              await publication.catch(() => {});
              status.status = status.count ? 'partial' : 'error'; status.error = error.code || 'source_failed';
            }
            status.durationMs = Date.now() - started; snapshot();
            await appendServerLog(store, { event: status.error ? 'source_failed' : 'source_completed', name: row.manifest.name, route: '/resolve', count: status.count, durationMs: status.durationMs });
          }
        }));
        await edit(current => { current.audit = [...(current.audit || []), ...statuses.map(item => ({ provider: item.provider, status: item.status, count: item.count, error: item.error, at: new Date().toISOString() }))].slice(-100); }).catch(() => {});
        return { sources: orderedSources(), subtitles: [], statuses };
      };
      if (request.headers.get('accept')?.includes('application/x-ndjson')) {
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({ async start(controller) { try { await run(value => controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'))); } catch { /* Per-source errors are already serialized. */ } finally { controller.close(); } } }), { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
      }
      return run();
    }
    if (path === '/export' && method === 'GET') return { schema: 1, settings: state.settings, extensions: state.extensions.map(redactExtension), repositories: state.repositories };
    if (path === '/import' && method === 'POST') { const input = await body(request); if (input.schema !== 1) fail(400, 'unsupported_schema'); return edit(current => current.settings = settings(input.settings || {}, current.settings)); }
    if (path === '/diagnostics' && method === 'GET') return { platform, protocolVersion: 1, extensionCount: state.extensions.length, recent: state.audit || [], capabilities: families.map(ecosystem => ({ ecosystem, ...capability(ecosystem, platform, hosts) })) };
    fail(404, 'route_not_found');
  }
  return async function handle(request) {
    const url = new URL(request.url), origin = request.headers.get('origin');
    const started = Date.now(), route = logRoute(url.pathname, API);
    const logRequest = status => url.pathname.startsWith(API + '/') && !['/health', '/media'].includes(route) && !url.pathname.startsWith(API + '/logs') && request.method !== 'OPTIONS'
      ? appendServerLog(store, { event: 'request_completed', method: request.method, route, status, durationMs: Date.now() - started }) : Promise.resolve();
    let state, allowed = false;
    try {
      state = await store.read();
      allowed = !origin || origin === url.origin || (state?.settings.allowedOrigins || defaults.allowedOrigins).includes(origin);
      if (!allowed) fail(403, 'origin_denied');
      let response;
      if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else if (!url.pathname.startsWith(API + '/')) response = staticResponse ? await staticResponse(request) : new Response('Build the dashboard with npm run build', { status: 503 });
      else {
        const result = await dispatch(request, state, url);
        response = result instanceof Response ? result : Response.json({ success: true, data: result });
      }
      const headers = new Headers(response.headers);
      if (origin) { headers.set('access-control-allow-origin', origin); headers.set('vary', 'Origin'); }
      headers.set('access-control-allow-headers', 'Authorization, Content-Type, Range, X-Tatakai-Bootstrap');
      headers.set('access-control-allow-methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
      headers.set('access-control-expose-headers', 'Content-Range, Accept-Ranges, Content-Length');
      headers.set('x-content-type-options', 'nosniff'); headers.set('referrer-policy', 'no-referrer');
      if (url.pathname.startsWith(API)) headers.set('cache-control', 'private, no-store');
      await logRequest(response.status);
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      await logRequest(error.status || 500);
      const known = error instanceof HttpError || error.status;
      return Response.json({ success: false, error: { code: error.code || (request.signal.aborted ? 'cancelled' : 'server_error'), message: known ? error.message : 'Request failed; check server configuration and diagnostics' } },
        { status: error.status || (request.signal.aborted ? 499 : 500), headers: { 'cache-control': 'no-store', ...(origin && allowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) } });
    }
  };
}
