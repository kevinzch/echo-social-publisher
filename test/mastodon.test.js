/**
 * test/mastodon.test.js — Mastodon 适配器（mock HTTP，离线运行）
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const MastodonAdapter = require('../server/platforms/mastodon');
const { normalizeInstance } = require('../server/platforms/mastodon');
const { startMock, baseUrlOf, tmpDir, PNG_1PX_BASE64 } = require('./helpers');

function makeAdapter() {
  return new MastodonAdapter({ mastodon: { defaultInstance: 'https://mastodon.social' } });
}

function makeAccount(base) {
  return {
    externalId: '42',
    username: 'alice@mastodon.social',
    tokens: { accessToken: 'tok-123', instance: base }
  };
}

function makeMedia() {
  const dir = tmpDir('echo-masto-');
  const file = path.join(dir, 'pixel.png');
  fs.writeFileSync(file, Buffer.from(PNG_1PX_BASE64, 'base64'));
  return { id: 'm1', path: file, mime: 'image/png', name: 'pixel.png' };
}

test('normalizeInstance：补协议、去尾斜杠、拒绝非法地址', () => {
  assert.equal(normalizeInstance('mastodon.social'), 'https://mastodon.social');
  assert.equal(normalizeInstance('https://mastodon.social/'), 'https://mastodon.social');
  assert.equal(normalizeInstance(' http://localhost:3000// '), 'http://localhost:3000');
  assert.throws(() => normalizeInstance(''), /实例地址/);
});

test('limits 暴露 Mastodon 规则', () => {
  const lim = makeAdapter().limits();
  assert.equal(lim.maxChars, 500);
  assert.equal(lim.maxImages, 4);
  assert.equal(lim.maxImageBytes, 16 * 1024 * 1024);
});

test('connect：实例 + 令牌 → 账号信息', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/api/v1/accounts/verify_credentials') {
      assert.equal(req.headers.authorization, 'Bearer tok-123');
      return { body: { id: '42', username: 'alice', acct: 'alice@mastodon.social', display_name: 'Alice' } };
    }
    return null;
  });
  t.after(() => server.close());
  const base = baseUrlOf(server);

  const r = await makeAdapter().connect({ instance: base, token: 'tok-123' });
  assert.equal(r.externalId, '42');
  assert.equal(r.username, 'alice@mastodon.social');
  assert.equal(r.displayName, 'Alice');
  assert.equal(r.tokens.instance, base);
  assert.equal(r.tokens.expiresAt, null);
});

test('connect：无效令牌返回 401', async (t) => {
  const server = await startMock(() => ({ status: 401, body: { error: 'The access token is invalid' } }));
  t.after(() => server.close());

  await assert.rejects(
    () => makeAdapter().connect({ instance: baseUrlOf(server), token: 'bad' }),
    /令牌验证失败/
  );
});

test('publishPost：图片上传 + 状态发布', async (t) => {
  let mediaUploaded = false;
  const server = await startMock((req) => {
    if (req.path === '/api/v2/media') {
      mediaUploaded = true;
      assert.match(req.headers['content-type'], /multipart\/form-data/);
      assert.ok(req.body.includes('filename="pixel.png"'));
      return { body: { id: 'media-9' } };
    }
    if (req.path === '/api/v1/statuses') {
      assert.equal(req.json.status, 'hello mastodon');
      assert.deepEqual(req.json.media_ids, ['media-9']);
      assert.equal(req.json.visibility, 'public');
      return { body: { id: '1001', url: 'https://m.example/@alice/1001' } };
    }
    return null;
  });
  t.after(() => server.close());
  const base = baseUrlOf(server);

  const r = await makeAdapter().publishPost(makeAccount(base), { text: 'hello mastodon', media: [makeMedia()] });
  assert.ok(mediaUploaded);
  assert.equal(r.platformPostId, '1001');
  assert.equal(r.permalink, 'https://m.example/@alice/1001');
});

test('publishThread：in_reply_to_id 串联', async (t) => {
  const bodies = [];
  const server = await startMock((req) => {
    if (req.path === '/api/v1/statuses') {
      bodies.push(req.json);
      return { body: { id: String(1000 + bodies.length), url: 'https://m.example/@alice/' + (1000 + bodies.length) } };
    }
    return null;
  });
  t.after(() => server.close());
  const base = baseUrlOf(server);

  await makeAdapter().publishThread(makeAccount(base), [{ text: '一' }, { text: '二' }]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].in_reply_to_id, undefined);
  assert.equal(bodies[1].in_reply_to_id, '1001');
});
