/**
 * test/threads.test.js — Threads 适配器（mock HTTP，离线运行）
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ThreadsAdapter = require('../server/platforms/threads');
const { startMock, baseUrlOf } = require('./helpers');

function makeAdapter(base, imageBaseUrl, redirectUri) {
  return new ThreadsAdapter({
    threads: {
      clientId: 'tid',
      clientSecret: 'tsecret',
      apiBaseUrl: base,
      callbackUrl: 'http://127.0.0.1:8787/auth/threads/callback',
      imageBaseUrl: imageBaseUrl || 'https://public.example.com',
      redirectUri: redirectUri || 'http://127.0.0.1:8787/auth/threads/callback'
    }
  });
}

test('buildAuthorizeUrl 带 scope / state', () => {
  const url = makeAdapter('https://graph.threads.net').buildAuthorizeUrl({ state: 's1' });
  assert.ok(url.startsWith('https://threads.net/oauth/authorize'));
  assert.ok(url.includes('client_id=tid'));
  assert.ok(url.includes('redirect_uri=http%3A%2F%2F127.0.0.1%3A8787%2Fauth%2Fthreads%2Fcallback'));
  assert.ok(url.includes('threads_content_publish'));
  assert.ok(url.includes('state=s1'));
  assert.ok(url.includes('response_type=code'));
});

test('redirect_uri 使用平台专属配置（Meta 强制 HTTPS，可 env 覆盖为隧道地址）', () => {
  // 默认跟随 APP_BASE_URL（本机 HTTP 无法用于 Meta，需隧道覆盖）
  assert.equal(makeAdapter('x').redirectUri, 'http://127.0.0.1:8787/auth/threads/callback');

  // 覆盖为隧道 HTTPS 地址
  const adapter = makeAdapter('x', 'https://public.example.com', 'https://tunnel.example.com/auth/threads/callback');
  const url = adapter.buildAuthorizeUrl({ state: 's1' });
  assert.ok(url.includes(encodeURIComponent('https://tunnel.example.com/auth/threads/callback')));
});

test('limits 暴露 Threads 规则', () => {
  const lim = makeAdapter('x').limits();
  assert.equal(lim.maxChars, 500);
  assert.equal(lim.weighted, false);
  assert.equal(lim.maxImages, 10);
  assert.equal(lim.dailyPostCap, 250);
});

test('exchangeCode：短期 token → 长期 token', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/oauth/access_token' && req.method === 'POST') {
      assert.equal(req.form.grant_type, 'authorization_code');
      assert.equal(req.form.client_secret, 'tsecret');
      assert.equal(req.form.redirect_uri, 'http://127.0.0.1:8787/auth/threads/callback');
      return { body: { access_token: 'short-1', token_type: 'bearer', expires_in: 3600 } };
    }
    if (req.path === '/access_token') {
      assert.equal(req.query.get('grant_type'), 'th_exchange_token');
      return { body: { access_token: 'long-1', token_type: 'bearer', expires_in: 5183940 } };
    }
    return null;
  });
  t.after(() => server.close());
  const tokens = await makeAdapter(baseUrlOf(server)).exchangeCode({ code: 'c1' });
  assert.equal(tokens.accessToken, 'long-1');
  assert.equal(tokens.refreshToken, 'long-1');
  // 约 60 天
  assert.ok(tokens.expiresAt - Date.now() > 59 * 24 * 3600 * 1000);
  assert.ok(tokens.expiresAt - Date.now() < 60 * 24 * 3600 * 1000 + 5000);
});

test('refreshToken 通过 th_refresh_token 续期', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/refresh_access_token') {
      assert.equal(req.query.get('grant_type'), 'th_refresh_token');
      assert.equal(req.query.get('access_token'), 'long-1');
      return { body: { access_token: 'long-2', expires_in: 5183940 } };
    }
    return null;
  });
  t.after(() => server.close());
  const tokens = await makeAdapter(baseUrlOf(server)).refreshToken({ accessToken: 'long-1' });
  assert.equal(tokens.accessToken, 'long-2');
});

test('fetchProfile 返回 Threads 身份', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/v1.0/me') {
      assert.equal(req.query.get('access_token'), 'tok');
      return { body: { id: '99', username: 'thtester' } };
    }
    return null;
  });
  t.after(() => server.close());
  const p = await makeAdapter(baseUrlOf(server)).fetchProfile('tok');
  assert.deepEqual(p, { externalId: '99', username: 'thtester', displayName: 'thtester' });
});

test('publishPost 文本：TEXT 容器 → 发布 → permalink', async (t) => {
  const containerBodies = [];
  const server = await startMock((req) => {
    if (req.path === '/v1.0/me/threads' && req.method === 'POST') {
      containerBodies.push(req.form);
      return { body: { id: 'c1' } };
    }
    if (req.path === '/v1.0/me/threads_publish' && req.method === 'POST') {
      assert.equal(req.form.creation_id, 'c1');
      return { body: { id: 'pub-1' } };
    }
    if (req.path === '/v1.0/c1' && req.method === 'GET') return { body: { status: 'FINISHED' } };
    if (req.path === '/v1.0/pub-1') return { body: { permalink: 'https://www.threads.net/t/abc123' } };
    return null;
  });
  t.after(() => server.close());
  const r = await makeAdapter(baseUrlOf(server)).publishPost({ username: 'thtester', tokens: { accessToken: 'tok' } }, { text: 'hello threads' });
  assert.deepEqual(r, { platformPostId: 'pub-1', permalink: 'https://www.threads.net/t/abc123' });
  assert.equal(containerBodies[0].media_type, 'TEXT');
  assert.equal(containerBodies[0].text, 'hello threads');
  assert.equal(containerBodies[0].access_token, 'tok');
});

test('publishPost 单图：IMAGE 容器带公网 image_url 并等待处理', async (t) => {
  const containers = [];
  let waited = false;
  const server = await startMock((req) => {
    if (req.path === '/v1.0/me/threads' && req.method === 'POST') {
      containers.push(req.form);
      return { body: { id: 'c-img' } };
    }
    if (req.path === '/v1.0/c-img' && req.method === 'GET') { waited = true; return { body: { status: 'FINISHED' } }; }
    if (req.path === '/v1.0/me/threads_publish') return { body: { id: 'pub-img' } };
    if (req.path === '/v1.0/pub-img') return { body: {} };
    return null;
  });
  t.after(() => server.close());
  const r = await makeAdapter(baseUrlOf(server), 'https://public.example.com').publishPost(
    { username: 'thtester', tokens: { accessToken: 'tok' } },
    { text: '配图', media: [{ id: 'm1', ext: '.png', url: 'https://public.example.com/media/m1.png', mime: 'image/png', size: 70 }] }
  );
  assert.equal(containers[0].media_type, 'IMAGE');
  assert.equal(containers[0].image_url, 'https://public.example.com/media/m1.png');
  assert.equal(containers[0].text, '配图');
  assert.ok(waited, '应等待容器处理完成');
  assert.equal(r.platformPostId, 'pub-img');
});

test('publishPost 多图：儿童 IMAGE 容器 + CAROUSEL 父容器', async (t) => {
  const containers = [];
  let seq = 0;
  const server = await startMock((req) => {
    if (req.path === '/v1.0/me/threads' && req.method === 'POST') {
      containers.push({ type: req.form.media_type, children: req.form.children, urls: req.form.image_url });
      return { body: { id: 'k' + (++seq) } };
    }
    if (req.method === 'GET' && req.path.startsWith('/v1.0/k')) return { body: { status: 'FINISHED' } };
    if (req.path === '/v1.0/me/threads_publish') return { body: { id: 'pub-c' } };
    if (req.method === 'GET') return { body: { permalink: 'https://www.threads.net/t/c' } };
    return null;
  });
  t.after(() => server.close());
  const r = await makeAdapter(baseUrlOf(server)).publishPost(
    { username: 'thtester', tokens: { accessToken: 'tok' } },
    {
      text: '九宫格',
      media: [
        { id: 'a', url: 'https://public.example.com/media/a.png' },
        { id: 'b', url: 'https://public.example.com/media/b.png' },
        { id: 'c', url: 'https://public.example.com/media/c.png' }
      ]
    }
  );
  assert.equal(containers.length, 4);
  assert.equal(containers[0].type, 'IMAGE');
  assert.equal(containers[1].type, 'IMAGE');
  assert.equal(containers[2].type, 'IMAGE');
  assert.equal(containers[3].type, 'CAROUSEL');
  assert.equal(containers[3].children, 'k1,k2,k3');
  assert.equal(r.platformPostId, 'pub-c');
});

test('publishThread：每段用 reply_to_id 回复上一条，形成 thread 链', async (t) => {
  const forms = [];
  let n = 0;
  const server = await startMock((req) => {
    if (req.path === '/v1.0/me/threads' && req.method === 'POST') {
      forms.push(req.form);
      return { body: { id: 'c' + (++n) } };
    }
    if (req.path === '/v1.0/me/threads_publish') return { body: { id: 'p' + n } };
    if (req.method === 'GET') return { body: { status: 'FINISHED', permalink: 'https://www.threads.net/t/p' + n } };
    return null;
  });
  t.after(() => server.close());
  const results = await makeAdapter(baseUrlOf(server)).publishThread(
    { username: 'thtester', tokens: { accessToken: 'tok' } },
    [{ text: '段落一' }, { text: '段落二' }, { text: '段落三' }]
  );

  assert.deepEqual(forms.map((f) => f.text), ['段落一', '段落二', '段落三']);
  // 首条不带 reply_to_id，后续每条回复上一条已发布的帖子 id
  assert.equal(forms[0].reply_to_id, undefined);
  assert.equal(forms[1].reply_to_id, 'p1');
  assert.equal(forms[2].reply_to_id, 'p2');
  assert.equal(results.length, 3);
  assert.equal(results[2].platformPostId, 'p3');
});

test('publishPost：带图 + replyToId 时容器同时带 image_url 与 reply_to_id', async (t) => {
  let form = null;
  let n = 0;
  const server = await startMock((req) => {
    if (req.path === '/v1.0/me/threads' && req.method === 'POST') {
      form = req.form;
      return { body: { id: 'c' + (++n) } };
    }
    if (req.path === '/v1.0/me/threads_publish') return { body: { id: 'p' + n } };
    if (req.method === 'GET') return { body: { status: 'FINISHED', permalink: 'https://www.threads.net/t/p' + n } };
    return null;
  });
  t.after(() => server.close());

  await makeAdapter(baseUrlOf(server), 'https://public.example.com').publishPost(
    { username: 'u', tokens: { accessToken: 'tok' } },
    { text: '带图回复', media: [{ id: 'm1', ext: '.jpg' }], replyToId: 'p-root' }
  );
  assert.equal(form.media_type, 'IMAGE');
  assert.equal(form.reply_to_id, 'p-root');
  assert.ok(form.image_url.includes('/media/m1.jpg'));
});

test('媒体处理失败（ERROR 状态）抛出可读错误', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/v1.0/me/threads' && req.method === 'POST') return { body: { id: 'c1' } };
    if (req.method === 'GET' && req.path === '/v1.0/c1') return { body: { status: 'ERROR' } };
    return null;
  });
  t.after(() => server.close());
  await assert.rejects(
    () => makeAdapter(baseUrlOf(server)).publishPost(
      { username: 'u', tokens: { accessToken: 'tok' } },
      { text: 'x', media: [{ id: 'a', url: 'https://public.example.com/media/a.png' }] }
    ),
    /Threads 媒体处理失败/
  );
});
