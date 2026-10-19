/**
 * server/platforms/mastodon.js — Mastodon 适配器
 *
 * - 认证：实例地址 + 访问令牌（实例「首选项 → 开发 → 新建应用」勾选 write 后生成）
 *   访问令牌默认长期有效（实例若开启 ACCESS_TOKEN_EXPIRES_IN 才会过期）
 * - 发帖：POST /api/v1/statuses；分段用 in_reply_to_id 串联
 * - 图片：POST /api/v2/media（multipart）→ media_ids
 * - 每个账号可属于不同实例，实例地址存在 tokens.instance
 */
'use strict';
const fs = require('fs');
const { PlatformAdapter } = require('./base');
const { httpRequest, authHeader } = require('../oauth');

function normalizeInstance(input) {
  let s = String(input || '').trim();
  if (!s) throw Object.assign(new Error('请填写 Mastodon 实例地址（如 https://mastodon.social）'), { statusCode: 400 });
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/\/+$/, '');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw Object.assign(new Error('Mastodon 实例地址格式不正确'), { statusCode: 400 });
  }
  return u.origin;
}

class MastodonAdapter extends PlatformAdapter {
  static get id() { return 'mastodon'; }
  static get name() { return 'Mastodon'; }
  static get authDoc() { return 'mastodon'; }

  /** 凭据按账号存储，无需应用级配置 */
  isConfigured() { return true; }

  limits() {
    return {
      maxChars: 500,
      weighted: false,
      maxImages: 4,
      maxImageBytes: 16 * 1024 * 1024,
      imageMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      dailyPostCap: null,
      note: '500 字符（部分实例可调）；每帖最多 4 张图'
    };
  }

  _instance(tokens) {
    return (tokens && tokens.instance) || this.config.mastodon.defaultInstance;
  }

  /** 实例 + 访问令牌连接 */
  async connect({ instance, token } = {}) {
    const base = normalizeInstance(instance || this.config.mastodon.defaultInstance);
    const tk = String(token || '').trim();
    if (!tk) throw Object.assign(new Error('请粘贴 Mastodon 访问令牌'), { statusCode: 400 });

    const res = await httpRequest(base + '/api/v1/accounts/verify_credentials', {
      headers: authHeader(tk),
      timeoutMs: 30_000
    });
    if (res.status !== 200 || !res.json || !res.json.id) {
      const msg = (res.json && res.json.error) || (res.text || '').slice(0, 200);
      throw Object.assign(new Error(`Mastodon 令牌验证失败: HTTP ${res.status} ${msg}`), { statusCode: 401 });
    }
    const me = res.json;
    return {
      externalId: String(me.id),
      username: me.acct || me.username,
      displayName: me.display_name || me.username,
      tokens: {
        accessToken: tk,
        tokenType: 'Bearer',
        expiresAt: null,
        instance: base
      }
    };
  }

  /** Mastodon 访问令牌默认不过期，无需刷新 */
  async refreshToken(tokens) {
    return tokens;
  }

  async fetchProfile(accessToken, tokens) {
    const base = this._instance(tokens);
    const res = await httpRequest(base + '/api/v1/accounts/verify_credentials', {
      headers: authHeader(accessToken),
      timeoutMs: 15_000
    });
    if (res.status !== 200 || !res.json || !res.json.id) {
      throw new Error(`Mastodon 获取账号信息失败: HTTP ${res.status} ${(res.text || '').slice(0, 200)}`);
    }
    return {
      externalId: String(res.json.id),
      username: res.json.acct || res.json.username,
      displayName: res.json.display_name || res.json.username
    };
  }

  async _uploadMedia(account, media) {
    const base = this._instance(account.tokens);
    const buf = fs.readFileSync(media.path);
    const form = new FormData();
    form.append('file', new Blob([buf], { type: media.mime || 'application/octet-stream' }), media.name || 'image');
    if (media.description) form.append('description', media.description);

    const res = await fetch(base + '/api/v2/media', {
      method: 'POST',
      headers: authHeader(account.tokens.accessToken),
      body: form
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok || !json || !json.id) {
      throw new Error(`Mastodon 图片上传失败: HTTP ${res.status} ${(text || '').slice(0, 200)}`);
    }
    return String(json.id);
  }

  async publishPost(account, msg) {
    const base = this._instance(account.tokens);
    const maxImages = this.limits().maxImages;

    const mediaIds = [];
    for (const m of (msg.media || []).slice(0, maxImages)) {
      mediaIds.push(await this._uploadMedia(account, m));
    }

    const body = { status: msg.text || '', visibility: 'public' };
    if (mediaIds.length) body.media_ids = mediaIds;
    if (msg.replyToId) body.in_reply_to_id = String(msg.replyToId);

    const res = await httpRequest(base + '/api/v1/statuses', {
      method: 'POST',
      headers: { ...authHeader(account.tokens.accessToken), 'Content-Type': 'application/json' },
      json: body,
      timeoutMs: 60_000
    });
    if (res.status !== 200 || !res.json || !res.json.id) {
      throw new Error(`Mastodon 发帖失败: HTTP ${res.status} ${(res.text || '').slice(0, 300)}`);
    }
    const id = String(res.json.id);
    return {
      platformPostId: id,
      permalink: res.json.url || `${base}/@${account.username}/${id}`
    };
  }
}

module.exports = MastodonAdapter;
module.exports.normalizeInstance = normalizeInstance;
