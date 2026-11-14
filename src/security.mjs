const encoder = new TextEncoder();
export const bytes = value => encoder.encode(value);
export const random = () => crypto.randomUUID();
export const base64 = value => {
  let text = ''; for (let offset = 0; offset < value.length; offset += 32768) text += String.fromCharCode(...value.subarray(offset, offset + 32768));
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
export const unbase64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export class HttpError extends Error {
  constructor(status, code, message = code) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new HttpError(status, code, message); };
export async function digest(value) { return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value)))); }
export async function equal(a, b) {
  const left = bytes(await digest(String(a))), right = bytes(await digest(String(b)));
  let difference = 0; for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
export async function passwordHash(password, salt = base64(crypto.getRandomValues(new Uint8Array(16)))) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 1024) fail(400, 'password_length', 'Use a password between 10 and 1024 characters');
  const key = await crypto.subtle.importKey('raw', bytes(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: 600000 }, key, 256);
  return { salt, hash: base64(new Uint8Array(hash)) };
}
export async function verifyPassword(value, stored) {
  if (!stored || typeof value !== 'string' || value.length < 10 || value.length > 1024) return false;
  return equal((await passwordHash(value, stored.salt)).hash, stored.hash);
}
export async function vault(secret) {
  if (!secret || secret.length < 32) throw Error('SERVER_SECRET must contain at least 32 characters');
  const raw = await crypto.subtle.digest('SHA-256', bytes(secret));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    async seal(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes(JSON.stringify(value)));
      return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
    },
    async open(value) {
      try {
        const [iv, payload] = String(value).split('.');
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv) }, key, unbase64(payload));
        return JSON.parse(new TextDecoder().decode(plain));
      } catch { fail(401, 'invalid_capability'); }
    },
  };
}
export function publicUrl(value) {
  let url; try { url = new URL(value); } catch { fail(400, 'invalid_url'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  // These public video CDNs issue HTTPS media links on dedicated ports.
  // Keep the exception tied to both hostname and port; DNS/private-IP guards
  // below and the actual socket-address validation remain in force.
  const mediaPort = url.protocol === 'https:' && [
    ['mp4upload.com', '183'], ['vidcache.net', '8161'],
  ].some(([domain, port]) => url.port === port && (host === domain || host.endsWith('.' + domain)));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port) && !mediaPort)) fail(400, 'invalid_url');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') fail(403, 'private_upstream');
  if (host.includes(':')) {
    // Only global unicast IPv6; excludes loopback, mapped IPv4, ULA and link-local.
    if (!/^[23][0-9a-f]{3}:/.test(host)) fail(403, 'private_upstream');
  } else if (/^[\d.]+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b))) fail(403, 'private_upstream');
  } else if (!host.includes('.')) fail(403, 'private_upstream');
  url.hash = ''; return url;
}
export function cleanHeaders(input = {}) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.length > 200 || typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(key + value) || /^(host|connection|content-length|transfer-encoding|proxy-authorization|x-forwarded-.*)$/i.test(key)) continue;
    out[key.toLowerCase()] = value;
  }
  return out;
}
export function stripCredentials(headers) {
  const out = cleanHeaders(headers); for (const key of ['cookie', 'authorization']) delete out[key]; return out;
}
export async function limitedText(response, max = 4 * 1024 * 1024) {
  return new TextDecoder().decode(await limitedBytes(response, max));
}
export async function limitedBytes(response, max = 4 * 1024 * 1024) {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); fail(413, 'response_too_large'); }
  const reader = response.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks = []; let length = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); fail(413, 'response_too_large'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const data = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}
export function createNetwork({ fetch: fetcher = fetch, resolveHost } = {}) {
  return async function network(value, init = {}) {
    let url = publicUrl(value), headers = cleanHeaders(init.headers);
    for (let hop = 0; hop < 6; hop++) {
      if (resolveHost) for (const address of await resolveHost(url.hostname)) publicUrl(`${address.includes(':') ? 'http://[' + address + ']' : 'http://' + address}/`);
      let response;
      try { response = await fetcher(url.href, { ...init, headers, redirect: 'manual' }); }
      catch (error) { if (error.status) throw error; fail(init.signal?.aborted ? 504 : 502, init.signal?.aborted ? 'upstream_timeout' : 'upstream_unavailable'); }
      if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url: url.href, headers };
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) fail(502, 'invalid_redirect');
      const next = publicUrl(new URL(location, url).href);
      if (next.origin !== url.origin) headers = stripCredentials(headers);
      if (response.status === 303) init = { ...init, method: 'GET', body: undefined };
      url = next;
    }
    fail(502, 'redirect_limit');
  };
}
