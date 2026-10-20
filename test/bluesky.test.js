/**
 * test/bluesky.test.js — Bluesky (AT Protocol) 适配器（mock HTTP，离线运行）
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BlueskyAdapter = require('../server/platforms/bluesky');
const { buildLinkFacets } = require('../server/platforms/bluesky');
const { startMock, baseUrlOf, tmpDir, PNG_1PX_BASE64 } = require('./helpers');

function makeAdapter(base) {
  return new BlueskyAdapter({ bluesky: { service: base } });
}

function makeAccount(base) {
  return {
    externalId: 'did:plc:abc123',
    username: 'alice.bsky.social',
    tokens: { accessToken: 'access-jwt', refreshToken: 'refresh-jwt', pds: base }
  };
}

function makeMedia() {
  const dir = tmpDir('echo-bsky-');
  const file = path.join(dir, 'pixel.png');
  fs.writeFileSync(file, Buffer.from(PNG_1PX_BASE64, 'base64'));
  return { id: 'm1', path: file, mime: 'image/png', name: 'pixel.png' };
}

test('limits 暴露 Bluesky 规则', () => {
  const lim = makeAdapter('https://bsky.social').limits();
  assert.equal(lim.maxChars, 300);
  assert.equal(lim.maxImages, 4);
  assert.equal(lim.maxImageBytes, 1024 * 1024);
});

test('connect：handle + App Password → 会话与资料', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/xrpc/com.atproto.server.createSession') {
      assert.equal(req.json.identifier, 'alice.bsky.social');
      assert.equal(req.json.password, 'abcd-efgh-ijkl-mnop');
      return { body: { accessJwt: 'a1', refreshJwt: 'r1', did: 'did:plc:abc123', handle: 'alice.bsky.social' } };
    }
    if (req.path === '/xrpc/app.bsky.actor.getProfile') {
      assert.equal(req.query.get('actor'), 'did:plc:abc123');
      return { body: { displayName: 'Alice' } };
    }
    return null;
  });
  t.after(() => server.close());
  const base = baseUrlOf(server);

  const result = await makeAdapter(base).connect({ identifier: 'alice.bsky.social', password: 'abcd-efgh-ijkl-mnop' });
  assert.equal(result.externalId, 'did:plc:abc123');
  assert.equal(result.username, 'alice.bsky.social');
  assert.equal(result.displayName, 'Alice');
  assert.equal(result.tokens.accessToken, 'a1');
  assert.equal(result.tokens.refreshToken, 'r1');
  assert.equal(result.tokens.pds, base);
  assert.ok(result.tokens.expiresAt > Date.now());
});

test('connect：密码错误返回 401 且带平台信息', async (t) => {
  const server = await startMock(() => ({ status: 401, body: { error: 'AuthenticationRequired', message: 'Invalid identifier or password' } }));
  t.after(() => server.close());

  await assert.rejects(
    () => makeAdapter(baseUrlOf(server)).connect({ identifier: 'x.bsky.social', password: 'bad' }),
    /Bluesky 登录失败/
  );
});

test('refreshToken：refreshSession 轮换令牌', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/xrpc/com.atproto.server.refreshSession') {
      assert.equal(req.headers.authorization, 'Bearer old-refresh');
      return { body: { accessJwt: 'a2', refreshJwt: 'r2' } };
    }
    return null;
  });
  t.after(() => server.close());
  const base = baseUrlOf(server);

  const out = await makeAdapter(base).refreshToken({ refreshToken: 'old-refresh', pds: base });
  assert.equal(out.accessToken, 'a2');
  assert.equal(out.refreshToken, 'r2');
  assert.equal(out.pds, base);
});

test('publishPost：图片上传 + 链接 facets + 记录写入', async (t) => {
  let blobUploaded = false;
  const server = await startMock((req) => {
    if (req.path === '/xrpc/com.atproto.repo.uploadBlob') {
      blobUploaded = true;
      assert.match(req.headers['content-type'], /image\/png/);
      assert.ok(req.body.length > 0);
      return { body: { blob: { $type: 'blob', ref: { $link: 'bafyblob' }, mimeType: 'image/png', size: 70 } } };
    }
    if (req.path === '/xrpc/com.atproto.repo.createRecord') {
      const rec = req.json.record;
      assert.equal(req.json.repo, 'did:plc:abc123');
      assert.equal(req.json.collection, 'app.bsky.feed.post');
      assert.equal(rec.$type, 'app.bsky.feed.post');
      assert.ok(rec.text.includes('https://example.com/x'));
      assert.ok(Array.isArray(rec.facets) && rec.facets.length === 1);
      assert.equal(rec.facets[0].features[0].$type, 'app.bsky.richtext.facet#link');
      assert.equal(rec.embed.$type, 'app.bsky.embed.images');
      assert.equal(rec.embed.images[0].image.ref.$link, 'bafyblob');
      return { body: { uri: 'at://did:plc:abc123/app.bsky.feed.post/3kabc', cid: 'cid-1' } };
    }
    return null;
  });
  t.after(() => server.close());
  const base = baseUrlOf(server);

  const r = await makeAdapter(base).publishPost(makeAccount(base), {
    text: '看这个 https://example.com/x',
    media: [makeMedia()]
  });
  assert.ok(blobUploaded);
  assert.equal(r.platformPostId, 'at://did:plc:abc123/app.bsky.feed.post/3kabc');
  assert.equal(r.cid, 'cid-1');
  assert.equal(r.permalink, 'https://bsky.app/profile/alice.bsky.social/post/3kabc');
});

test('publishThread：第二条用 root + parent 串接', async (t) => {
  const calls = [];
  const server = await startMock((req) => {
    if (req.path === '/xrpc/com.atproto.repo.createRecord') {
      calls.push(req.json.record);
      const n = calls.length;
      return { body: { uri: `at://did:plc:abc123/app.bsky.feed.post/rk${n}`, cid: `cid-${n}` } };
    }
    return null;
  });
  t.after(() => server.close());
  const base = baseUrlOf(server);

  await makeAdapter(base).publishThread(makeAccount(base), [{ text: '第一段' }, { text: '第二段' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].reply, undefined);
  assert.deepEqual(calls[1].reply.root, { uri: 'at://did:plc:abc123/app.bsky.feed.post/rk1', cid: 'cid-1' });
  assert.deepEqual(calls[1].reply.parent, { uri: 'at://did:plc:abc123/app.bsky.feed.post/rk1', cid: 'cid-1' });
});

test('buildLinkFacets：UTF-8 字节偏移正确', () => {
  const text = '看这个 https://example.com/x 很好';
  const facets = buildLinkFacets(text);
  assert.equal(facets.length, 1);
  const expectedStart = Buffer.byteLength('看这个 ', 'utf8');
  assert.equal(facets[0].index.byteStart, expectedStart);
  assert.equal(facets[0].index.byteEnd, expectedStart + Buffer.byteLength('https://example.com/x', 'utf8'));
  assert.equal(facets[0].features[0].uri, 'https://example.com/x');
});

test('connect：从 refreshJwt 解析出续期凭证的到期时间', async (t) => {
  const exp = Math.floor((Date.now() + 90 * 24 * 3600 * 1000) / 1000);
  const payload = Buffer.from(JSON.stringify({ scope: 'com.atproto.refresh', exp })).toString('base64url');
  const refreshJwt = 'header.' + payload + '.sig';
  const server = await startMock((req) => {
    if (req.path === '/xrpc/com.atproto.server.createSession') {
      return { body: { accessJwt: 'a', refreshJwt, did: 'did:plc:1', handle: 'u.bsky.social' } };
    }
    if (req.path === '/xrpc/app.bsky.actor.getProfile') return { body: { displayName: 'U' } };
    return null;
  });
  t.after(() => server.close());

  const r = await makeAdapter(baseUrlOf(server)).connect({ identifier: 'u.bsky.social', password: 'pw' });
  assert.equal(r.tokens.refreshExpiresAt, exp * 1000);
});
