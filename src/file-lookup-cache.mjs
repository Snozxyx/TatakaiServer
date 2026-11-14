import { mkdir, readdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';

/** Compact encrypted JSON responses, separate from the frequently-written SQLite state. */
export async function createFileLookupCache({ root, vault, maxBytes = 32 * 1024 * 1024, maxEntries = 128, maxEntryBytes = 2 * 1024 * 1024, now = Date.now }) {
  const directory = path.resolve(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = new Map();
  let generation = 0, queue = Promise.resolve();
  const valid = key => typeof key === 'string' && /^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{43})$/.test(key);
  const filename = key => { if (!valid(key)) throw Error('Invalid cache key'); return path.join(directory, key + '.json'); };
  const remove = async key => { files.delete(key); await unlink(filename(key)).catch(() => {}); };
  const trim = async () => {
    for (const [key, entry] of files) if (entry.expires <= now()) await remove(key);
    let size = [...files.values()].reduce((total, entry) => total + entry.bytes, 0);
    for (const [key, entry] of files) {
      if (size <= maxBytes && files.size <= maxEntries) break;
      size -= entry.bytes; await remove(key);
    }
  };
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json') || !valid(name.slice(0, -5))) continue;
    const key = name.slice(0, -5);
    try {
      const info = await stat(filename(key));
      if (info.size > maxEntryBytes * 2) { await remove(key); continue; }
      const entry = JSON.parse(await readFile(filename(key), 'utf8'));
      if (entry.schema !== 1 || !Number.isFinite(entry.expires) || entry.expires <= now()) { await remove(key); continue; }
      files.set(key, { expires: entry.expires, bytes: info.size });
    } catch { await remove(key); }
  }
  await trim();
  const serialize = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  return {
    stats() { return { entries: files.size, bytes: [...files.values()].reduce((total, entry) => total + entry.bytes, 0), maxBytes }; },
    async get(key) {
      const entry = files.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) { await remove(key); return undefined; }
      try {
        const stored = JSON.parse(await readFile(filename(key), 'utf8'));
        const value = await vault.open(stored.payload);
        if (typeof value !== 'string' || Buffer.byteLength(value) > maxEntryBytes) throw Error('Invalid cached response');
        return { value, expires: entry.expires };
      } catch { await remove(key); return undefined; }
    },
    put(key, value, ttl) {
      if (!valid(key) || typeof value !== 'string' || Buffer.byteLength(value) > maxEntryBytes || ttl <= 0) return;
      const version = generation;
      return serialize(async () => {
        if (version !== generation) return;
        const expires = now() + ttl;
        const data = JSON.stringify({ schema: 1, expires, payload: await vault.seal(value) });
        if (Buffer.byteLength(data) > maxBytes || version !== generation) return;
        const temporary = filename(key) + '.tmp';
        await writeFile(temporary, data, { mode: 0o600 });
        if (version !== generation) { await unlink(temporary).catch(() => {}); return; }
        await rename(temporary, filename(key));
        files.delete(key); files.set(key, { expires, bytes: Buffer.byteLength(data) });
        await trim();
      });
    },
    clear() {
      generation++;
      return serialize(async () => { for (const key of [...files.keys()]) await remove(key); });
    },
  };
}
