/**
 * test/x.test.js — X 适配器（mock HTTP，离线运行）
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XAdapter = require('../server/platforms/x');
const { startMock, baseUrlOf, PNG_1PX_BASE64 } = require('./helpers');

function makeAdapter(base, redirectUri) {
  return new XAdapter({
    x: {
      clientId: 'test-client-id',
      clientSecret: '',
      authBaseUrl: base,
      apiBaseUrl: base,
      uploadBaseUrl: base,
      callbackUrl: 'http://localhost:8787/auth/x/callback',
      redirectUri: redirectUri || 'http://127.0.0.1:8787/auth/x/callback'
    }
  });
}

function tmpPngFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-x-'));
  const p = path.join(dir, 'pixel.png');
  fs.writeFileSync(p, Buffer.from(PNG_1PX_BASE64, 'base64'));
  return p;
}

test('buildAuthorizeUrl 带 PKCE / state / scope', () => {
  const adapter = makeAdapter('https://twitter.com');
  const url = adapter.buildAuthorizeUrl({ state: 'st1', codeChallenge: 'ch1' });
  assert.ok(url.startsWith('https://twitter.com/i/oauth2/authorize'));
  assert.ok(url.includes('response_type=code'));
  assert.ok(url.includes('code_challenge=ch1'));
  assert.ok(url.includes('code_challenge_method=S256'));
  assert.ok(url.includes('state=st1'));
  assert.ok(url.includes('tweet.write'));
  assert.ok(url.includes('offline.access'));
});

test('redirect_uri 使用平台专属配置（默认 127.0.0.1，可 env 覆盖）', () => {
  // 默认：127.0.0.1（X 控制台拒绝 localhost）
  let url = makeAdapter('https://twitter.com').buildAuthorizeUrl({ state: 's', codeChallenge: 'c' });
  assert.ok(url.includes(encodeURIComponent('http://127.0.0.1:8787/auth/x/callback')));

  // 覆盖：例如隧道 HTTPS 地址
  url = makeAdapter('https://twitter.com', 'https://tunnel.example.com/auth/x/callback').buildAuthorizeUrl({ state: 's', codeChallenge: 'c' });
  assert.ok(url.includes(encodeURIComponent('https://tunnel.example.com/auth/x/callback')));
  assert.equal(makeAdapter('x').redirectUri, 'http://127.0.0.1:8787/auth/x/callback');
});

test('limits 暴露 X 规则', () => {
  const lim = makeAdapter('x').limits();
  assert.equal(lim.maxChars, 280);
  assert.equal(lim.weighted, true);
  assert.equal(lim.maxImages, 4);
  assert.equal(lim.maxImageBytes, 5 * 1024 * 1024);
  assert.ok(lim.imageMimes.includes('image/png'));
});

test('exchangeCode → tokens；fetchProfile → 身份', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/2/oauth2/token' && req.method === 'POST') {
      assert.equal(req.form.grant_type, 'authorization_code');
      assert.equal(req.form.code_verifier, 'verifier-1');
      assert.equal(req.form.client_id, 'test-client-id');
      assert.equal(req.form.redirect_uri, 'http://127.0.0.1:8787/auth/x/callback');
      return { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 7200, token_type: 'bearer' } };
    }
    if (req.path === '/2/users/me') {
      assert.equal(req.headers.authorization, 'Bearer at-1');
      return { body: { data: { id: '42', username: 'tester', name: 'Tester' } } };
    }
    return null;
  });
  t.after(() => server.close());
  const adapter = makeAdapter(baseUrlOf(server));

  const tokens = await adapter.exchangeCode({ code: 'code-1', codeVerifier: 'verifier-1' });
  assert.equal(tokens.accessToken, 'at-1');
  assert.equal(tokens.refreshToken, 'rt-1');
  assert.ok(tokens.expiresAt > Date.now());
  assert.ok(tokens.expiresAt <= Date.now() + 7200 * 1000 + 1000);

  const profile = await adapter.fetchProfile('at-1');
  assert.deepEqual(profile, { externalId: '42', username: 'tester', displayName: 'Tester' });
});

test('refreshToken 刷新访问令牌', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/2/oauth2/token' && req.method === 'POST') {
      assert.equal(req.form.grant_type, 'refresh_token');
      assert.equal(req.form.refresh_token, 'rt-old');
      return { body: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 7200 } };
    }
    return null;
  });
  t.after(() => server.close());
  const tokens = await makeAdapter(baseUrlOf(server)).refreshToken({ refreshToken: 'rt-old' });
  assert.equal(tokens.accessToken, 'at-new');
});

test('publishPost 发单条（无媒体）', async (t) => {
  const tweetBodies = [];
  const server = await startMock((req) => {
    if (req.path === '/2/tweets' && req.method === 'POST') {
      tweetBodies.push(req.json);
      return { body: { data: { id: '1001' } } };
    }
    return null;
  });
  t.after(() => server.close());
  const adapter = makeAdapter(baseUrlOf(server));
  const r = await adapter.publishPost({ username: 'tester', tokens: { accessToken: 'at' } }, { text: '你好 世界' });
  assert.equal(r.platformPostId, '1001');
  assert.equal(r.permalink, 'https://x.com/tester/status/1001');
  assert.deepEqual(tweetBodies[0], { text: '你好 世界' });
});

test('publishPost 上传图片并挂 media_ids', async (t) => {
  let uploaded = null;
  const tweetBodies = [];
  const server = await startMock((req) => {
    if (req.path === '/1.1/media/upload.json' && req.method === 'POST') {
      uploaded = req.form.media_data;
      return { body: { media_id_string: '111', media_id: 111 } };
    }
    if (req.path === '/2/tweets' && req.method === 'POST') {
      tweetBodies.push(req.json);
      return { body: { data: { id: '1002' } } };
    }
    return null;
  });
  t.after(() => server.close());
  const p = tmpPngFile();
  const r = await makeAdapter(baseUrlOf(server)).publishPost(
    { username: 'tester', tokens: { accessToken: 'at' } },
    { text: '带图', media: [{ id: 'm1', path: p, mime: 'image/png', name: 'pixel.png', size: 70, url: 'http://x/media/m1.png' }] }
  );
  assert.equal(uploaded, PNG_1PX_BASE64);
  assert.deepEqual(tweetBodies[0].media, { media_ids: ['111'] });
  assert.equal(r.platformPostId, '1002');
});

test('v1.1 上传失败时回退 v2 分片上传', async (t) => {
  const steps = [];
  let mediaId = null;
  const server = await startMock(async (req) => {
    if (req.path === '/1.1/media/upload.json') { steps.push('v1.1-fail'); return { status: 500, body: { error: 'boom' } }; }
    if (req.path === '/2/media/upload/initialize') { steps.push('init'); return { body: { data: { id: 'mid-1' } } }; }
    if (req.path === '/2/media/upload/mid-1/append') { steps.push('append'); return { body: { data: {} } }; }
    if (req.path === '/2/media/upload/mid-1/finalize') { steps.push('finalize'); return { body: { data: { id: 'mid-1' } } }; }
    if (req.path === '/2/tweets') { return { body: { data: { id: '1003' } } }; }
    return null;
  });
  t.after(() => server.close());
  const p = tmpPngFile();
  const r = await makeAdapter(baseUrlOf(server)).publishPost(
    { username: 'tester', tokens: { accessToken: 'at' } },
    { text: '带图', media: [{ id: 'm1', path: p, mime: 'image/png', name: 'pixel.png', size: 70, url: '' }] }
  );
  assert.deepEqual(steps, ['v1.1-fail', 'init', 'append', 'finalize']);
  assert.equal(r.platformPostId, '1003');
});

test('publishThread 用 reply 链串联多条', async (t) => {
  const bodies = [];
  let counter = 1000;
  const server = await startMock((req) => {
    if (req.path === '/2/tweets' && req.method === 'POST') {
      bodies.push(req.json);
      return { body: { data: { id: String(++counter) } } };
    }
    return null;
  });
  t.after(() => server.close());
  const results = await makeAdapter(baseUrlOf(server)).publishThread(
    { username: 'tester', tokens: { accessToken: 'at' } },
    [{ text: '第一段' }, { text: '第二段', media: [] }, { text: '第三段' }]
  );
  assert.equal(results.length, 3);
  assert.equal(results[0].platformPostId, '1001');
  assert.equal(results[2].platformPostId, '1003');
  // 第 2、3 条带 reply 链
  assert.equal(bodies[1].reply.in_reply_to_tweet_id, '1001');
  assert.equal(bodies[2].reply.in_reply_to_tweet_id, '1002');
  assert.ok(!bodies[0].reply);
});

test('发帖失败抛出可读错误', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/2/tweets') return { status: 403, body: { detail: 'Forbidden' } };
    return null;
  });
  t.after(() => server.close());
  await assert.rejects(
    () => makeAdapter(baseUrlOf(server)).publishPost({ username: 't', tokens: { accessToken: 'a' } }, { text: 'x' }),
    /X 发帖失败: HTTP 403/
  );
});
