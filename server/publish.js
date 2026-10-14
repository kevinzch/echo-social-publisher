/**
 * server/publish.js — 发布执行器（与平台无关）
 * 输入 Post 记录 → 校验 → 令牌刷新 → 发布 → 落库
 */
'use strict';
const ArrayFrom = (s) => Array.from(String(s || ''));
const { getPlatform } = require('./platforms');
const { MediaStore } = require('./media');
const EchoChars = require('../shared/chars');

class Publisher {
  constructor({ store, config, accounts }) {
    this.store = store;
    this.config = config;
    this.accounts = accounts; // AccountService
    this.media = new MediaStore(config.dataDir, {
      allowedMimes: config.allowedUploadMimes,
      maxBytes: config.maxUploadBytes
    });
    this.mediaBaseUrl = config.appBaseUrl;
  }

  getMediaStore() { return this.media; }

  /** 校验并组装 segments（抛出带中文说明的错误） */
  prepareSegments(platform, post) {
    const limits = platform.limits();
    const segments = [];
    const segs = Array.isArray(post.segments) && post.segments.length ? post.segments : [{ text: '', media: [] }];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const text = seg.text || '';
      if (!text.trim() && !(seg.media || []).length) continue;

      if (limits.weighted) {
        const w = EchoChars.analyze(text).weighted;
        if (w > limits.maxChars) {
          throw new Error(`第 ${i + 1} 段超过 ${platform.constructor.name} 字数上限（${w}/${limits.maxChars} 加权）`);
        }
      } else {
        const count = ArrayFrom(text).length;
        if (count > limits.maxChars) {
          throw new Error(`第 ${i + 1} 段超过 ${platform.constructor.name} 字数上限（${count}/${limits.maxChars}）`);
        }
      }

      const media = [];
      for (const mediaId of seg.media || []) {
        const record = this.media.get(mediaId);
        if (!record) throw new Error(`第 ${i + 1} 段引用的图片已丢失（${mediaId}），请重新上传`);
        if (record.size > limits.maxImageBytes) {
          throw new Error(`第 ${i + 1} 段图片 ${record.name} 超过平台单张上限（${Math.floor(limits.maxImageBytes / 1024 / 1024)}MB）`);
        }
        if (!limits.imageMimes.includes(record.mime)) {
          throw new Error(`第 ${i + 1} 段图片 ${record.name} 格式 ${record.mime} 不被 ${platform.constructor.name} 支持`);
        }
        media.push({ ...record, url: this.media.urlFor(record, this.mediaBaseUrl) });
      }
      if (media.length > limits.maxImages) {
        throw new Error(`第 ${i + 1} 段图片数量超过 ${platform.constructor.name} 上限（${media.length}/${limits.maxImages}）`);
      }
      segments.push({ text: text.trim(), media });
    }
    if (!segments.length) throw new Error('内容为空，无法发布');
    return segments;
  }

  /**
   * 发布一条队列记录
   * 成功 → status=published；失败 → status=failed（attempts+1），由调度器决定重试
   */
  async publishPost(post) {
    const nowIso = new Date().toISOString();
    await this.store.posts.update(post.id, { status: 'publishing', updatedAt: nowIso });

    try {
      const platform = getPlatform(post.platform, this.config);
      if (!platform) throw new Error(`未知平台: ${post.platform}`);
      const account = this.accounts.ensureFreshToken
        ? await this.accounts.ensureFreshToken(this.store.accounts.get(post.accountId))
        : this.store.accounts.get(post.accountId);
      if (!account) throw new Error('目标账号不存在或已解绑');
      if (account.enabled === false) throw new Error('目标账号已停用');

      const segments = this.prepareSegments(platform, post);
      const results = await platform.publishThread(account, segments);

      const ids = results.map((r) => r.platformPostId).filter(Boolean);
      const urls = results.map((r) => r.permalink).filter(Boolean);
      const doneAt = new Date().toISOString();
      await this.store.posts.update(post.id, {
        status: 'published',
        result: { ids, urls },
        error: null,
        publishedAt: doneAt,
        updatedAt: doneAt
      });
      await this.store.log('info', 'publish', `发布成功 → ${platform.constructor.name}（${ids.length} 段）`, {
        postId: post.id,
        urls
      });
      return { ok: true, ids, urls };
    } catch (err) {
      const failAt = new Date().toISOString();
      // 注意：attempts 由调度器统一递增，这里不重复计数
      await this.store.posts.update(post.id, {
        status: 'failed',
        error: err.message,
        updatedAt: failAt
      });
      await this.store.log('error', 'publish', `发布失败: ${err.message}`, { postId: post.id });
      throw err;
    }
  }
}

module.exports = { Publisher };
