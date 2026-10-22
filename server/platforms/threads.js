/**
 * server/platforms/threads.js — Threads API (Meta Graph) 适配器
 *
 * - 认证：OAuth 2.0 code → 短期 token → th_exchange_token 换 60 天长 token
 *         → th_refresh_token 续期（令牌满 24h 且在有效期内可续）
 * - 发布：创建 container（TEXT / IMAGE / CAROUSEL）→ threads_publish
 *         分段通过 container 的 reply_to_id 串成 thread 链（回复上一条）
 *         图片要求公网可访问 image_url（本地图片由本服务 /media 路由提供，
 *         公网可达性依赖 THREADS_IMAGE_BASE_URL 配置，见 docs/ARCHITECTURE.md §5.3）
 */
'use strict';
const { PlatformAdapter } = require('./base');
const { httpRequest, authHeader } = require('../oauth');

class ThreadsAdapter extends PlatformAdapter {
  static get id() { return 'threads'; }
  static get name() { return 'Threads'; }
  static get authDoc() { return 'threads'; }

  isConfigured() { return !!this.config.threads.clientId; }

  limits() {
    return {
      maxChars: 500,
      weighted: false,
      maxImages: 10,
      maxImageBytes: 8 * 1024 * 1024,
      imageMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      dailyPostCap: 250, // 每账号每 24h 上限
      note: '单条 500 字；每条最多 10 张图（轮播）；每账号每 24h 限 250 条'
    };
  }

  /** 平台专属回调地址（Meta 强制 HTTPS；本机需用隧道地址，可被 env 覆盖） */
  get redirectUri() {
    return this.config.threads.redirectUri || this.config.threads.callbackUrl;
  }

  buildAuthorizeUrl({ state, redirectUri }) {
    const redirect = redirectUri || this.redirectUri;
    const u = new URL('https://threads.net/oauth/authorize');
    u.searchParams.set('client_id', this.config.threads.clientId);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('scope', 'threads_basic,threads_content_publish');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    return u.toString();
  }

