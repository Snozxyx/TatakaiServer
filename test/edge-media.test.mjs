import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProxy } from '../src/proxy.mjs';
import { publicUrl } from '../src/security.mjs';

test('public media uses Hoko with replay headers and no server encryption work', async () => {
  const proxy = createProxy({ mediaProxyUrl: 'https://hoko.tatakai.me/api/v1/streamingProxy',
    vault: { seal() { throw Error('unexpected local ticket'); } } });
  const result = new URL(await proxy.mint({ url: 'https://cdn.example/master.m3u8', headers: { Referer: 'https://player.example/', 'User-Agent': 'Tatakai' } }, 'https://server.tatakai.qzz.io', 'public'));
  assert.equal(result.hostname, 'hoko.tatakai.me');
  assert.equal(result.searchParams.get('url'), 'https://cdn.example/master.m3u8');
  assert.equal(result.searchParams.get('referer'), 'https://player.example/');
  assert.equal(result.searchParams.get('userAgent'), 'Tatakai');
});

test('session headers and native URLs retain opaque server tickets', async () => {
  const entries = [];
  const proxy = createProxy({ mediaProxyUrl: 'https://hoko.tatakai.me/api/v1/streamingProxy', vault: { seal: async entry => { entries.push(entry); return 'opaque-ticket'; } } });
  for (const entry of [{ url: 'https://cdn.example/video', headers: { Cookie: 'private-session' } }, { url: 'tatakai-native:sealed' }]) {
    assert.equal(await proxy.mint(entry, 'https://server.tatakai.qzz.io', 'viewer'), 'https://server.tatakai.qzz.io/api/server/v1/media/opaque-ticket');
  }
  assert.equal(entries.length, 2);
});

test('reader images retain encrypted origin tickets and private header replay', async () => {
  let saved;
  const proxy = createProxy({ mediaProxyUrl: 'https://hoko.tatakai.me/api/v1/streamingProxy', vault: { seal: async entry => { saved=entry; return 'opaque-image-ticket'; } } });
  const result = new URL(await proxy.mint({ url: 'https://images.example/page.jpg', resourceType:'image', headers:{ Cookie:'private-fixture',Referer:'https://reader.example/' } },'https://server.tatakai.qzz.io','viewer'));
  assert.equal(result.hostname,'server.tatakai.qzz.io');
  assert.equal(result.pathname,'/api/server/v1/media/opaque-image-ticket');
  assert.equal(result.searchParams.has('referer'),false);
  assert.equal(saved.headers.Cookie,'private-fixture');
});

test('only configured edge-blocked hosts use origin relay', async () => {
  const proxy = createProxy({mediaProxyUrl:'https://hoko.tatakai.me/api/v1/streamingProxy',originRelayHosts:'mp4upload.com',vault:{seal:async()=> 'opaque-ticket'}});
  assert.equal(await proxy.mint({url:'https://a3.mp4upload.com/video.mp4'},'https://server.tatakai.qzz.io','viewer'),'https://server.tatakai.qzz.io/api/server/v1/media/opaque-ticket');
  assert.equal(new URL(await proxy.mint({url:'https://cdn.example/video.mp4'},'https://server.tatakai.qzz.io','viewer')).hostname,'hoko.tatakai.me');
  assert.equal(new URL(await proxy.mint({url:'https://not-mp4upload.com/video.mp4'},'https://server.tatakai.qzz.io','viewer')).hostname,'hoko.tatakai.me');
});

test('dedicated CDN ports are allowed only for their exact public HTTPS hosts', () => {
  assert.equal(publicUrl('https://a3.mp4upload.com:183/video.mp4').port,'183');
  assert.equal(publicUrl('https://vidcache.net:8161/video.mp4').port,'8161');
  for (const url of ['https://cdn.example:183/video.mp4','https://mp4upload.com.evil.test:183/video.mp4','http://a3.mp4upload.com:183/video.mp4','https://user:secret@a3.mp4upload.com:183/video.mp4','https://127.0.0.1:8161/video.mp4']) assert.throws(()=>publicUrl(url));
});
