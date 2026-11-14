import { fail, cleanHeaders, stripCredentials, limitedText, limitedBytes, digest } from './security.mjs';
export function createProxy({ vault, network, platform, cache, mediaProxyUrl, mediaProxyPassword, originRelayHosts = [] }) {
  const relayHosts = (Array.isArray(originRelayHosts) ? originRelayHosts : String(originRelayHosts).split(',')).map(host => String(host).trim().toLowerCase()).filter(Boolean);
  const edgeUrl = (target, headers = {}) => {
    const url = new URL(mediaProxyUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail(500, 'invalid_media_proxy');
    url.searchParams.set('url', target);
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'referer') url.searchParams.set('referer', value);
      if (key.toLowerCase() === 'user-agent') url.searchParams.set('userAgent', value);
    }
    if (mediaProxyPassword) url.searchParams.set('password', mediaProxyPassword);
    return url.href;
  };
  async function mint(entry, base, sessionId, lifetime = 6 * 60 * 60 * 1000) {
    if (typeof entry.url !== 'string' || entry.url.length > 16384) fail(413, 'media_url_too_large');
    // Public media belongs at the edge; private headers and internal native
    // resources retain the encrypted, revocable server-ticket path.
    const headers = cleanHeaders(entry.headers);
    const host = /^https?:\/\//i.test(entry.url) ? new URL(entry.url).hostname.toLowerCase() : '';
    const originRequired = relayHosts.some(suffix => host === suffix || host.endsWith('.' + suffix));
    if (mediaProxyUrl && !originRequired && entry.resourceType !== 'image' && /^https?:\/\//i.test(entry.url) && Object.keys(headers).every(key =>
      ['referer', 'user-agent', 'accept', 'accept-language'].includes(key.toLowerCase()))) {
      return edgeUrl(entry.url, headers);
    }
    const ticket = await vault.seal({ ...entry, sessionId, expires: Date.now() + lifetime });
    const url = `${base}/api/server/v1/media/${ticket}`;
    // Image hosts commonly block edge IPs. Preserve their working origin relay
    // and private header replay; large public video bodies still use Hoko.
    return url;
  }
  async function serve(request, ticket, base, state) {
    const entry = await vault.open(ticket);
    if (entry.expires < Date.now()) fail(410, 'media_expired', 'Resolve this source again to refresh playback');
    const publicSession = !state.viewer && entry.sessionId === `public:${state.publicEpoch || state.id}`;
    if (!publicSession && (!state.sessions[entry.sessionId] || state.sessions[entry.sessionId].expires < Date.now())) fail(401, 'device_revoked');
    const key = await digest(JSON.stringify([entry.url, Object.entries(cleanHeaders(entry.headers)).sort()]));
    if (request.method === 'GET' && !request.headers.has('range') && cache) {
      const cached = await cache.get(key, state); if (cached) return cached;
    }
    const headers = cleanHeaders(entry.headers);
    headers['accept-encoding'] = 'identity';
    const range = request.headers.get('range');
    if (range) {
      if (!/^bytes=\d*-\d*$/.test(range)) fail(416, 'invalid_range');
      headers.range = range;
      if (platform === 'vercel') {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) fail(416, 'bounded_range_required');
        const start = Number(match[1]), end = Math.min(Number(match[2] || start + 4_000_000 - 1), start + 4_000_000 - 1);
        headers.range = `bytes=${start}-${end}`;
      }
    }
    const connect = new AbortController();
    const timer = setTimeout(() => connect.abort(), 18000);
    const signal = AbortSignal.any([request.signal, connect.signal, ...(platform === 'vercel' ? [AbortSignal.timeout(25000)] : [])]);
    let fetched;
    try { fetched = await network(entry.url, { headers, method: request.method, signal }); }
    finally { clearTimeout(timer); }
    const { response, url, headers: effectiveHeaders, resourceUrl } = fetched;
    const out = new Headers({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" });
    for (const name of ['content-type', 'content-range', 'accept-ranges', 'content-length', 'etag', 'last-modified']) {
      const value = response.headers.get(name); if (value) out.set(name, value);
    }
    if (request.method === 'HEAD') { await response.body?.cancel(); return new Response(null, { status: response.status, headers: out }); }
    if (response.ok && /mpegurl/i.test(out.get('content-type') || '') || response.ok && /\.m3u8(?:\?|$)/i.test(url)) {
      const text = await limitedText(response, 2 * 1024 * 1024);
      const targets = new Map();
      const register = async value => {
        const target = new URL(value, url);
        const childHeaders = target.origin === new URL(url).origin ? effectiveHeaders : stripCredentials(effectiveHeaders);
        targets.set(value, await mint({ url: resourceUrl ? await resourceUrl(target.href) : target.href, headers: childHeaders }, base, entry.sessionId, Math.max(1, entry.expires - Date.now())));
      };
      for (const line of text.split('\n')) {
        if (line.trim() && !line.trim().startsWith('#')) await register(line.trim());
        for (const match of line.matchAll(/URI="([^"]+)"/g)) await register(match[1]);
      }
      const rewritten = text.split('\n').map(line => line.trim().startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${targets.get(value)}"`) : targets.get(line.trim()) || line).join('\n');
      out.delete('content-length'); out.set('content-type', 'application/vnd.apple.mpegurl');
      return new Response(rewritten, { status: response.status, headers: out });
    }
    if (platform === 'vercel' && (Number(out.get('content-length')) > 4_000_000 || !out.has('content-length'))) {
      await response.body?.cancel(); fail(422, 'proxy_response_limit', 'This deployment requires HLS resources or bounded byte ranges under 4 MB');
    }
    const size = Number(out.get('content-length'));
    if (request.method === 'GET' && !range && response.status === 200 && size > 0 && size <= 512 * 1024 && state.settings.mediaCacheMb && cache && /^(image\/|text\/vtt|application\/(octet-stream|x-subrip)|video\/mp2t)/i.test(out.get('content-type') || '')) {
      const timer = setTimeout(() => connect.abort(), 18000);
      try {
        const data = await limitedBytes(response, 512 * 1024);
        out.set('content-length', String(data.length));
        await cache.put(key, data, out, state);
        out.set('content-length', String(data.length)); out.set('x-tatakai-cache', 'MISS');
        return new Response(data, { headers: out });
      } finally { clearTimeout(timer); }
    }
    return new Response(response.body, { status: response.status, headers: out });
  }
  return { mint, serve };
}
