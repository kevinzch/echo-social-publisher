/**
 * test/publish.test.js — 发布器媒体组装与端到端（mock 平台）
 *
 * 回归：media.get() 只返回元数据，适配器上传二进制需要 path；
 * 曾因缺失 path 导致 X / Bluesky / Mastodon 发图报
 * 'The "path" argument must be of type string... Received undefined'
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Publisher } = require('../server/publish');
const { Store } = require('../server/store');
const { getPlatform } = require('../server/platforms');
const baseConfig = require('../server/config');
const { tmpDir, pngRecord, startMock, baseUrlOf } = require('./helpers');

function makeCtx(overrides) {
  const cfg = JSON.parse(JSON.stringify(baseConfig));
  cfg.dataDir = tmpDir('echo-pub-');
  cfg.appBaseUrl = 'http://127.0.0.1:8787';
  Object.assign(cfg, overrides || {});
  const store = new Store(cfg.dataDir);
  const accounts = { ensureFreshToken: async (a) => a };
  const publisher = new Publisher({ store, config: cfg, accounts });
  return { cfg, store, publisher };
}

function platformOf(id, cfg) {
  return getPlatform(id, cfg);
}

test('prepareSegments：图片同时带本地 path 与公网 URL', async () => {
  const { cfg, publisher } = makeCtx();
  const saved = await publisher.getMediaStore().save(pngRecord());
  const platform = platformOf('bluesky', cfg);

  const segs = publisher.prepareSegments(platform, { segments: [{ text: '图', media: [saved.id] }] });
  assert.equal(segs[0].media.length, 1);
  const m = segs[0].media[0];
  assert.equal(typeof m.path, 'string');
  assert.ok(m.path.length > 0, 'media.path 必须存在（适配器上传依赖它）');
  assert.ok(fs.existsSync(m.path), 'path 指向的文件必须存在');
  assert.match(m.url, /^http:\/\/127\.0\.0\.1:8787\/media\//);
});

test('prepareSegments：图片文件缺失时给出明确错误', async () => {
  const { cfg, publisher } = makeCtx();
  const saved = await publisher.getMediaStore().save(pngRecord());
  const platform = platformOf('mastodon', cfg);
  fs.unlinkSync(publisher.getMediaStore().pathOf(saved));

  assert.throws(
    () => publisher.prepareSegments(platform, { segments: [{ text: '图', media: [saved.id] }] }),
    /图片文件缺失/
  );
});

test('prepareSegments：超过平台单张上限时拒绝', async () => {
  const { cfg, publisher } = makeCtx();
  const saved = await publisher.getMediaStore().save(pngRecord());
  const platform = platformOf('bluesky', cfg);
  // Bluesky 上限 1MB，把记录改成 2MB 触发校验
  const record = publisher.getMediaStore().get(saved.id);
  record.size = 2 * 1024 * 1024;

  assert.throws(
    () => publisher.prepareSegments(platform, { segments: [{ text: '图', media: [saved.id] }] }),
    /超过平台单张上限/
  );
});

test('发布含图帖子：Bluesky 先 uploadBlob 再 createRecord(embed)', async () => {
  let uploaded = 0;
  let embedSeen = null;
  const mock = await startMock((req) => {
    if (req.path === '/xrpc/com.atproto.repo.uploadBlob') {
      uploaded++;
      assert.ok(req.body.length > 0, '应上传二进制内容');
      return { body: { blob: { $type: 'blob', ref: { $link: 'bafy' }, mimeType: 'image/png', size: 70 } } };
    }
    if (req.path === '/xrpc/com.atproto.repo.createRecord') {
      embedSeen = req.json.record.embed;
      return { body: { uri: 'at://did:plc:1/app.bsky.feed.post/rk1', cid: 'c1' } };
    }
    return null;
  });
  const { cfg, store, publisher } = makeCtx({ bluesky: { service: baseUrlOf(mock) } });
  const base = baseUrlOf(mock);
  await store.accounts.insert({
    id: 'bluesky:did:plc:1', platform: 'bluesky', externalId: 'did:plc:1',
    username: 'alice.bsky.social', displayName: 'Alice', enabled: true,
    tokens: { accessToken: 'at', refreshToken: 'rt', pds: base, expiresAt: Date.now() + 3600_000 },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  const saved = await publisher.getMediaStore().save(pngRecord());
  const post = {
    id: 'p1', platform: 'bluesky', accountId: 'bluesky:did:plc:1',
    segments: [{ text: 'hi', media: [saved.id] }], status: 'pending'
  };
  await store.posts.insert(post);

  const r = await publisher.publishPost(post);
  mock.close();

  assert.equal(r.ok, true);
  assert.equal(uploaded, 1);
  assert.equal(embedSeen.$type, 'app.bsky.embed.images');
  assert.equal(embedSeen.images[0].image.ref.$link, 'bafy');
});

test('发布含图帖子：Mastodon 先上传 media 再带 media_ids 发帖', async () => {
  let mediaId = null;
  let statusBody = null;
  const mock = await startMock((req) => {
    if (req.path === '/api/v2/media') {
      assert.match(req.headers['content-type'], /multipart\/form-data/);
      return { body: { id: 'media-1' } };
    }
    if (req.path === '/api/v1/statuses') {
      statusBody = req.json;
      return { body: { id: '9001', url: 'https://m.example/@alice/9001' } };
    }
    return null;
  });
  const base = baseUrlOf(mock);
  const { store, publisher } = makeCtx();
  await store.accounts.insert({
    id: 'mastodon:7', platform: 'mastodon', externalId: '7',
    username: 'alice@m.example', displayName: 'Alice', enabled: true,
    tokens: { accessToken: 'tok', instance: base, expiresAt: null },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  const saved = await publisher.getMediaStore().save(pngRecord());
  const post = {
    id: 'p2', platform: 'mastodon', accountId: 'mastodon:7',
    segments: [{ text: 'hi', media: [saved.id] }], status: 'pending'
  };
  await store.posts.insert(post);

  const r = await publisher.publishPost(post);
  mock.close();

  assert.equal(r.ok, true);
  mediaId = statusBody.media_ids[0];
  assert.equal(mediaId, 'media-1');
  assert.equal(statusBody.status, 'hi');
});
