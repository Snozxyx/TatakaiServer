import { fail, limitedText, publicUrl, cleanHeaders, random } from './security.mjs';

export const families = ['tatakai', 'stremio', 'seanime', 'sora', 'mangayomi', 'mihon', 'cloudstream', 'aniyomi', 'kodi'];
export const operations = ['browse', 'search', 'info', 'episodes', 'resolve', 'chapters', 'pages', 'novelChapters', 'novelContent', 'preferences', 'setPreference'];
const nativeFamilies = new Set(['mihon', 'cloudstream', 'aniyomi']);
export function capability(ecosystem, platform, hosts = {}) {
  if (ecosystem === 'kodi') return { available: false, reason: 'No Kodi execution adapter exists' };
  if (nativeFamilies.has(ecosystem)) return { available: platform === 'node' || platform === 'desktop' ? !!hosts[ecosystem] : false,
    reason: platform === 'node' || platform === 'desktop' ? 'Requires the optional Java compatibility runtime' : 'Requires a Node or desktop host; unavailable on serverless' };
  return { available: true, reason: ecosystem === 'stremio' ? 'Hosted HTTP addons' : 'Compatible scripts; unsupported host APIs are reported per extension' };
}
function resourceUrl(row, resource, type, id, extra) {
  const root = row.origin.replace(/\/manifest\.json(?:\?.*)?$/, '').replace(/\/$/, '');
  return `${root}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${extra ? '/' + extra : ''}.json`;
}
const METHODS = {
  tatakai: { browse: 'getHome', search: 'search', info: 'getInfo', episodes: 'getEpisodes', resolve: 'single', chapters: 'getMangaChapters', pages: 'getMangaPages', novelChapters: 'getNovelChapters', novelContent: 'getNovelContent', preferences: 'getPreferences' },
  sora: { search: 'searchResults', info: 'extractDetails', episodes: 'extractEpisodes', resolve: 'extractStreamUrl', chapters: 'extractChapters', pages: 'extractImages' },
  mangayomi: { browse: 'getPopular', search: 'search', info: 'getDetail', episodes: 'getDetail', resolve: 'getVideoList', chapters: 'getDetail', pages: 'getPageList', preferences: 'getSourcePreferences' },
  seanime: { search: 'search', info: 'getInfo', episodes: 'findEpisodes', resolve: 'resolve', chapters: 'findChapters', pages: 'findChapterPages' },
};
export function sourceDescriptor(row, serverId, platform, hosts) {
  const support = capability(row.ecosystem, platform, hosts);
  return { id: `${serverId}/${row.id}`, extensionId: row.id, name: row.manifest.name, ecosystem: row.ecosystem,
    enabled: row.enabled, priority: row.priority, languages: row.languages, kind: row.kind || 'watch', autoResolve: row.autoResolve !== false, ...support };
}
export function createExtensions({ network, artifacts, interpreter, nodeInterpreter, platform, hosts = {}, vault }) {
  const json = async (url, signal) => {
    const { response } = await network(url, { signal });
    if (!response.ok) fail(502, 'upstream_error', `Extension upstream returned ${response.status}`);
    try { return JSON.parse(await limitedText(response)); } catch (error) { if (error.status) throw error; fail(502, 'invalid_extension_response'); }
  };
  return {
    async prepare(input, signal) {
      if (input.autoResolve !== undefined && typeof input.autoResolve !== 'boolean') fail(400, 'invalid_setting');
      let origin = input.url ? publicUrl(input.url.replace(/^stremio:\/\//i, 'https://')).href : '';
      let manifest = origin ? await json(origin, signal) : input.manifest;
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail(400, 'manifest_required');
      manifest = JSON.parse(JSON.stringify(manifest));
      const metadata = { ...manifest }; delete metadata.payload;
      if (JSON.stringify(metadata).length > 16384) fail(413, 'manifest_too_large');
      if (!['id', 'name', 'version'].every(key => typeof manifest[key] === 'string' && manifest[key].length > 0 && manifest[key].length <= 200) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifest.id) || manifest.id.includes('..')) fail(400, 'invalid_manifest');
      const ecosystem = input.ecosystem || (Array.isArray(manifest.resources) && Array.isArray(manifest.types) ? 'stremio' : manifest.ecosystem || 'tatakai');
      if (!families.includes(ecosystem)) fail(400, 'unknown_ecosystem');
      const support = capability(ecosystem, platform, hosts);
      if (!support.available) fail(422, 'unsupported_runtime', support.reason);
      if (nativeFamilies.has(ecosystem)) fail(422, 'native_management_required', 'Install this family through Native runtimes in Advanced settings');
      let code = input.code;
      const runtime = input.runtime === 'node' ? 'node' : 'interpreter';
      if (runtime === 'node' && ecosystem !== 'tatakai') fail(422, 'unsupported_runtime', 'The trusted Node runtime accepts Tatakai source bundles; other script families use their dedicated interpreter adapters');
      if (runtime === 'node' && (!nodeInterpreter || !['node', 'desktop'].includes(platform))) fail(422, 'unsupported_runtime', 'Trusted Node extensions require the standalone Node or desktop host');
      const runner = runtime === 'node' ? nodeInterpreter : interpreter;
      if (ecosystem === 'stremio') {
        if (!origin || !/\/manifest\.json(?:\?|$)/.test(origin)) fail(400, 'manifest_url_required');
        if (manifest.behaviorHints?.configurationRequired) fail(422, 'configuration_required', 'Configure this addon first and paste its configured manifest URL');
      } else if (!nativeFamilies.has(ecosystem)) {
        code ||= manifest.payload;
        const payloadUrl = manifest.payloadURI || manifest.bundleUrl;
        if (!code && payloadUrl) {
          const { response } = await network(new URL(payloadUrl, origin || undefined).href, { signal });
          if (!response.ok) fail(502, 'bundle_download_failed');
          code = await limitedText(response, runtime === 'node' ? 10 * 1024 * 1024 : 2 * 1024 * 1024);
        }
        if (typeof code !== 'string' || !code || code.length > (runtime === 'node' ? 10 : 2) * 1024 * 1024) fail(400, 'script_required', runtime === 'node' ? 'Provide a Node extension script up to 10 MB' : 'This script exceeds 2 MB. On Node or desktop, select the trusted Node runtime for larger bundles.');
        if (runtime !== 'node' && /\bChromeDP\b|\brequire\s*\(\s*['"](?:node:|electron|fs|child_process)/.test(code)) fail(422, 'unsupported_host_api', 'This script requires the trusted Node runtime or unavailable browser APIs');
        if (!runner) fail(422, 'interpreter_unavailable');
        await runner({ code, ecosystem, manifest, probe: true, network, signal });
      }
      const id = input.id || random();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || id.includes('..')) fail(400, 'invalid_extension_id');
      const artifact = code ? `${id}/${random()}` : null;
      if (artifact) await artifacts.put(artifact, code);
      // Configured addon URLs and provider preferences never remain plaintext in state.
      delete manifest.payload; delete manifest.payloadURI;
      if (JSON.stringify(input.preferences || {}).length > 8192) fail(413, 'preferences_too_large');
      return { id, ecosystem, runtime, manifest, origin: origin ? await vault.seal(origin) : '', artifact, enabled: true, autoResolve: input.autoResolve !== false,
        preferences: await vault.seal(input.preferences || {}), priority: 0, languages: [], kind: input.kind || (manifest.type === 'manga-provider' ? 'read' : 'watch'), updatedAt: new Date().toISOString() };
    },
    async invoke(row, op, args, signal, onProgress) {
      if (!row.enabled) fail(409, 'extension_disabled');
      const support = capability(row.ecosystem, platform, hosts);
      if (!support.available) fail(422, 'unsupported_runtime', support.reason);
      if (!operations.includes(op)) fail(400, 'invalid_operation');
      if (['novelChapters', 'novelContent'].includes(op) && (row.ecosystem !== 'tatakai' || !row.manifest.capabilities?.includes('novel'))) fail(422, 'unsupported_operation', 'This extension does not provide novel chapters or text');
      const preferences = await vault.open(row.preferences);
      if (nativeFamilies.has(row.ecosystem)) return hosts[row.ecosystem].invoke(row, op, { ...args, preferences }, signal);
      if (row.ecosystem === 'stremio') {
        row = { ...row, origin: await vault.open(row.origin) };
        const type = args.type || row.manifest.types?.[0] || 'series';
        const catalogs = row.manifest.catalogs || [];
        if (op === 'browse' || op === 'search') {
          const selected = catalogs.find(c => c.id === args.catalogId && c.type === type) || catalogs.find(c => c.type === type);
          if (!selected) return [];
          const extra = [args.query ? `search=${encodeURIComponent(args.query)}` : '', args.skip ? `skip=${Number(args.skip) || 0}` : ''].filter(Boolean).join('&');
          return (await json(resourceUrl(row, 'catalog', type, selected.id, extra), signal)).metas || [];
        }
        if (!args.id) fail(400, 'content_id_required', 'This addon needs its content ID; browse or search its catalog first');
        if (op === 'info' || op === 'episodes') {
          const result = (await json(resourceUrl(row, 'meta', type, args.id), signal)).meta;
          return op === 'episodes' ? result?.videos || [] : result;
        }
        if (op !== 'resolve') fail(422, 'unsupported_operation');
        const streams = (await json(resourceUrl(row, 'stream', type, args.id), signal)).streams;
        if (!Array.isArray(streams)) fail(502, 'invalid_extension_response');
        let subtitles = [];
        if ((row.manifest.resources || []).some(item => (typeof item === 'string' ? item : item.name) === 'subtitles')) {
          const result = await json(resourceUrl(row, 'subtitles', type, args.id), signal).catch(() => ({ subtitles: [] }));
          subtitles = (result.subtitles || []).map(item => ({ ...item, language: item.lang, label: item.lang }));
        }
        return streams.flatMap(stream => {
          if (stream.infoHash || stream.url?.startsWith('magnet:')) {
            return platform === 'desktop' && hosts.torrent ? [{ ...stream, sourceType: 'torrent' }] : [];
          }
          if (typeof stream.url !== 'string' || !/^https?:\/\//.test(stream.url)) return [];
          return [{ ...stream, url: stream.url, source: stream.name || row.manifest.name, quality: stream.title || '',
            headers: cleanHeaders(stream.behaviorHints?.proxyHeaders?.request || {}), subtitles: [...(stream.subtitles || []), ...subtitles],
            sourceType: /\.m3u8(?:\?|$)/i.test(stream.url) ? 'hls' : 'mp4' }];
        });
      }
      const code = await artifacts.get(row.artifact);
      const execute = row.runtime === 'node' ? nodeInterpreter : interpreter;
      if (!execute) fail(422, 'unsupported_runtime');
      let declared = {};
      if (row.ecosystem === 'mangayomi') declared = cleanHeaders(await interpreter({ code, ecosystem: row.ecosystem, manifest: row.manifest, method: 'getHeaders', args: { url: row.manifest.baseUrl }, preferences, network, signal }));
      const call = (method, options) => execute({ code, ecosystem: row.ecosystem, manifest: row.manifest, method, args: options, preferences, network: (url, init) => network(url, { ...init, headers: { ...declared, ...init.headers } }), signal, onProgress });
      let result = await call(METHODS[row.ecosystem]?.[op], args);
      if (row.ecosystem === 'tatakai' && op === 'chapters') return result;
      const absolute = value => { if (!value) return undefined; try { return publicUrl(new URL(value, row.manifest.baseUrl || row.manifest.website || undefined).href).href; } catch { return value; } };
      const entry = (item, index) => ({ ...item, id: String(item.id || item.href || item.link || item.url || ''),
        title: item.title || item.name || item.label, label: item.label || item.title || item.name,
        number: Number(item.number ?? item.episode ?? item.chapter ?? String(item.name || item.title || '').match(/\d+(?:\.\d+)?/)?.[0] ?? index + 1) });
      if (op === 'search' || op === 'browse') {
        const list = Array.isArray(result) ? result : result?.list || result?.results || [];
        return list.map((item, index) => ({ ...entry(item, index), image: absolute(item.image || item.imageUrl || item.poster || item.thumbnailUrl), headers: declared }));
      }
      if (op === 'info' || op === 'episodes' || op === 'chapters') {
        if (row.ecosystem === 'sora' && op === 'info') {
          const method = row.kind === 'read' ? 'extractChapters' : 'extractEpisodes';
          result = { ...(result || {}), entries: await call(method, args) };
        }
        const entries = (Array.isArray(result) ? result : result?.entries || result?.chapters || result?.episodes || []).map(entry);
        if (op !== 'info') return entries;
        return { ...result, id: String(args.id || args.url), title: result?.title || result?.name, image: absolute(result?.image || result?.imageUrl), entries, headers: declared };
      }
      if (op === 'resolve') {
        const list = typeof result === 'string' ? [{ url: result }] : Array.isArray(result) ? result : result?.sources || result?.streams || [result];
        return list.filter(Boolean).map(item => ({ ...item, url: absolute(item.url || item.streamUrl || item.stream), source: item.source || row.manifest.name, quality: item.quality || 'auto', headers: { ...declared, ...item.headers }, subtitles: item.subtitles || [], sourceType: item.sourceType || (/\.m3u8(?:\?|$)/i.test(item.url || item.streamUrl || '') ? 'hls' : 'mp4') }));
      }
      if (op === 'pages') return (Array.isArray(result) ? result : result?.pages || []).map((item, index) => ({ pageNumber: index + 1, imageUrl: absolute(typeof item === 'string' ? item : item.url || item.imageUrl), headers: { ...declared, ...(item.headers || {}) } }));
      return result;
    },
  };
}
