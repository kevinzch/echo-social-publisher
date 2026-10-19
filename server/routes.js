/**
 * server/routes.js — REST API 路由
 */
'use strict';
const path = require('path');
const { getPlatform, listPlatforms } = require('./platforms');
const ThreadText = require('../shared/threadText');

const { matchRoute, sendJson, sendError, readJsonBody } = require('./http');

function nowIso() { return new Date().toISOString(); }

function makeRoutes(ctx) {
  const { store, accounts, publisher, scheduler, media, config } = ctx;

  /** 各平台 OAuth 回调地址（展示给用户去平台后台登记；与授权请求发送的 redirect_uri 一致） */
  function platformRedirectUri(id) {
    const p = getPlatform(id, config);
    return p && typeof p.redirectUri === 'string' ? p.redirectUri : null;
  }

  function accountLabel(a) {
    const p = getPlatform(a.platform, config);
    return `${p ? p.constructor.name : a.platform} @${a.username}`;
  }

  function postView(post) {
    const account = store.accounts.get(post.accountId);
    const platform = getPlatform(post.platform, config);
    return {
      id: post.id,
      draftId: post.draftId,
      platform: post.platform,
      platformName: platform ? platform.constructor.name : post.platform,
      accountLabel: account ? accountLabel(account) : '已解绑账号',
      segmentsCount: (post.segments || []).length,
      preview: (post.segments || [])[0] ? String(post.segments[0].text || '').slice(0, 80) : '',
      scheduledAt: post.scheduledAt,
      status: post.status,
      attempts: post.attempts || 0,
      nextAttemptAt: post.nextAttemptAt || null,
      error: post.error || null,
      result: post.result || null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      publishedAt: post.publishedAt || null
    };
  }

  function draftView(draft) {
    return {
      id: draft.id,
      title: draft.title || '',
      accountIds: draft.accountIds || [],
      segments: draft.segments || [],
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt
    };
  }

  /** 归一化草稿内容：支持 segments 结构或纯 text（按 --- 手动分段） */
  function normalizeDraftBody(body) {
    const title = typeof body.title === 'string' ? body.title.slice(0, 120) : '';
    const accountIds = Array.isArray(body.accountIds) ? body.accountIds.filter((x) => typeof x === 'string') : [];
    let segments = [];
    if (Array.isArray(body.segments)) {
      segments = body.segments.map((s) => ({
        text: typeof s.text === 'string' ? s.text : '',
        media: Array.isArray(s.media) ? s.media.filter((m) => typeof m === 'string') : []
      }));
    } else if (typeof body.text === 'string') {
      segments = ThreadText.splitSegments(body.text).map((t) => ({ text: t, media: [] }));
    }
    if (!segments.length && (body.text || body.segments)) {
      segments = [{ text: typeof body.text === 'string' ? body.text : '', media: [] }];
    }
    if (!segments.length) throw Object.assign(new Error('草稿内容为空'), { statusCode: 400 });
    return { title, accountIds, segments };
  }

  /** 归一化写作台直传内容：支持 segments 结构或纯 text（按 --- 手动分段） */
  function normalizeSegments(body) {
    let segments = [];
    if (Array.isArray(body.segments)) {
      segments = body.segments.map((s) => ({
        text: typeof s.text === 'string' ? s.text : '',
        media: Array.isArray(s.media) ? s.media.filter((m) => typeof m === 'string') : []
      }));
    } else if (typeof body.text === 'string') {
      segments = ThreadText.splitSegments(body.text).map((t) => ({ text: t, media: [] }));
    }
    const hasContent = segments.some((s) => (s.text || '').trim() || (s.media || []).length);
    if (!hasContent) throw Object.assign(new Error('内容为空，无法发布'), { statusCode: 400 });
    return segments;
  }

  /** 为目标账号创建队列记录（segments 直传，不依赖草稿） */
  async function enqueueFromSegments(segments, accountIds, scheduledAt, draftId = null) {
    const connected = store.accounts.list().filter((a) => a.enabled !== false);
    const targets = accountIds && accountIds.length
      ? connected.filter((a) => accountIds.includes(a.id))
      : connected;
    if (!targets.length) {
      throw Object.assign(new Error('没有已连接的账号，请先在"账号"页连接 X / Threads'), { statusCode: 400 });
    }
    const invalid = (accountIds || []).filter((id) => !targets.find((t) => t.id === id));
    if (invalid.length) {
      throw Object.assign(new Error(`账号不存在或已解绑: ${invalid.join(', ')}`), { statusCode: 400 });
    }
    const posts = [];
    for (const account of targets) {
      const post = {
        id: `post_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        draftId: draftId,
        platform: account.platform,
        accountId: account.id,
        segments: JSON.parse(JSON.stringify(segments)),
        scheduledAt,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        result: null,
        error: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      await store.posts.insert(post);
      posts.push(post);
    }
    return posts;
  }

  /** 为目标账号创建队列记录（来自草稿） */
  async function enqueuePosts(draft, accountIds, scheduledAt) {
    return enqueueFromSegments(draft.segments, accountIds, scheduledAt, draft.id);
  }

  const routes = [
    // ---------- 配置 / 账号 ----------
    {
      method: 'GET', pattern: '/api/config',
      handler: async (req, res) => sendJson(res, 200, {
        platforms: listPlatforms(config).map((p) => ({
          ...p,
          redirectUri: platformRedirectUri(p.id)
        })),
        appBaseUrl: config.appBaseUrl
      })
    },
    {
      method: 'POST', pattern: '/api/accounts/manual',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const view = await accounts.connectWithManualToken(body.platform, body.token);
          sendJson(res, 200, { account: view });
        } catch (err) {
          sendError(res, err.statusCode || 400, err.message);
        }
      }
    },
    {
      method: 'GET', pattern: '/api/accounts', handler: async (req, res) => sendJson(res, 200, { accounts: accounts.listAccounts() }) },
    {
      method: 'DELETE', pattern: '/api/accounts/:id',
      handler: async (req, res, params) => {
        const ok = await accounts.disconnect(params.id);
        if (!ok) return sendError(res, 404, '账号不存在');
        sendJson(res, 200, { ok: true });
      }
    },
    {
      method: 'POST', pattern: '/api/auth/:platform/start',
      handler: async (req, res, params) => {
        try {
          const { authUrl, state } = accounts.startAuth(params.platform);
          sendJson(res, 200, { authUrl, state });
        } catch (err) {
          sendError(res, err.statusCode || 500, err.message, err.code ? { code: err.code } : undefined);
        }
      }
    },
    {
      method: 'GET', pattern: '/auth/:platform/callback',
      handler: async (req, res, params) => {
        const url = new URL(req.url, 'http://x');
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const oauthError = url.searchParams.get('error');
        try {
          if (oauthError) throw new Error(`平台拒绝授权: ${oauthError} ${url.searchParams.get('error_description') || ''}`);
          await accounts.handleCallback(params.platform, { code, state });
          res.writeHead(302, { Location: '/#/accounts?connected=' + encodeURIComponent(params.platform) });
          res.end();
        } catch (err) {
          const msg = encodeURIComponent(err.message);
          res.writeHead(302, { Location: `/#/accounts?error=${msg}&platform=${encodeURIComponent(params.platform)}` });
          res.end();
        }
      }
    },

    // ---------- 媒体 ----------
    {
      method: 'POST', pattern: '/api/media',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req, { limit: config.maxUploadBytes + 2 * 1024 * 1024 });
          const record = await media.save({
            name: body.name,
            mime: body.mime,
            size: body.size,
            dataBase64: body.dataBase64
          });
          sendJson(res, 200, { media: { ...record, url: `${config.appBaseUrl}/media/${record.id}${record.ext}` } });
        } catch (err) {
          sendError(res, err.statusCode || 400, err.message);
        }
      }
    },

    // ---------- 草稿 ----------
    { method: 'GET', pattern: '/api/drafts', handler: async (req, res) => sendJson(res, 200, { drafts: store.drafts.list().map(draftView) }) },
    {
      method: 'POST', pattern: '/api/drafts',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const normalized = normalizeDraftBody(body);
          const draft = { id: `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, ...normalized, createdAt: nowIso(), updatedAt: nowIso() };
          await store.drafts.insert(draft);
          sendJson(res, 200, { draft: draftView(draft) });
        } catch (err) {
          sendError(res, err.statusCode || 400, err.message);
        }
      }
    },
    {
      method: 'GET', pattern: '/api/drafts/:id',
      handler: async (req, res, params) => {
        const draft = store.drafts.get(params.id);
        if (!draft) return sendError(res, 404, '草稿不存在');
        sendJson(res, 200, { draft: draftView(draft) });
      }
    },
    {
      method: 'PUT', pattern: '/api/drafts/:id',
      handler: async (req, res, params) => {
        const draft = store.drafts.get(params.id);
        if (!draft) return sendError(res, 404, '草稿不存在');
        try {
          const body = await readJsonBody(req);
          const normalized = normalizeDraftBody(body);
          const updated = await store.drafts.update(params.id, { ...normalized, updatedAt: nowIso() });
          sendJson(res, 200, { draft: draftView(updated) });
        } catch (err) {
          sendError(res, err.statusCode || 400, err.message);
        }
      }
    },
    {
      method: 'DELETE', pattern: '/api/drafts/:id',
      handler: async (req, res, params) => {
        const ok = await store.drafts.remove(params.id);
        if (!ok) return sendError(res, 404, '草稿不存在');
        sendJson(res, 200, { ok: true });
      }
    },

    // ---------- 写作台直传（不落草稿） ----------
    {
      method: 'POST', pattern: '/api/compose/schedule',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          if (!body.scheduledAt) throw Object.assign(new Error('缺少 scheduledAt'), { statusCode: 400 });
          const at = new Date(body.scheduledAt);
          if (Number.isNaN(at.getTime())) throw Object.assign(new Error('scheduledAt 时间格式无效'), { statusCode: 400 });
          if (at.getTime() < Date.now() - 60_000) throw Object.assign(new Error('定时时间已过，请选择将来的时间'), { statusCode: 400 });
          const segments = normalizeSegments(body);
          const posts = await enqueueFromSegments(segments, body.accountIds, at.toISOString());
          await store.log('info', 'schedule', `写作台内容已加入队列（${posts.length} 个账号）`, { scheduledAt: at.toISOString() });
          sendJson(res, 200, { posts: posts.map(postView) });
        } catch (err) {
          sendError(res, err.statusCode || 400, err.message);
        }
      }
    },
    {
      method: 'POST', pattern: '/api/compose/publish',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const segments = normalizeSegments(body);
          const posts = await enqueueFromSegments(segments, body.accountIds, nowIso());
          const results = [];
          for (const post of posts) {
            try {
              const r = await publisher.publishPost(store.posts.get(post.id));
              results.push({ accountId: post.accountId, platform: post.platform, ok: true, urls: r.urls });
            } catch (err) {
              results.push({ accountId: post.accountId, platform: post.platform, ok: false, error: err.message });
            }
          }
          const okCount = results.filter((r) => r.ok).length;
          await store.log('info', 'publish', `写作台立即发布完成（成功 ${okCount}/${results.length}）`, {});
          sendJson(res, 200, { results });
        } catch (err) {
          sendError(res, err.statusCode || 400, err.message);
        }
      }
    },

    // ---------- 发布 / 队列 ----------
    {
      method: 'POST', pattern: '/api/drafts/:id/schedule',
      handler: async (req, res, params) => {
        const draft = store.drafts.get(params.id);
        if (!draft) return sendError(res, 404, '草稿不存在');
        try {
          const body = await readJsonBody(req);
          if (!body.scheduledAt) throw Object.assign(new Error('缺少 scheduledAt'), { statusCode: 400 });
          const at = new Date(body.scheduledAt);
          if (Number.isNaN(at.getTime())) throw Object.assign(new Error('scheduledAt 时间格式无效'), { statusCode: 400 });
          if (at.getTime() < Date.now() - 60_000) throw Object.assign(new Error('定时时间已过，请选择将来的时间'), { statusCode: 400 });
          const posts = await enqueuePosts(draft, body.accountIds, at.toISOString());
          await store.log('info', 'schedule', `已加入队列（${posts.length} 个账号）`, { draftId: draft.id, scheduledAt: at.toISOString() });
          sendJson(res, 200, { posts: posts.map(postView) });
        } catch (err) {
          sendError(res, err.statusCode || 400, err.message);
        }
      }
    },
    {
      method: 'POST', pattern: '/api/drafts/:id/publish',
      handler: async (req, res, params) => {
        const draft = store.drafts.get(params.id);
        if (!draft) return sendError(res, 404, '草稿不存在');
        try {
          const body = await readJsonBody(req);
          const posts = await enqueuePosts(draft, body.accountIds, nowIso());
          const results = [];
          for (const post of posts) {
            try {
              const r = await publisher.publishPost(store.posts.get(post.id));
              results.push({ accountId: post.accountId, platform: post.platform, ok: true, urls: r.urls });
            } catch (err) {
              results.push({ accountId: post.accountId, platform: post.platform, ok: false, error: err.message });
            }
          }
          sendJson(res, 200, { results });
        } catch (err) {
          sendError(res, err.statusCode || 400, err.message);
        }
      }
    },
    {
      method: 'GET', pattern: '/api/posts',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://x');
        const status = url.searchParams.get('status');
        let posts = store.posts.list();
        if (status) posts = posts.filter((p) => p.status === status);
        posts.sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1));
        sendJson(res, 200, { posts: posts.map(postView) });
      }
    },
    {
      method: 'POST', pattern: '/api/posts/:id/publish-now',
      handler: async (req, res, params) => {
        const post = store.posts.get(params.id);
        if (!post) return sendError(res, 404, '记录不存在');
        if (post.status === 'published') return sendError(res, 400, '该贴文已发布');
        if (post.status === 'publishing') return sendError(res, 400, '正在发布中，请稍候');
        try {
          const r = await publisher.publishPost(store.posts.get(post.id));
          sendJson(res, 200, { ok: true, urls: r.urls });
        } catch (err) {
          sendError(res, 502, `发布失败: ${err.message}`);
        }
      }
    },
    {
      method: 'POST', pattern: '/api/posts/:id/retry',
      handler: async (req, res, params) => {
        const post = store.posts.get(params.id);
        if (!post) return sendError(res, 404, '记录不存在');
        if (post.status === 'published') return sendError(res, 400, '该贴文已发布');
        await store.posts.update(post.id, { attempts: 0, nextAttemptAt: null });
        try {
          const r = await publisher.publishPost(store.posts.get(post.id));
          sendJson(res, 200, { ok: true, urls: r.urls });
        } catch (err) {
          sendError(res, 502, `发布失败: ${err.message}`);
        }
      }
    },
    {
      method: 'DELETE', pattern: '/api/posts/:id',
      handler: async (req, res, params) => {
        const post = store.posts.get(params.id);
        if (!post) return sendError(res, 404, '记录不存在');
        if (post.status === 'publishing') return sendError(res, 400, '正在发布中，无法取消');
        if (post.status !== 'pending') return sendError(res, 400, '仅待发布记录可取消');
        await store.posts.update(post.id, { status: 'canceled', updatedAt: nowIso() });
        sendJson(res, 200, { ok: true });
      }
    },

    // ---------- 设置 / 日志 / 文档 ----------
    {
      method: 'GET', pattern: '/api/settings',
      handler: async (req, res) => sendJson(res, 200, {
        settings: {
          schedulerIntervalMs: scheduler.intervalMs,
          defaultQueueTimes: store.settings.defaultQueueTimes || ['09:00', '12:00', '18:00'],
          threadsImageBaseUrl: config.threads.imageBaseUrl,
          logRetention: store.settings.logRetention || config.logRetention,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      })
    },
    {
      method: 'PUT', pattern: '/api/settings',
      handler: async (req, res) => {
        try {
          const body = await readJsonBody(req);
          const patch = {};
          if (typeof body.defaultQueueTimes !== 'undefined') patch.defaultQueueTimes = body.defaultQueueTimes;
          if (typeof body.logRetention === 'number') patch.logRetention = Math.max(10, Math.min(5000, body.logRetention));
          const saved = store.saveSettings(patch);
          if (typeof body.threadsImageBaseUrl === 'string') {
            // 运行时覆盖（本次进程有效；持久化需写入 .env 的 THREADS_IMAGE_BASE_URL）
            config.threads.imageBaseUrl = body.threadsImageBaseUrl.replace(/\/+$/, '');
            publisher.mediaBaseUrl = config.appBaseUrl;
          }
          if (typeof body.schedulerIntervalMs === 'number' && body.schedulerIntervalMs >= 5000) {
            scheduler.intervalMs = body.schedulerIntervalMs;
            scheduler.stop(); scheduler.start();
          }
          sendJson(res, 200, { settings: saved, schedulerIntervalMs: scheduler.intervalMs, threadsImageBaseUrl: config.threads.imageBaseUrl });
        } catch (err) {
          sendError(res, 400, err.message);
        }
      }
    },
    {
      method: 'GET', pattern: '/api/logs',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://x');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);
        const logs = store.logs.list().sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limit);
        sendJson(res, 200, { logs });
      }
    },
    {
      method: 'GET', pattern: '/api/apply-guide',
      handler: async (req, res) => {
        try {
          const fs = require('fs');
          const md = fs.readFileSync(path.join(config.rootDir, 'docs', 'API_APPLY_GUIDE.md'), 'utf8');
          sendJson(res, 200, { markdown: md });
        } catch {
          sendError(res, 404, '指南文档缺失');
        }
      }
    },
    {
      method: 'GET', pattern: '/api/media-list',
      handler: async (req, res) => sendJson(res, 200, { media: media.list() })
    }
  ];

  return routes;
}

module.exports = { makeRoutes };
