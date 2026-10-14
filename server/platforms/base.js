/**
 * server/platforms/base.js — 平台适配器基类
 *
 * 新平台（微博/小红书）请继承本类并实现抽象方法，
 * 然后在 platforms.js 注册。调度、存储、HTTP API、前端均无需改动。
 */
'use strict';

class PlatformAdapter {
  /**
   * @param {object} config server/config.js 的配置对象
   */
  constructor(config) {
    this.config = config;
  }

  /** 平台标识，如 'x' / 'threads' / 'weibo' */
  static get id() { return 'base'; }
  /** 展示名 */
  static get name() { return 'Base'; }
  /** 申请指南锚点 */
  static get authDoc() { return ''; }

  /** 环境变量凭证是否就绪 */
  isConfigured() { return false; }

  /** 平台规则（前端计数/校验与发布校验共用同一份数据） */
  limits() {
    return {
      maxChars: 0,            // 单段字数上限
      weighted: false,        // true 时按 X 加权规则计数
      maxImages: 0,           // 单段图片数上限
      maxImageBytes: 0,       // 单张图片大小上限
      imageMimes: [],         // 允许的图片 MIME
      dailyPostCap: null,     // 每账号每日发帖上限（null=未知）
      note: ''
    };
  }

  /** 授权 URL（PKCE / state 由 auth 层注入） */
  buildAuthorizeUrl(/* { state, codeChallenge } */) {
    throw new Error(`${this.constructor.name}.buildAuthorizeUrl 未实现`);
  }

  /** code → { profile, tokens } */
  async exchangeCode(/* { code, codeVerifier } */) {
    throw new Error(`${this.constructor.name}.exchangeCode 未实现`);
  }

  /** 刷新令牌 → tokens（合并旧 tokens） */
  async refreshToken(/* tokens */) {
    throw new Error(`${this.constructor.name}.refreshToken 未实现`);
  }

  /** 拉取用户资料 → { externalId, username, displayName } */
  async fetchProfile(/* accessToken */) {
    throw new Error(`${this.constructor.name}.fetchProfile 未实现`);
  }

  /**
   * 发布单条
   * @param {object} account { tokens, username, ... }
   * @param {object} msg { text, media: [{id, url, mime, size}], replyToId? }
   * @returns {Promise<{platformPostId:string, permalink:string}>}
   */
  async publishPost(/* account, msg */) {
    throw new Error(`${this.constructor.name}.publishPost 未实现`);
  }

  /**
   * 发布分段长贴文。默认实现：顺序逐条发布，把上一条 id 作为 replyToId 传入。
   * 支持原生 thread 链的平台可覆写。
   * @param {Array} segments [{ text, media }]
   * @returns {Promise<Array<{platformPostId, permalink}>>}
   */
  async publishThread(account, segments) {
    const results = [];
    let prev = null;
    for (const seg of segments) {
      const r = await this.publishPost(account, {
        text: seg.text,
        media: seg.media || [],
        replyToId: prev ? prev.platformPostId : null
      });
      results.push(r);
      prev = r;
    }
    return results;
  }
}

module.exports = { PlatformAdapter };
