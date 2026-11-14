import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFileLookupCache } from '../src/file-lookup-cache.mjs';
import { createLookupCache } from '../src/lookup-cache.mjs';
import { vault, digest } from '../src/security.mjs';
const secret = 'response-cache-fixture-secret-with-at-least-32-characters';
const a = 'a'.repeat(64), b = 'b'.repeat(64);
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tatakai-json-cache-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('tatakai-json-cache-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = { root, vault: await vault(secret), ...options };
  return { root, config, disk: await createFileLookupCache(config) };
}

test('JSON responses survive restart with private headers encrypted and a fixed expiry', async t => {
  let time = 1000;
  const { root, disk, config } = await fixture(t, { now: () => time });
  const value = JSON.stringify([{ url: 'https://cdn.example/video', headers: { Cookie: 'private-session-fixture' } }]);
  await disk.put(a, value, 5000);
  const file = JSON.parse(await readFile(path.join(root, a+'.json'), 'utf8'));
  assert.equal(file.schema, 1);
  assert.ok(!JSON.stringify(file).includes('private-session-fixture'));
  const restored = await createFileLookupCache(config);
  assert.equal((await restored.get(a)).value, value);
  time = 6001;
  assert.equal(await restored.get(a), undefined);
  assert.equal(restored.stats().entries, 0);
});

test('disk budget evicts old responses and cache clearing removes JSON files', async t => {
  const { root, disk } = await fixture(t, { maxEntries: 1 });
  await disk.put(a, '[]', 5000); await disk.put(b, '[1]', 5000);
  assert.equal(await disk.get(a), undefined);
  assert.equal(disk.stats().entries, 1);
  await disk.clear();
  assert.deepEqual(await readdir(root), []);
});

test('the server’s base64url digest keys persist as JSON filenames', async t => {
  const { root, disk } = await fixture(t);
  const key = await digest(JSON.stringify(['provider', 'search', { query: 'Naruto' }]));
  await disk.put(key, '[{"id":"naruto"}]', 5000);
  assert.equal((await disk.get(key)).value, '[{"id":"naruto"}]');
  assert.deepEqual(await readdir(root), [key+'.json']);
});

test('concurrent viewers share one lookup and a restart reads JSON without upstream work', async t => {
  const { disk, config } = await fixture(t);
  let calls = 0;
  const memory = createLookupCache({ persistence: disk });
  const load = async publish => { calls++; publish([{ url: 'https://cdn.example/video' }]); return [{ url: 'https://cdn.example/video' }]; };
  const progress = [];
  const [first, second] = await Promise.all([memory.get(a, load, 5000, undefined, false, batch => progress.push(batch)), memory.get(a, load, 5000)]);
  assert.deepEqual(first, second); assert.equal(calls, 1); assert.equal(progress.length, 1);
  const restarted = createLookupCache({ persistence: await createFileLookupCache(config) });
  assert.deepEqual(await restarted.get(a, load, 5000), first);
  assert.equal(calls, 1);
});

test('clearing an in-flight lookup cannot repopulate persistent JSON', async t => {
  const { disk } = await fixture(t);
  const memory = createLookupCache({ persistence: disk });
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const result = memory.get(a, () => { entered(); return new Promise(resolve => { finish = resolve; }); }, 5000);
  await started; await memory.clear(); finish([1]); await result;
  assert.equal(await disk.get(a), undefined);
});