  async exchangeCode({ code, redirectUri }) {
    const base = this.config.threads.apiBaseUrl;
    const redirect = redirectUri || this.redirectUri;
    // 1) code → 短期 token
    const shortRes = await httpRequest(base + '/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      form: new URLSearchParams({
        client_id: this.config.threads.clientId,
        client_secret: this.config.threads.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirect
      })
    });
    if (shortRes.status !== 200 || !shortRes.json || !shortRes.json.access_token) {
      throw new Error(`Threads 短期令牌交换失败: HTTP ${shortRes.status} ${(shortRes.text || '').slice(0, 200)}`);
    }
    // 2) 短期 → 长期（60 天）
    const longUrl = new URL(base + '/access_token');
    longUrl.searchParams.set('grant_type', 'th_exchange_token');
    longUrl.searchParams.set('client_secret', this.config.threads.clientSecret);
    longUrl.searchParams.set('access_token', shortRes.json.access_token);
    const longRes = await httpRequest(longUrl.toString(), { timeoutMs: 30_000 });
    if (longRes.status !== 200 || !longRes.json || !longRes.json.access_token) {
      throw new Error(`Threads 长期令牌交换失败: HTTP ${longRes.status} ${(longRes.text || '').slice(0, 200)}`);
    }
    return this._normalizeTokens(longRes.json);
  }

  async refreshToken(tokens) {
    const base = this.config.threads.apiBaseUrl;
    const url = new URL(base + '/refresh_access_token');
    url.searchParams.set('grant_type', 'th_refresh_token');
    url.searchParams.set('access_token', tokens.accessToken);
    const res = await httpRequest(url.toString(), { timeoutMs: 30_000 });
    if (res.status !== 200 || !res.json || !res.json.access_token) {
      throw new Error(`Threads 令牌刷新失败: HTTP ${res.status} ${(res.text || '').slice(0, 200)}`);
    }
    return this._normalizeTokens(res.json);
  }

  _normalizeTokens(json) {
    return {
      accessToken: json.access_token,
      refreshToken: json.access_token, // Threads 用 access_token 自身续期
      tokenType: json.token_type || 'Bearer',
      scope: null,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
      // 长期令牌 60 天，且必须在使用期内续期；按 59 天估算续期凭证的有效期
      refreshExpiresAt: Date.now() + 59 * 24 * 3600 * 1000
    };
  }

  async fetchProfile(accessToken) {
    const base = this.config.threads.apiBaseUrl;
    const url = new URL(base + '/v1.0/me');
    url.searchParams.set('fields', 'id,username');
    url.searchParams.set('access_token', accessToken);
    const res = await httpRequest(url.toString());
    if (res.status !== 200 || !res.json || !res.json.id) {
      throw new Error(`Threads 获取用户信息失败: HTTP ${res.status} ${(res.text || '').slice(0, 200)}`);
    }
    return { externalId: String(res.json.id), username: res.json.username, displayName: res.json.username };
  }

  /** Threads 要求图片 URL 公网可达：优先用配置的 threads.imageBaseUrl */
  _publicUrl(media) {
    const base = String(this.config.threads.imageBaseUrl || '').replace(/\/+$/, '');
    return `${base}/media/${media.id}${media.ext || ''}`;
  }

  async _createContainer(accessToken, params) {
    const form = new URLSearchParams({ access_token: accessToken });
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') form.set(k, String(v));
    }
    const res = await httpRequest(this.config.threads.apiBaseUrl + '/v1.0/me/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      form,
      timeoutMs: 60_000
    });
    if (res.status !== 200 || !res.json || !res.json.id) {
      throw new Error(`Threads 创建容器失败: HTTP ${res.status} ${(res.text || '').slice(0, 300)}`);
    }
    return String(res.json.id);
  }

  async _waitForContainer(accessToken, containerId, timeoutMs) {
    // 所有容器（含纯文字/回复）都要等 FINISHED 再发布，否则会报
    // "The requested resource does not exist / Media not found"
    const url = new URL(`${this.config.threads.apiBaseUrl}/v1.0/${containerId}`);
    url.searchParams.set('fields', 'status,error_message');
    url.searchParams.set('access_token', accessToken);
    const deadline = Date.now() + (timeoutMs || 30_000);
    while (Date.now() < deadline) {
      const res = await httpRequest(url.toString(), { timeoutMs: 15_000 });
      if (res.status !== 200) return; // 状态端点不可用时直接尝试发布
      const status = res.json && res.json.status;
      if (status === 'FINISHED' || status === 'PUBLISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') {
        const detail = (res.json && res.json.error_message) || '';
        throw new Error(`Threads 容器处理失败（${status}）${detail ? '：' + detail : '，请检查图片 URL 是否公网可访问'}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('Threads 媒体处理超时（30s），请检查图片 URL 是否公网可访问');
  }

  async _publishContainer(accessToken, containerId) {
    const res = await httpRequest(this.config.threads.apiBaseUrl + '/v1.0/me/threads_publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      form: new URLSearchParams({ access_token: accessToken, creation_id: containerId }),
      timeoutMs: 60_000
    });
    if (res.status !== 200 || !res.json || !res.json.id) {
      const body = res.json && res.json.error ? res.json.error : null;
      const sub = body && body.error_subcode;
      if (sub === 4279047) {
        throw new Error('Threads 无法为该链接生成预览（目标站点可能拦截了抓取）。可改用短链，或把链接放到正文中一起发。');
      }
      throw new Error(`Threads 发布失败: HTTP ${res.status} ${(res.text || '').slice(0, 300)}`);
    }
    return String(res.json.id);
  }

  async _fetchPermalink(accessToken, postId) {
    try {
      const url = new URL(`${this.config.threads.apiBaseUrl}/v1.0/${postId}`);
      url.searchParams.set('fields', 'permalink');
      url.searchParams.set('access_token', accessToken);
      const res = await httpRequest(url.toString(), { timeoutMs: 10_000 });
      if (res.status === 200 && res.json && res.json.permalink) return res.json.permalink;
    } catch { /* 忽略，用兜底链接 */ }
    return `https://www.threads.net/post/${postId}`;
  }

  async publishPost(account, msg) {
    const accessToken = account.tokens.accessToken;
    // 图片统一换成公网可达 URL
    const images = (msg.media || []).map((m) => ({ ...m, url: this._publicUrl(m) }));
    // 分段串 thread：container 上带 reply_to_id（回复上一条已发布的帖子）
    const reply = msg.replyToId ? { reply_to_id: String(msg.replyToId) } : {};

    // 每次调用都新建容器，便于失败后重建重试
    const buildContainer = async () => {
      if (images.length === 0) {
        return this._createContainer(accessToken, { media_type: 'TEXT', text: msg.text, ...reply });
      }
      if (images.length === 1) {
        return this._createContainer(accessToken, {
          media_type: 'IMAGE', image_url: images[0].url, text: msg.text, ...reply
        });
      }
      const children = [];
      for (const img of images) {
        children.push(await this._createContainer(accessToken, { media_type: 'IMAGE', image_url: img.url }));
      }
      return this._createContainer(accessToken, {
        media_type: 'CAROUSEL', children: children.join(','), text: msg.text, ...reply
      });
    };

    let containerId = await buildContainer();
    // 关键：等容器处理完成再发布（纯文字/回复也适用）
    await this._waitForContainer(accessToken, containerId, 20_000);

    let postId;
    try {
      postId = await this._publishContainer(accessToken, containerId);
    } catch (err) {
      // 容器失效/已被消费（code 24）→ 重建一个新容器重试一次
      if (/code"?\s*:\s*24|does not exist|tidak boleh ditemui/i.test(err.message)) {
        containerId = await buildContainer();
        await this._waitForContainer(accessToken, containerId, 20_000);
        postId = await this._publishContainer(accessToken, containerId);
      } else {
        throw err;
      }
    }
    const permalink = await this._fetchPermalink(accessToken, postId);
    return { platformPostId: postId, permalink };
  }
}

module.exports = ThreadsAdapter;
