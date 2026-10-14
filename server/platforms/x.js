/**
 * server/platforms/x.js — X (Twitter) API v2 适配器
 *
 * - 认证：OAuth 2.0 + PKCE（scope: tweet.read tweet.write users.read offline.access）
 * - 媒体：优先 upload.twitter.com/1.1/media/upload.json 简单上传；
 *        失败回退 v2 分片上传（initialize / append / finalize）
 * - 发布：POST /2/tweets，thread 通过 reply.in_reply_to_tweet_id 串联
 */
'use strict';
const fs = require('fs');
const { PlatformAdapter } = require('./base');
const { httpRequest, authHeader } = require('../oauth');

class XAdapter extends PlatformAdapter {
  static get id() { return 'x'; }
  static get name() { return 'X (Twitter)'; }
  static get authDoc() { return 'x'; }

  isConfigured() { return !!this.config.x.clientId; }

  limits() {
    return {
      maxChars: 280,
      weighted: true, // X 加权：CJK×2、URL=23、多数 emoji×2
      maxImages: 4,
      maxImageBytes: 5 * 1024 * 1024,
      imageMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      dailyPostCap: null, // 免费层视订阅而定，见申请指南
      note: '280 加权字数；每条最多 4 张图，单张 ≤5MB'
    };
  }

  buildAuthorizeUrl({ state, codeChallenge }) {
    const u = new URL(this.config.x.authBaseUrl + '/i/oauth2/authorize');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.config.x.clientId);
    u.searchParams.set('redirect_uri', this.config.x.callbackUrl);
    u.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  _tokenHeaders() {
    const headers = {};
    if (this.config.x.clientSecret) {
      headers.Authorization =
        'Basic ' + Buffer.from(`${this.config.x.clientId}:${this.config.x.clientSecret}`).toString('base64');
    }
    return headers;
  }

  async exchangeCode({ code, codeVerifier }) {
    const params = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: this.config.x.clientId,
      redirect_uri: this.config.x.callbackUrl,
      code_verifier: codeVerifier
    });
    const res = await httpRequest(this.config.x.apiBaseUrl + '/2/oauth2/token', {
      method: 'POST',
      headers: { ...this._tokenHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      form: params
    });
    if (res.status !== 200 || !res.json || !res.json.access_token) {
      throw new Error(`X 令牌交换失败: HTTP ${res.status} ${(res.text || '').slice(0, 200)}`);
    }
    return this._normalizeTokens(res.json);
  }

  async refreshToken(tokens) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: this.config.x.clientId
    });
    const res = await httpRequest(this.config.x.apiBaseUrl + '/2/oauth2/token', {
      method: 'POST',
      headers: { ...this._tokenHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      form: params
    });
    if (res.status !== 200 || !res.json || !res.json.access_token) {
      throw new Error(`X 令牌刷新失败: HTTP ${res.status} ${(res.text || '').slice(0, 200)}`);
    }
    return this._normalizeTokens(res.json);
  }

  _normalizeTokens(json) {
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || null,
      tokenType: json.token_type || 'Bearer',
      scope: json.scope || null,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null
    };
  }

  async fetchProfile(accessToken) {
    const res = await httpRequest(this.config.x.apiBaseUrl + '/2/users/me', {
      headers: authHeader(accessToken)
    });
    if (res.status !== 200 || !res.json || !res.json.data) {
      throw new Error(`X 获取用户信息失败: HTTP ${res.status} ${(res.text || '').slice(0, 200)}`);
    }
    const d = res.json.data;
    return { externalId: String(d.id), username: d.username, displayName: d.name || d.username };
  }

  /** 上传一张图片 → media id */
  async _uploadOne(accessToken, media) {
    const buf = fs.readFileSync(media.path);
    const form = new URLSearchParams();
    form.set('media_data', buf.toString('base64'));
    const res = await httpRequest(this.config.x.uploadBaseUrl + '/1.1/media/upload.json', {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/x-www-form-urlencoded' },
      form,
      timeoutMs: 60_000
    });
    if ((res.status === 200 || res.status === 202) && res.json && res.json.media_id_string) {
      return String(res.json.media_id_string);
    }
    // 回退 v2 分片上传
    return this._uploadOneV2(accessToken, buf, media);
  }

  async _uploadOneV2(accessToken, buf, media) {
    const base = this.config.x.apiBaseUrl;
    const init = new URLSearchParams({
      media_type: media.mime,
      total_bytes: String(buf.length),
      media_category: 'tweet_image'
    });
    const initRes = await httpRequest(base + '/2/media/upload/initialize', {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/x-www-form-urlencoded' },
      form: init,
      timeoutMs: 30_000
    });
    if (initRes.status !== 200 && initRes.status !== 201) {
      throw new Error(`X 图片上传失败(v1.1/v2): HTTP ${initRes.status} ${(initRes.text || '').slice(0, 200)}`);
    }
    const mediaId = String(initRes.json.data.id);

    const multipart = new FormData();
    multipart.append('segment_index', '0');
    multipart.append('media', new Blob([buf], { type: media.mime }), media.name || 'image');
    const appendRes = await fetch(`${base}/2/media/upload/${mediaId}/append`, {
      method: 'POST',
      headers: authHeader(accessToken),
      body: multipart
    });
    if (!appendRes.ok) {
      throw new Error(`X 图片上传 append 失败: HTTP ${appendRes.status} ${(await appendRes.text()).slice(0, 200)}`);
    }

    const finRes = await httpRequest(`${base}/2/media/upload/${mediaId}/finalize`, {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
      json: {},
      timeoutMs: 30_000
    });
    if (finRes.status !== 200 && finRes.status !== 201) {
      throw new Error(`X 图片上传 finalize 失败: HTTP ${finRes.status} ${(finRes.text || '').slice(0, 200)}`);
    }
    return mediaId;
  }

  async publishPost(account, msg) {
    const accessToken = account.tokens.accessToken;
    const mediaIds = [];
    for (const m of (msg.media || [])) {
      mediaIds.push(await this._uploadOne(accessToken, m));
    }
    const body = { text: msg.text || '' };
    if (mediaIds.length) body.media = { media_ids: mediaIds };
    if (msg.replyToId) body.reply = { in_reply_to_tweet_id: String(msg.replyToId) };

    const res = await httpRequest(this.config.x.apiBaseUrl + '/2/tweets', {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
      json: body,
      timeoutMs: 60_000
    });
    if ((res.status !== 200 && res.status !== 201) || !res.json || !res.json.data) {
      throw new Error(`X 发帖失败: HTTP ${res.status} ${(res.text || '').slice(0, 300)}`);
    }
    const id = String(res.json.data.id);
    return {
      platformPostId: id,
      permalink: `https://x.com/${account.username}/status/${id}`
    };
  }
}

module.exports = XAdapter;
