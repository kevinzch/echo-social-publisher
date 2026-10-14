/**
 * server/index.js — 入口：HTTP 服务 + 静态资源 + 调度器
 */
'use strict';
const http = require('http');
const path = require('path');
const config = require('./config');
const { getStore } = require('./store');
const { AccountService } = require('./auth');
const { Publisher } = require('./publish');
const { Scheduler } = require('./scheduler');
const { makeRoutes } = require('./routes');
const httpUtil = require('./http');

const SHARED_ALLOW = new Set(['chars.js', 'threadText.js']);
const MEDIA_RE = /^\/media\/([\w.-]+)$/;

/**
 * 组装应用（可注入依赖，便于测试）
 */
function createApp(opt) {
  opt = opt || {};
  const cfg = opt.config || config;
  // 注意：每次调用都新建 Store（不使用单例），保证测试隔离与多实例安全
  const store = opt.store || new (require('./store').Store)(cfg.dataDir);
  const accounts = opt.accounts || new AccountService(store, cfg);
  const publisher = new Publisher({ store, config: cfg, accounts });
  const scheduler = new Scheduler({
    store,
    executor: (post) => publisher.publishPost(post),
    intervalMs: cfg.schedulerIntervalMs,
    maxAttempts: cfg.maxPublishAttempts,
    backoffMinutes: cfg.retryBackoffMinutes,
    nowFn: opt.nowFn
  });
  const media = publisher.getMediaStore();
  const routes = makeRoutes({ store, accounts, publisher, scheduler, media, config: cfg });

  const publicDir = path.join(cfg.rootDir, 'public');
  const sharedDir = path.join(cfg.rootDir, 'shared');

  async function handleStatic(res, pathname) {
    let file = null;
    if (pathname === '/' || pathname === '/index.html') file = path.join(publicDir, 'index.html');
    else if (pathname === '/app.js') file = path.join(publicDir, 'app.js');
    else if (pathname === '/styles.css') file = path.join(publicDir, 'styles.css');
    else if (pathname.indexOf('/shared/') === 0) {
      const name = path.basename(pathname);
      if (SHARED_ALLOW.has(name)) file = path.join(sharedDir, name);
    } else if (MEDIA_RE.test(pathname)) {
      const full = MEDIA_RE.exec(pathname)[1];
      const id = full.replace(/\.[^.]+$/, '');
      const record = media.get(id);
      if (record) {
        const ok = await httpUtil.serveStatic(res, media.pathOf(record));
        if (ok) return true;
      }
      return false;
    }
    if (file) {
      const ok = await httpUtil.serveStatic(res, file);
      if (ok) return true;
    }
    // SPA fallback：无扩展名、且非 API/回调 的路径回落到 index.html
    if (pathname.indexOf('.') === -1 && pathname.indexOf('/api/') !== 0 && pathname.indexOf('/auth/') !== 0) {
      const ok = await httpUtil.serveStatic(res, path.join(publicDir, 'index.html'));
      if (ok) return true;
    }
    return false;
  }

  const server = http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    } catch {
      return httpUtil.sendError(res, 400, 'bad request');
    }
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const params = httpUtil.matchRoute(r.pattern, pathname);
        if (params) { await r.handler(req, res, params); return; }
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const ok = await handleStatic(res, pathname);
        if (ok) return;
      }
      httpUtil.sendError(res, 404, 'not found: ' + pathname);
    } catch (err) {
      const status = err.statusCode || 500;
      if (status >= 500) console.error('[http]', err);
      httpUtil.sendError(res, status, err.message || 'internal error');
    }
  });

  return { server, store, accounts, publisher, scheduler, media, config: cfg };
}

function start() {
  const app = createApp();
  app.server.listen(config.port, () => {
    console.log(`Echo 已启动: http://127.0.0.1:${config.port}`);
    console.log(`数据目录: ${config.dataDir}`);
    const xOk = config.x.clientId ? '已配置' : '未配置（见 docs/API_APPLY_GUIDE.md）';
    const tOk = config.threads.clientId ? '已配置' : '未配置（见 docs/API_APPLY_GUIDE.md）';
    console.log(`X 凭证: ${xOk} ｜ Threads 凭证: ${tOk}`);
  });
  app.scheduler.start();
  const shutdown = () => { app.scheduler.stop(); app.server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return app;
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
