/**
 * test/api.test.js — REST API 与端到端发布流水线（mock X 服务）
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/main');
const baseConfig = require('../server/config');
const { tmpDir, pngRecord, startMock, baseUrlOf } = require('./helpers');

async function startTestApp(overrides) {
  const dataDir = tmpDir('echo-api-');
  const cfg = JSON.parse(JSON.stringify(baseConfig));
  cfg.dataDir = dataDir;
  cfg.port = 0;
  cfg.x = { ...cfg.x, clientId: '', clientSecret: '' };
  cfg.threads = { ...cfg.threads, clientId: '', clientSecret: '' };
  cfg.schedulerIntervalMs = 30_000;
  Object.assign(cfg, overrides || {});

  const app = createApp({ config: cfg });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, cfg, base };
}

async function req(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

function seedAccount(app, id, platform, extra) {
  return app.store.accounts.insert({
    id,
    platform,
    externalId: id.split(':')[1],
    username: 'tester',
    displayName: 'Tester',
    tokens: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(extra || {})
  });
}

test('GET /api/config 返回平台清单与限额', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  const r = await req(base, 'GET', '/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.data.platforms.length, 4);
  const bsky = r.data.platforms.find((p) => p.id === 'bluesky');
  assert.equal(bsky.limits.maxChars, 300);
  const masto = r.data.platforms.find((p) => p.id === 'mastodon');
  assert.equal(masto.limits.maxChars, 500);
  const x = r.data.platforms.find((p) => p.id === 'x');
  assert.equal(x.limits.maxChars, 280);
  assert.equal(x.limits.maxImages, 4);
  assert.equal(x.configured, false); // 未配置凭证
});

test('静态资源：首页 / shared 库 / SPA 回退 / 404', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());

  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Echo/);

  const shared = await fetch(base + '/shared/chars.js');
  assert.equal(shared.status, 200);
  assert.match(await shared.text(), /EchoChars/);

  const appJs = await fetch(base + '/app.js');
  assert.equal(appJs.status, 200);
  assert.match(await appJs.text(), /currentSegments/);

  const spa = await fetch(base + '/some/spa/route');
  assert.equal(spa.status, 200); // SPA fallback

  const notFound = await req(base, 'GET', '/api/no-such-thing');
  assert.equal(notFound.status, 404);
});

test('草稿 CRUD + 服务端按 --- 分段', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());

  const created = await req(base, 'POST', '/api/drafts', {
    text: '第一段内容\n\n---\n\n第二段内容\n\n---\n\n第三段',
    accountIds: []
  });
  assert.equal(created.status, 200);
  const id = created.data.draft.id;
  assert.equal(created.data.draft.segments.length, 3);
  assert.equal(created.data.draft.segments[0].text, '第一段内容');

  const list = await req(base, 'GET', '/api/drafts');
  assert.equal(list.data.drafts.length, 1);

  const updated = await req(base, 'PUT', '/api/drafts/' + id, {
    title: '新标题',
    segments: [{ text: '只有一段', media: [] }]
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.draft.title, '新标题');
  assert.equal(updated.data.draft.segments.length, 1);

  const del = await req(base, 'DELETE', '/api/drafts/' + id);
  assert.equal(del.status, 200);
  const gone = await req(base, 'GET', '/api/drafts/' + id);
  assert.equal(gone.status, 404);
});

test('媒体上传：成功 / 非法格式 / 超限；/media 可访问', async (t) => {
  const { base, app, cfg } = await startTestApp();
  t.after(() => app.server.close());

  const ok = await req(base, 'POST', '/api/media', pngRecord());
  assert.equal(ok.status, 200);
  // 必须是相对路径：浏览器按当前源加载，不依赖公网隧道在线
  assert.match(ok.data.media.url, /^\/media\/med_.*\.png$/);

  const mediaPath = ok.data.media.url;
  const served = await fetch(base + mediaPath);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');

  // 媒体列表也应带相对 url（刷新页面后缩略图仍可显示）
  const list = await req(base, 'GET', '/api/media-list');
  assert.equal(list.status, 200);
  const item = list.data.media.find((m) => m.id === ok.data.media.id);
  assert.ok(item);
  assert.match(item.url, /^\/media\/med_.*\.png$/);

  const badType = await req(base, 'POST', '/api/media', { name: 'x.pdf', mime: 'application/pdf', dataBase64: 'AAAA' });
  assert.equal(badType.status, 400);

  const cfg2 = { maxUploadBytes: 10 };
  const r2 = await startTestApp({ maxUploadBytes: 10 });
  t.after(() => r2.app.server.close());
  const oversize = await req(r2.base, 'POST', '/api/media', pngRecord('big.png'));
  assert.equal(oversize.status, 400); // 10 字节上限

  // 超大 body（>16MB 的媒体路由上限 = maxUploadBytes + 2MB）应被拒
  const bigBody = {
    name: 'huge.png',
    mime: 'image/png',
    dataBase64: 'A'.repeat(16 * 1024 * 1024 + 100)
  };
  const tooBig = await req(r2.base, 'POST', '/api/media', bigBody);
  assert.ok(tooBig.status === 413 || tooBig.status === 400);
});

test('未连接账号时 schedule 返回明确引导', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  const d = await req(base, 'POST', '/api/drafts', { text: 'hello' });
  const r = await req(base, 'POST', `/api/drafts/${d.data.draft.id}/schedule`, {
    scheduledAt: new Date(Date.now() + 3600_000).toISOString()
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /连接/);
});

test('OAuth start 在未配置凭证时返回 NOT_CONFIGURED', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  const r = await req(base, 'POST', '/api/auth/x/start', {});
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'NOT_CONFIGURED');
});

test('端到端：插入账号 → 定时入队 → publish-now 经 mock X 发布成功', async (t) => {
  const tweets = [];
  const mock = await startMock((r) => {
    if (r.path === '/2/tweets' && r.method === 'POST') {
      tweets.push(r.json);
      return { body: { data: { id: String(1000 + tweets.length) } } };
    }
    return null;
  });
  t.after(() => mock.close());

  const { base, app, cfg } = await startTestApp({
    x: { ...JSON.parse(JSON.stringify(baseConfig.x)), clientId: 'cid', apiBaseUrl: baseUrlOf(mock), uploadBaseUrl: baseUrlOf(mock) }
  });
  t.after(() => app.server.close());

  await seedAccount(app, 'x:1', 'x');

  // 建草稿（两段）
  const d = await req(base, 'POST', '/api/drafts', { text: '第一段\n\n---\n\n第二段' });
  const draftId = d.data.draft.id;

  // 定时入队
  const at = new Date(Date.now() + 3600_000).toISOString();
  const s = await req(base, 'POST', `/api/drafts/${draftId}/schedule`, { scheduledAt: at, accountIds: ['x:1'] });
  assert.equal(s.status, 200);
  assert.equal(s.data.posts.length, 1);
  assert.equal(s.data.posts[0].status, 'pending');
  assert.equal(s.data.posts[0].platform, 'x');

  // 立即发布（草稿有两段 → 两条推文，reply 链）
  const postId = s.data.posts[0].id;
  const pub = await req(base, 'POST', `/api/posts/${postId}/publish-now`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.urls.length, 2);
  assert.equal(pub.data.urls[0], 'https://x.com/tester/status/1001');
  assert.equal(pub.data.urls[1], 'https://x.com/tester/status/1002');

  // 队列状态与记录
  const queue = await req(base, 'GET', '/api/posts?status=published');
  assert.equal(queue.data.posts.length, 1);
  assert.equal(queue.data.posts[0].status, 'published');

  // mock 收到两段（reply 链）
  assert.equal(tweets.length, 2);
  assert.equal(tweets[1].reply.in_reply_to_tweet_id, '1001');

  // 日志
  const logs = await req(base, 'GET', '/api/logs');
  assert.ok(logs.data.logs.some((l) => l.scope === 'publish' && l.message.includes('发布成功')));
});

test('端到端：调度器自动发布到期任务（catch-up）', async (t) => {
  const mock = await startMock((r) => {
    if (r.path === '/2/tweets') return { body: { data: { id: '2001' } } };
    return null;
  });
  t.after(() => mock.close());

  const { base, app } = await startTestApp({
    x: { ...JSON.parse(JSON.stringify(baseConfig.x)), clientId: 'cid', apiBaseUrl: baseUrlOf(mock), uploadBaseUrl: baseUrlOf(mock) }
  });
  t.after(() => app.server.close());

  await seedAccount(app, 'x:1', 'x');
  const d = await req(base, 'POST', '/api/drafts', { text: '定时内容' });
  const at = new Date(Date.now() + 30_000).toISOString();
  const s = await req(base, 'POST', `/api/drafts/${d.data.draft.id}/schedule`, { scheduledAt: at, accountIds: ['x:1'] });

  // 把时间改到今天以前模拟"到期"
  await app.store.posts.update(s.data.posts[0].id, { scheduledAt: new Date(Date.now() - 1000).toISOString() });

  app.scheduler.start(); // 启动即补投
  await new Promise((r) => setTimeout(r, 300));
  app.scheduler.stop();

  const published = await req(base, 'GET', '/api/posts?status=published');
  assert.equal(published.data.posts.length, 1);
  assert.equal(published.data.posts[0].result.urls[0], 'https://x.com/tester/status/2001');
});

test('发布失败 → 队列保留失败原因，可重试', async (t) => {
  const mock = await startMock((r) => {
    if (r.path === '/2/tweets') return { status: 403, body: { detail: 'Forbidden' } };
    return null;
  });
  t.after(() => mock.close());

  const { base, app } = await startTestApp({
    x: { ...JSON.parse(JSON.stringify(baseConfig.x)), clientId: 'cid', apiBaseUrl: baseUrlOf(mock), uploadBaseUrl: baseUrlOf(mock) }
  });
  t.after(() => app.server.close());

  await seedAccount(app, 'x:1', 'x');
  const d = await req(base, 'POST', '/api/drafts', { text: '会失败' });
  const at = new Date(Date.now() + 3600_000).toISOString();
  const s = await req(base, 'POST', `/api/drafts/${d.data.draft.id}/schedule`, { scheduledAt: at, accountIds: ['x:1'] });
  const postId = s.data.posts[0].id;

  const pub = await req(base, 'POST', `/api/posts/${postId}/publish-now`);
  assert.equal(pub.status, 502);
  assert.match(pub.data.error, /发布失败/);

  const failed = await req(base, 'GET', '/api/posts?status=failed');
  assert.equal(failed.data.posts.length, 1);
  assert.ok(failed.data.posts[0].error.includes('X 发帖失败'));

  // 取消仅允许 pending：failed 不能取消
  const cancel = await req(base, 'DELETE', `/api/posts/${postId}`);
  assert.equal(cancel.status, 400);
});

test('设置读写', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  const get = await req(base, 'GET', '/api/settings');
  assert.equal(get.status, 200);
  assert.deepEqual(get.data.settings.defaultQueueTimes, ['09:00', '12:00', '18:00']);

  const put = await req(base, 'PUT', '/api/settings', { defaultQueueTimes: ['08:30', '21:00'], threadsImageBaseUrl: 'https://tunnel.example.com' });
  assert.equal(put.status, 200);
  assert.equal(put.data.threadsImageBaseUrl, 'https://tunnel.example.com');

  const get2 = await req(base, 'GET', '/api/settings');
  assert.deepEqual(get2.data.settings.defaultQueueTimes, ['08:30', '21:00']);
});

test('过去时间不能入队', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  await seedAccount(app, 'x:1', 'x');
  const d = await req(base, 'POST', '/api/drafts', { text: 'hello' });
  const r = await req(base, 'POST', `/api/drafts/${d.data.draft.id}/schedule`, {
    scheduledAt: new Date(Date.now() - 10 * 60_000).toISOString()
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /已过/);
});

test('凭据连接：Bluesky handle + App Password 落库', async (t) => {
  const mock = await startMock((req) => {
    if (req.path === '/xrpc/com.atproto.server.createSession') {
      assert.equal(req.json.identifier, 'bob.bsky.social');
      return { body: { accessJwt: 'a1', refreshJwt: 'r1', did: 'did:plc:bob', handle: 'bob.bsky.social' } };
    }
    if (req.path === '/xrpc/app.bsky.actor.getProfile') return { body: { displayName: 'Bob' } };
    return null;
  });
  t.after(() => mock.close());

  const { base, app } = await startTestApp({ bluesky: { service: baseUrlOf(mock) } });
  t.after(() => app.server.close());

  const r = await req(base, 'POST', '/api/accounts/manual', {
    platform: 'bluesky',
    credentials: { identifier: 'bob.bsky.social', password: 'abcd-efgh' }
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.account.platform, 'bluesky');
  assert.equal(r.data.account.username, 'bob.bsky.social');
  assert.equal(r.data.account.manual, true);

  const list = await req(base, 'GET', '/api/accounts');
  assert.equal(list.data.accounts.length, 1);
  assert.equal(list.data.accounts[0].id, 'bluesky:did:plc:bob');
});

test('凭据连接：Mastodon 实例 + 令牌落库', async (t) => {
  const mock = await startMock((req) => {
    if (req.path === '/api/v1/accounts/verify_credentials') {
      assert.equal(req.headers.authorization, 'Bearer tok-9');
      return { body: { id: '77', username: 'carol', acct: 'carol@m.example', display_name: 'Carol' } };
    }
    return null;
  });
  t.after(() => mock.close());

  const { base, app } = await startTestApp();
  t.after(() => app.server.close());

  const r = await req(base, 'POST', '/api/accounts/manual', {
    platform: 'mastodon',
    credentials: { instance: baseUrlOf(mock), token: 'tok-9' }
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.account.platform, 'mastodon');
  assert.equal(r.data.account.username, 'carol@m.example');

  const list = await req(base, 'GET', '/api/accounts');
  assert.equal(list.data.accounts[0].id, 'mastodon:77');
});

test('凭据连接：错误凭据返回 401 且不落库', async (t) => {
  const mock = await startMock(() => ({ status: 401, body: { message: 'Invalid identifier or password' } }));
  t.after(() => mock.close());

  const { base, app } = await startTestApp({ bluesky: { service: baseUrlOf(mock) } });
  t.after(() => app.server.close());

  const r = await req(base, 'POST', '/api/accounts/manual', {
    platform: 'bluesky',
    credentials: { identifier: 'x.bsky.social', password: 'wrong' }
  });
  assert.equal(r.status, 401);
  const list = await req(base, 'GET', '/api/accounts');
  assert.equal(list.data.accounts.length, 0);
});

test('写作台 compose/schedule：直接入队，不产生草稿', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  await seedAccount(app, 'x:1', 'x');

  const at = new Date(Date.now() + 3600_000).toISOString();
  const r = await req(base, 'POST', '/api/compose/schedule', {
    segments: [{ text: '第一段', media: [] }, { text: '第二段', media: [] }],
    accountIds: ['x:1'],
    scheduledAt: at
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.posts.length, 1);
  assert.equal(r.data.posts[0].segmentsCount, 2);
  assert.equal(r.data.posts[0].status, 'pending');

  // 关键断言：不产生草稿
  const drafts = await req(base, 'GET', '/api/drafts');
  assert.equal(drafts.data.drafts.length, 0);
});

test('写作台 compose/publish：立即发布成功且不产生草稿', async (t) => {
  const mock = await startMock((r) => {
    if (r.path === '/2/tweets') return { body: { data: { id: '3001' } } };
    return null;
  });
  t.after(() => mock.close());

  const { base, app } = await startTestApp({
    x: { ...JSON.parse(JSON.stringify(baseConfig.x)), clientId: 'cid', apiBaseUrl: baseUrlOf(mock), uploadBaseUrl: baseUrlOf(mock) }
  });
  t.after(() => app.server.close());
  await seedAccount(app, 'x:1', 'x');

  const r = await req(base, 'POST', '/api/compose/publish', {
    segments: [{ text: '立即发布内容', media: [] }],
    accountIds: ['x:1']
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.results.length, 1);
  assert.equal(r.data.results[0].ok, true);
  assert.ok(r.data.results[0].urls[0].includes('/status/3001'));

  const drafts = await req(base, 'GET', '/api/drafts');
  assert.equal(drafts.data.drafts.length, 0, '立即发布不应写入草稿箱');
});

test('写作台 compose：空内容 / 无账号 报错', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());

  // 无账号
  const noAccount = await req(base, 'POST', '/api/compose/publish', {
    segments: [{ text: 'hi', media: [] }]
  });
  assert.equal(noAccount.status, 400);
  assert.match(noAccount.data.error, /连接/);

  // 空内容
  await seedAccount(app, 'x:1', 'x');
  const empty = await req(base, 'POST', '/api/compose/publish', {
    segments: [{ text: '   ', media: [] }],
    accountIds: ['x:1']
  });
  assert.equal(empty.status, 400);
  assert.match(empty.data.error, /内容为空/);
});

test('已连接账号但未指定目标账号：拒绝发布（不得默认群发）', async (t) => {  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  await seedAccount(app, 'x:1', 'x');
  await seedAccount(app, 'threads:1', 'threads');

  const pub = await req(base, 'POST', '/api/compose/publish', {
    segments: [{ text: '不能默认群发', media: [] }]
  });
  assert.equal(pub.status, 400);
  assert.match(pub.data.error, /未指定目标账号/);

  const sched = await req(base, 'POST', '/api/compose/schedule', {
    segments: [{ text: '不能默认群发', media: [] }],
    scheduledAt: new Date(Date.now() + 3600_000).toISOString()
  });
  assert.equal(sched.status, 400);
  assert.match(sched.data.error, /未指定目标账号/);

  // 队列里不应产生任何记录
  const posts = await req(base, 'GET', '/api/posts');
  assert.equal(posts.data.posts.length, 0);
});

test('分段平台开关：exclude 的分段不发给对应平台', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  await seedAccount(app, 'x:1', 'x');
  await seedAccount(app, 'threads:1', 'threads');

  const at = new Date(Date.now() + 3600_000).toISOString();
  const r = await req(base, 'POST', '/api/compose/schedule', {
    segments: [
      { text: '第一段', media: [], exclude: [] },
      { text: 'https://example.com/link', media: [], exclude: ['x'] },
      { text: '第三段', media: [], exclude: [] }
    ],
    accountIds: ['x:1', 'threads:1'],
    scheduledAt: at
  });
  assert.equal(r.status, 200);
  const xPost = r.data.posts.find((p) => p.platform === 'x');
  const thPost = r.data.posts.find((p) => p.platform === 'threads');
  assert.ok(xPost && thPost);
  assert.equal(xPost.segmentsCount, 2, 'X 应只发 2 段（带链接段被排除）');
  assert.equal(thPost.segmentsCount, 3, 'Threads 应发全部 3 段');
});

test('分段平台开关：该平台全部分段被排除时拒绝发布', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  await seedAccount(app, 'x:1', 'x');

  const r = await req(base, 'POST', '/api/compose/publish', {
    segments: [{ text: '只有链接', media: [], exclude: ['x'] }],
    accountIds: ['x:1']
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /没有可发布的分段/);

  const posts = await req(base, 'GET', '/api/posts');
  assert.equal(posts.data.posts.length, 0);
});

test('构建版本：首页注入资源版本号与构建标记，带 ETag 可 304', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());

  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(!html.includes('{{BUILD}}'), '占位符应已被替换');
  const m = html.match(/app\.js\?v=([0-9a-f]{10})/);
  assert.ok(m, 'app.js 应带 10 位构建哈希');
  assert.ok(html.includes('build ' + m[1]), '侧栏应显示构建版本');
  assert.match(html, /build [0-9a-f]{10} · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);

  // 带版本号的资源可正常访问（query 不影响路由）
  const js = await fetch(base + '/app.js?v=' + m[1]);
  assert.equal(js.status, 200);

  // 首页 ETag 复验
  const etag = r.headers.get('etag');
  assert.ok(etag);
  const second = await fetch(base + '/', { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);
});

test('静态资源缓存：JS/CSS 每次校验（ETag 304），媒体长缓存', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());

  // app.js：no-cache + ETag
  const first = await fetch(base + '/app.js');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-cache');
  const etag = first.headers.get('etag');
  assert.ok(etag, '应返回 ETag');

  // 带 If-None-Match 再请求 → 304
  const second = await fetch(base + '/app.js', { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);

  // 上传一张图片，验证媒体为长缓存
  const up = await req(base, 'POST', '/api/media', pngRecord());
  assert.equal(up.status, 200);
  const mediaPath = up.data.media.url;
  const img = await fetch(base + mediaPath);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('cache-control'), /max-age=86400/);
});

test('分段把所有平台都取消：定时发布被拒绝并指出段号', async (t) => {
  const { base, app } = await startTestApp();
  t.after(() => app.server.close());
  await seedAccount(app, 'x:1', 'x');
  await seedAccount(app, 'threads:1', 'threads');

  const r = await req(base, 'POST', '/api/compose/schedule', {
    segments: [
      { text: '正常段', media: [], exclude: [] },
      { text: '两个平台都取消的段', media: [], exclude: ['x', 'threads'] }
    ],
    accountIds: ['x:1', 'threads:1'],
    scheduledAt: new Date(Date.now() + 3600_000).toISOString()
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /第 2 段没有勾选任何发布平台/);

  const posts = await req(base, 'GET', '/api/posts');
  assert.equal(posts.data.posts.length, 0, '拒绝后不应留下任何队列记录');
});
