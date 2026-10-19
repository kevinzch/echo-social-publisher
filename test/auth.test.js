/**
 * test/auth.test.js — OAuth 回调完整链路（startAuth → handleCallback → 落库）
 * 覆盖 2026-10-19 修复的回归：exchangeCode 只返回 tokens，profile 需单独拉取
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AccountService } = require('../server/auth');
const { Store } = require('../server/store');
const { startMock, baseUrlOf, tmpDir } = require('./helpers');

function makeStore() {
  return new Store(tmpDir('echo-auth-'));
}

test('X 回调：code→token→users/me→账号落库（令牌入库但不外泄）', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/2/oauth2/token' && req.method === 'POST') {
      assert.equal(req.form.grant_type, 'authorization_code');
      assert.equal(req.form.redirect_uri, 'http://127.0.0.1:8787/auth/x/callback');
      return { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 7200 } };
    }
    if (req.path === '/2/users/me') {
      assert.equal(req.headers.authorization, 'Bearer at-1');
      return { body: { data: { id: '42', username: 'tester', name: 'Tester' } } };
    }
    return null;
  });
  t.after(() => server.close());

  const base = baseUrlOf(server);
  const store = makeStore();
  const accounts = new AccountService(store, {
    x: {
      clientId: 'cid', clientSecret: '', authBaseUrl: base,
      apiBaseUrl: base, uploadBaseUrl: base,
      callbackUrl: 'http://127.0.0.1:8787/auth/x/callback',
      redirectUri: 'http://127.0.0.1:8787/auth/x/callback'
    }
  });

  // startAuth 生成 state（内存态）
  const { state } = accounts.startAuth('x');
  assert.ok(state);

  // handleCallback 完整链路
  const view = await accounts.handleCallback('x', { code: 'c1', state });
  assert.equal(view.id, 'x:42');
  assert.equal(view.username, 'tester');
  assert.equal(view.displayName, 'Tester');
  assert.equal(view.tokenExpired, false);
  assert.equal(view.tokens, undefined, 'publicView 不得外泄令牌');

  // 令牌已入库
  const stored = store.accounts.get('x:42');
  assert.equal(stored.tokens.accessToken, 'at-1');
  assert.equal(stored.tokens.refreshToken, 'rt-1');

  // state 一次性：重放同一 state 应失败
  await assert.rejects(
    () => accounts.handleCallback('x', { code: 'c1', state }),
    /state 无效或已过期/
  );

  // 列表与解绑
  assert.equal(accounts.listAccounts().length, 1);
  assert.equal(await accounts.disconnect('x:42'), true);
  assert.equal(accounts.listAccounts().length, 0);
});

test('Threads 回调：短期→长期 token→me→落库', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/oauth/access_token' && req.method === 'POST') {
      return { body: { access_token: 'short-1', expires_in: 3600 } };
    }
    if (req.path === '/access_token') {
      assert.equal(req.query.get('grant_type'), 'th_exchange_token');
      return { body: { access_token: 'long-1', expires_in: 5183940 } };
    }
    if (req.path === '/v1.0/me') {
      assert.equal(req.query.get('access_token'), 'long-1');
      return { body: { id: '99', username: 'thtester' } };
    }
    return null;
  });
  t.after(() => server.close());

  const base = baseUrlOf(server);
  const store = makeStore();
  const accounts = new AccountService(store, {
    threads: {
      clientId: 'tid', clientSecret: 'tsecret', apiBaseUrl: base,
      callbackUrl: 'http://127.0.0.1:8787/auth/threads/callback',
      redirectUri: 'https://tunnel.example.com/auth/threads/callback'
    }
  });

  const { state } = accounts.startAuth('threads');
  const view = await accounts.handleCallback('threads', { code: 'c1', state });
  assert.equal(view.id, 'threads:99');
  assert.equal(view.username, 'thtester');

  const stored = store.accounts.get('threads:99');
  assert.equal(stored.tokens.accessToken, 'long-1'); // 长期 token 入库
  assert.ok(stored.tokens.expiresAt - Date.now() > 59 * 24 * 3600 * 1000);
});

test('非法/过期 state 被拒绝', async () => {
  const store = makeStore();
  const accounts = new AccountService(store, {
    x: { clientId: 'cid', apiBaseUrl: 'http://mock.invalid', redirectUri: 'http://127.0.0.1:8787/auth/x/callback' }
  });
  await assert.rejects(
    () => accounts.handleCallback('x', { code: 'c', state: 'never-issued' }),
    /state 无效或已过期/
  );
});

test('未配置凭证时 startAuth 报 NOT_CONFIGURED', () => {
  const store = makeStore();
  const accounts = new AccountService(store, {
    x: { clientId: '', apiBaseUrl: 'http://mock.invalid', redirectUri: '' }
  });
  assert.throws(() => accounts.startAuth('x'), /未配置/);
});

test('ensureFreshToken：X 令牌临期自动刷新，Threads 临期刷新', async (t) => {
  let refreshCalls = 0;
  const server = await startMock((req) => {
    if (req.path === '/2/oauth2/token' && req.method === 'POST') {
      refreshCalls++;
      return { body: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 7200 } };
    }
    if (req.path === '/refresh_access_token') {
      refreshCalls++;
      return { body: { access_token: 'long-new', expires_in: 5183940 } };
    }
    return null;
  });
  t.after(() => server.close());
  const base = baseUrlOf(server);

  const store = makeStore();
  const accounts = new AccountService(store, {
    x: { clientId: 'cid', apiBaseUrl: base, redirectUri: 'http://127.0.0.1:8787/auth/x/callback' },
    threads: { clientId: 'tid', clientSecret: 's', apiBaseUrl: base, redirectUri: 'http://127.0.0.1:8787/auth/threads/callback' }
  });

  // X：5 分钟后过期（<10 分钟窗口）→ 刷新
  const xAcc = await store.accounts.insert({
    id: 'x:1', platform: 'x', externalId: '1', username: 'u', displayName: 'U',
    tokens: { accessToken: 'old', refreshToken: 'rt', expiresAt: Date.now() + 5 * 60_000 },
    enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  const xFresh = await accounts.ensureFreshToken(xAcc);
  assert.equal(xFresh.tokens.accessToken, 'at-new');

  // Threads：3 天后过期（<7 天窗口）→ 刷新
  const tAcc = await store.accounts.insert({
    id: 'threads:1', platform: 'threads', externalId: '1', username: 'u', displayName: 'U',
    tokens: { accessToken: 'long-old', refreshToken: 'long-old', expiresAt: Date.now() + 3 * 24 * 3600_000 },
    enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  const tFresh = await accounts.ensureFreshToken(tAcc);
  assert.equal(tFresh.tokens.accessToken, 'long-new');

  // 令牌充足时不刷新
  const before = refreshCalls;
  const okAcc = await store.accounts.insert({
    id: 'x:2', platform: 'x', externalId: '2', username: 'u2', displayName: 'U2',
    tokens: { accessToken: 'fine', refreshToken: 'rt2', expiresAt: Date.now() + 3600_000 },
    enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  await accounts.ensureFreshToken(okAcc);
  assert.equal(refreshCalls, before);
});
