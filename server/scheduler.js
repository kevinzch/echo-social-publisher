/**
 * server/scheduler.js — 定时发布调度器
 * - 轮询到期的 pending Post，交给 executor
 * - 失败指数退避重试（5/15/60 分钟，最多 maxAttempts 次）
 * - 进程重启时立即补投启动窗口内已到期的任务
 */
'use strict';

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

class Scheduler {
  /**
   * @param {object} deps
   * @param {import('./store').Store} deps.store
   * @param {(post:object)=>Promise<any>} deps.executor
   * @param {number} deps.intervalMs
   * @param {number} deps.maxAttempts
   * @param {number[]} deps.backoffMinutes
   * @param {() => number} deps.nowFn 测试用可注入时钟
   * @param {(now:number)=>Promise<void>} [deps.mediaCleanup] 孤儿图片清理钩子（每 24h 最多一次）
   */
  constructor({ store, executor, intervalMs, maxAttempts, backoffMinutes, nowFn, mediaCleanup }) {
    this.store = store;
    this.executor = executor;
    this.intervalMs = intervalMs || 30_000;
    this.maxAttempts = maxAttempts || 3;
    this.backoffMinutes = backoffMinutes || [5, 15, 60];
    this.nowFn = nowFn || (() => Date.now());
    this.timer = null;
    this.running = false;
    this.onEvent = null; // (type, data) => void，用于测试观测
    this.mediaCleanup = typeof mediaCleanup === 'function' ? mediaCleanup : null;
    this.lastCleanupAt = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick(); }, this.intervalMs);
    // 马上补投一次（重启后不错过到期任务）
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  duePosts(now) {
    return this.store.posts.filter((p) => {
      if (p.status !== 'pending') return false;
      const at = toMs(p.scheduledAt);
      if (at == null || at > now) return false;
      const retryAt = toMs(p.nextAttemptAt);
      return retryAt == null || retryAt <= now;
    });
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.nowFn();
      const due = this.duePosts(now);
      for (const post of due) {
        await this._process(post, now);
      }
      await this._maybeCleanup(now);
    } finally {
      this.running = false;
    }
  }

  /** 每 24 小时最多触发一次孤儿图片清理（是否启用由外部钩子判断） */
  async _maybeCleanup(now) {
    if (!this.mediaCleanup) return;
    if (now - this.lastCleanupAt < 24 * 3600 * 1000) return;
    this.lastCleanupAt = now;
    try {
      await this.mediaCleanup(now);
    } catch (err) {
      this._emit('cleanup-failed', { error: err.message });
    }
  }

  async _process(post, now) {
    this._emit('due', { postId: post.id, scheduledAt: post.scheduledAt });
    try {
      await this.executor(post);
      this._emit('published', { postId: post.id });
    } catch (err) {
      // 失败计数由调度器统一持有（executor 不重复计数）
      const attempts = (post.attempts || 0) + 1;
      await this.store.posts.update(post.id, { attempts });
      if (attempts < this.maxAttempts) {
        const idx = Math.min(attempts, this.backoffMinutes.length) - 1;
        const minutes = this.backoffMinutes[idx];
        const nextAttemptAt = now + minutes * 60_000;
        await this.store.posts.update(post.id, { status: 'pending', nextAttemptAt });
        await this.store.log('warn', 'scheduler', `发布失败，${minutes} 分钟后第 ${attempts + 1} 次重试`, {
          postId: post.id,
          error: err.message
        });
        this._emit('retry', { postId: post.id, attempts, nextAttemptAt });
      } else {
        await this.store.posts.update(post.id, { status: 'failed', error: err.message });
        await this.store.log('error', 'scheduler', `已达最大重试次数（${attempts}），标记失败，请手动重试`, {
          postId: post.id,
          error: err.message
        });
        this._emit('failed', { postId: post.id, attempts, error: err.message });
      }
    }
  }

  _emit(type, data) {
    if (typeof this.onEvent === 'function') {
      try { this.onEvent(type, data); } catch { /* 观测者异常不影响调度 */ }
    }
  }
}

module.exports = { Scheduler };
