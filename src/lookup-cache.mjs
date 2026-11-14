/** Bounded process-local cache for large, unproxied lookup results. */
export function createLookupCache({ maxBytes = 8 * 1024 * 1024, maxEntryBytes = 2 * 1024 * 1024, maxEntries = 64, maxPending = 32, persistence } = {}) {
  const entries = new Map(), pending = new Map();
  let bytes = 0, generation = 0;
  const remove = key => { const row = entries.get(key); if (row) { bytes -= row.bytes; entries.delete(key); } };
  const wait = (promise, signal) => {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || Error('Lookup cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  };
  return {
    clear() { generation++; entries.clear(); bytes = 0; return persistence?.clear(); },
    async get(key, load, ttl, signal, progressive = false, onProgress) {
      signal?.throwIfAborted();
      const now = Date.now();
      for (const [id, row] of entries) if (row.expires <= now) remove(id);
      const hit = entries.get(key);
      if (hit) { entries.delete(key); entries.set(key, hit); return progressive ? {chapters:JSON.parse(hit.value),partial:false} : JSON.parse(hit.value); }
      let flight = pending.get(key);
      if (!flight) {
        if (pending.size >= maxPending) throw Object.assign(Error('Lookup queue is full'), { status: 503, code: 'lookup_queue_full' });
        const version = generation;
        const record = { promise: null, chunks: [], size: 0, subscribers: new Set() };
        let persistedExpiry;
        record.promise = Promise.resolve().then(async () => {
          const disk = await persistence?.get(key).catch(() => undefined);
          if (disk) { persistedExpiry = disk.expires; return JSON.parse(disk.value); }
          return load(items => {
          if (!Array.isArray(items)) return;
          for (const item of items) {
            const size = new TextEncoder().encode(JSON.stringify(item)).byteLength;
            if (record.size + size > maxEntryBytes || record.chunks.length >= 20000) break;
            record.chunks.push(item); record.size += size;
          }
          for (const subscriber of record.subscribers) { try { subscriber(items); } catch {} }
        }); }).then(async result => {
          const value = JSON.stringify(result), size = value ? new TextEncoder().encode(value).byteLength : 0;
          // Progressive snapshots must not freeze an incomplete provider list.
          if (version === generation && size && size <= maxEntryBytes && size <= maxBytes && !result?.partial && result?.complete !== false) {
            while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) remove(entries.keys().next().value);
            const empty = Array.isArray(result) ? !result.length : Array.isArray(result?.chapters) && !result.chapters.length;
            const lifetime = Math.min(ttl, empty ? 30000 : ttl);
            entries.set(key, { value, bytes: size, expires: persistedExpiry || Date.now() + lifetime }); bytes += size;
            if (!persistedExpiry) await persistence?.put(key, value, lifetime)?.catch(() => {});
          }
          return result;
        }).finally(() => pending.delete(key));
        flight = record;
        pending.set(key, flight);
      }
      if (onProgress) {
        flight.subscribers.add(onProgress);
        if (flight.chunks.length) onProgress([...flight.chunks]);
      }
      if (progressive) {
        let timer;
        try {
          return await wait(Promise.race([
            flight.promise.then(chapters => ({ chapters, partial: false })),
            new Promise(resolve => { timer = setTimeout(() => resolve({ chapters: [...flight.chunks], partial: true }), 500); }),
          ]), signal);
        } finally { clearTimeout(timer); }
      }
      // Each client owns its cancellation. A cancelled waiter cannot cancel
      // another client's shared lookup; load has its own bounded deadline.
      try { return await wait(flight.promise, signal); }
      finally { if (onProgress) flight.subscribers.delete(onProgress); }
    },
  };
}
