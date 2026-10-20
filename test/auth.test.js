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

test('手动令牌连接 Threads：验证资料后落库（绕开 OAuth 回调）', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/v1.0/me') {
      assert.equal(req.query.get('access_token'), 'THQ_long_lived_token');
      return { body: { id: '17800000000000000', username: 'kevinzch' } };
    }
    return null;
  });
  t.after(() => server.close());

  const store = makeStore();
  const accounts = new AccountService(store, {
    threads: {
      clientId: 'tid', clientSecret: 'secret', apiBaseUrl: baseUrlOf(server),
      redirectUri: 'https://tunnel.example.com/auth/threads/callback'
    }
  });

  const view = await accounts.connectWithManualToken('threads', 'THQ_long_lived_token');
  assert.equal(view.id, 'threads:17800000000000000');
  assert.equal(view.username, 'kevinzch');
  assert.equal(view.manual, true);

  const stored = store.accounts.get('threads:17800000000000000');
  assert.equal(stored.tokens.accessToken, 'THQ_long_lived_token');
  assert.equal(stored.tokens.refreshToken, 'THQ_long_lived_token');
  assert.ok(stored.tokens.expiresAt - Date.now() > 58 * 24 * 3600 * 1000);

  assert.equal(accounts.listAccounts().filter((a) => a.platform === 'threads').length, 1);
});

test('手动令牌：无效令牌返回 401 且不落库', async (t) => {
  const server = await startMock((req) => {
    if (req.path === '/v1.0/me') return { status: 401, body: { error: { message: 'Invalid OAuth access token' } } };
    return null;
  });
  t.after(() => server.close());

  const store = makeStore();
  const accounts = new AccountService(store, {
    threads: { clientId: 'tid', clientSecret: 's', apiBaseUrl: baseUrlOf(server), redirectUri: 'https://x.example.com/cb' }
  });

  await assert.rejects(
    () => accounts.connectWithManualToken('threads', 'bad_token_value_123456'),
    /令牌验证失败/
  );
  assert.equal(store.accounts.list().length, 0);
});

test('手动令牌：仅支持 Threads；格式校验', async () => {
  const store = makeStore();
  const accounts = new AccountService(store, {
    x: { clientId: 'cid', apiBaseUrl: 'http://mock.invalid', redirectUri: 'http://127.0.0.1:8787/auth/x/callback' },
    threads: { clientId: 'tid', clientSecret: 's', apiBaseUrl: 'http://mock.invalid', redirectUri: 'https://x.example.com/cb' }
  });

  await assert.rejects(
    () => accounts.connectWithManualToken('x', 'some_long_enough_token_value'),
    /仅支持 Threads/
  );
  await assert.rejects(
    () => accounts.connectWithManualToken('threads', 'short'),
    /格式不正确/
  );
  await assert.rejects(
    () => accounts.connectWithManualToken('threads', ''),
    /格式不正确/
  );
});

test('publicView：access token 过期但有 refresh token → refreshable（不应显示为失效）', () => {
  const svc = new AccountService(makeStore(), { x: { clientId: 'x' } });
  const base = {
    id: 'x:1', platform: 'x', username: 'u', displayName: 'U',
    tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 1000 }
  };
  const v = svc.publicView(base);
  assert.equal(v.tokenStatus, 'refreshable');
  assert.equal(v.tokenExpired, false, '可自动续期时不应标记为已失效');
  assert.ok(v.tokenExpiresAt);
});

test('publicView：过期且无 refresh token → expired', () => {
  const svc = new AccountService(makeStore(), {});
  const v = svc.publicView({
    id: 'x:2', platform: 'x', username: 'u', displayName: 'U',
    tokens: { accessToken: 'a', expiresAt: Date.now() - 1000 }
  });
  assert.equal(v.tokenStatus, 'expired');
  assert.equal(v.tokenExpired, true);
});

test('publicView：未过期 / 无过期时间 → ok', () => {
  const svc = new AccountService(makeStore(), {});
  const fresh = svc.publicView({
    id: 'bluesky:1', platform: 'bluesky', username: 'u', displayName: 'U',
    tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 }
  });
  assert.equal(fresh.tokenStatus, 'ok');

  const masto = svc.publicView({
    id: 'mastodon:1', platform: 'mastodon', username: 'u', displayName: 'U',
    tokens: { accessToken: 'a', expiresAt: null }
  });
  assert.equal(masto.tokenStatus, 'ok');
  assert.equal(masto.tokenExpired, false);
});

test('publicView：Threads 用 access token 自身续期 → 过期时仍为 refreshable', () => {
  const svc = new AccountService(makeStore(), {});
  const v = svc.publicView({
    id: 'threads:1', platform: 'threads', username: 'u', displayName: 'U',
    tokens: { accessToken: 'same', refreshToken: 'same', expiresAt: Date.now() - 1000 }
  });
  assert.equal(v.tokenStatus, 'refreshable');
  assert.equal(v.tokenExpired, false);
});

test('publicView：refresh token 本身过期 → expired（即使有 refreshToken）', () => {
  const svc = new AccountService(makeStore(), {});
  const v = svc.publicView({
    id: 'bluesky:9', platform: 'bluesky', username: 'u', displayName: 'U',
    tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 1000, refreshExpiresAt: Date.now() - 5000 }
  });
  assert.equal(v.tokenStatus, 'expired');
  assert.equal(v.tokenExpired, true);
});

test('publicView：续期凭证未到期 → refreshable，并暴露 refreshExpiresAt', () => {
  const svc = new AccountService(makeStore(), {});
  const until = Date.now() + 30 * 24 * 3600 * 1000;
  const v = svc.publicView({
    id: 'bluesky:10', platform: 'bluesky', username: 'u', displayName: 'U',
    tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 1000, refreshExpiresAt: until }
  });
  assert.equal(v.tokenStatus, 'refreshable');
  assert.equal(v.refreshExpiresAt, new Date(until).toISOString());
});

test('ensureFreshToken：续期失败时标记账号需重新授权', async () => {
  const store = makeStore();
  const accounts = new AccountService(store, {
    bluesky: { service: 'http://127.0.0.1:1' } // 不可达 → 刷新必然失败
  });
  const acc = await store.accounts.insert({
    id: 'bluesky:bad', platform: 'bluesky', externalId: 'did:bad', username: 'u', displayName: 'U',
    tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 1000, pds: 'http://127.0.0.1:1' },
    enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });

  await assert.rejects(() => accounts.ensureFreshToken(acc));
  const updated = store.accounts.get('bluesky:bad');
  assert.equal(updated.reauthRequired, true);
  assert.ok(updated.reauthReason);
  assert.equal(accounts.publicView(updated).tokenStatus, 'expired');
});
