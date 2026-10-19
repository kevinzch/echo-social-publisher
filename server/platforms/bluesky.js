/**
 * server/platforms/bluesky.js — Bluesky (AT Protocol) 适配器
 *
 * - 认证：handle + App Password → com.atproto.server.createSession
 *   不用 OAuth（AT Protocol 的 OAuth 需要 PAR + DPoP，对个人工具过重）
 * - 令牌：accessJwt 约 2 小时；refreshJwt 长期，到期前用 refreshSession 续期（会轮换）
 * - 发帖：com.atproto.repo.createRecord（app.bsky.feed.post）
 * - 分段：reply { root, parent } 串成 thread（需要 cid，故覆写 publishThread）
 * - 图片：com.atproto.repo.uploadBlob → embed.images（最多 4 张，单张 ≤1MB）
 * - 富文本：自动为 URL 生成 facets，保证链接可点击
 */
'use strict';
const fs = require('fs');
const { PlatformAdapter } = require('./base');
const { httpRequest, authHeader } = require('../oauth');

const DEFAULT_PDS = 'https://bsky.social';
const ACCESS_TTL_MS = 2 * 3600 * 1000;

/** 为文本中的 URL 生成 richtext facets（byte 偏移按 UTF-8 计算） */
function buildLinkFacets(text) {
  const facets = [];
  const re = /https?:\/\/[^\s<>"'）)】]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[0];
    const byteStart = Buffer.byteLength(text.slice(0, m.index), 'utf8');
    const byteEnd = byteStart + Buffer.byteLength(url, 'utf8');
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }]
    });
  }
  return facets;
}

class BlueskyAdapter extends PlatformAdapter {
  static get id() { return 'bluesky'; }
  static get name() { return 'Bluesky'; }
  static get authDoc() { return 'bluesky'; }

  /** 凭据按账号存储，无需应用级配置 */
  isConfigured() { return true; }

  limits() {
    return {
      maxChars: 300,
      weighted: false,
      maxImages: 4,
      maxImageBytes: 1024 * 1024,
      imageMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      dailyPostCap: null,
      note: '300 字符；每帖最多 4 张图，单张 ≤1MB'
    };
  }

  _pds(tokens) {
    return (tokens && tokens.pds) || (this.config.bluesky && this.config.bluesky.service) || DEFAULT_PDS;
  }

  /** handle + App Password 建立会话（凭据连接入口） */
  async connect({ identifier, password } = {}) {
    const handle = String(identifier || '').trim();
    const pwd = String(password || '').trim();
    if (!handle || !pwd) {
      throw Object.assign(new Error('请填写 Bluesky 账号（handle）和 App Password'), { statusCode: 400 });
    }
    const pds = this._pds(null);
    const res = await httpRequest(pds + '/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      json: { identifier: handle, password: pwd },
      timeoutMs: 30_000
    });
    if (res.status !== 200 || !res.json || !res.json.accessJwt) {
      const msg = (res.json && (res.json.message || res.json.error)) || (res.text || '').slice(0, 200);
      throw Object.assign(new Error(`Bluesky 登录失败: HTTP ${res.status} ${msg}`), { statusCode: 401 });
    }
    const s = res.json;
    let displayName = s.handle;
    try {
      const p = await httpRequest(
        pds + '/xrpc/app.bsky.actor.getProfile?actor=' + encodeURIComponent(s.did),
        { headers: authHeader(s.accessJwt), timeoutMs: 15_000 }
      );
      if (p.status === 200 && p.json && p.json.displayName) displayName = p.json.displayName;
    } catch { /* 资料获取失败不影响连接 */ }

    return {
      externalId: s.did,
      username: s.handle,
      displayName,
      tokens: {
        accessToken: s.accessJwt,
        refreshToken: s.refreshJwt,
        tokenType: 'Bearer',
        expiresAt: Date.now() + ACCESS_TTL_MS,
        pds
      }
    };
  }

  async refreshToken(tokens) {
    const pds = this._pds(tokens);
    const res = await httpRequest(pds + '/xrpc/com.atproto.server.refreshSession', {
      method: 'POST',
      headers: authHeader(tokens.refreshToken),
      timeoutMs: 30_000
    });
    if (res.status !== 200 || !res.json || !res.json.accessJwt) {
      const msg = (res.json && (res.json.message || res.json.error)) || (res.text || '').slice(0, 200);
      throw new Error(`Bluesky 令牌刷新失败: HTTP ${res.status} ${msg}`);
    }
    return {
      accessToken: res.json.accessJwt,
      refreshToken: res.json.refreshJwt || tokens.refreshToken,
      tokenType: 'Bearer',
      expiresAt: Date.now() + ACCESS_TTL_MS,
      pds
    };
  }

  async fetchProfile(accessToken, tokens) {
    const pds = this._pds(tokens);
    const res = await httpRequest(pds + '/xrpc/com.atproto.server.getSession', {
      headers: authHeader(accessToken),
      timeoutMs: 15_000
    });
    if (res.status !== 200 || !res.json || !res.json.did) {
      throw new Error(`Bluesky 获取会话失败: HTTP ${res.status} ${(res.text || '').slice(0, 200)}`);
    }
    return {
      externalId: res.json.did,
      username: res.json.handle,
      displayName: res.json.handle
    };
  }

  async _uploadBlob(accessToken, pds, media) {
    const buf = fs.readFileSync(media.path);
    const res = await httpRequest(pds + '/xrpc/com.atproto.repo.uploadBlob', {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': media.mime || 'application/octet-stream' },
      body: buf,
      timeoutMs: 60_000
    });
    if (res.status !== 200 || !res.json || !res.json.blob) {
      throw new Error(`Bluesky 图片上传失败: HTTP ${res.status} ${(res.text || '').slice(0, 200)}`);
    }
    return res.json.blob;
  }

  async publishPost(account, msg) {
    const pds = this._pds(account.tokens);
    const accessToken = account.tokens.accessToken;
    const maxImages = this.limits().maxImages;

    const images = [];
    for (const m of (msg.media || []).slice(0, maxImages)) {
      const blob = await this._uploadBlob(accessToken, pds, m);
      images.push({ alt: '', image: blob });
    }

    const record = {
      $type: 'app.bsky.feed.post',
      text: msg.text || '',
      createdAt: new Date().toISOString()
    };
    const facets = buildLinkFacets(record.text);
    if (facets.length) record.facets = facets;
    if (images.length) record.embed = { $type: 'app.bsky.embed.images', images };
    if (msg.reply) record.reply = msg.reply;

    const res = await httpRequest(pds + '/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: { ...authHeader(accessToken), 'Content-Type': 'application/json' },
      json: {
        repo: account.externalId,
        collection: 'app.bsky.feed.post',
        record
      },
      timeoutMs: 60_000
    });
    if (res.status !== 200 || !res.json || !res.json.uri) {
      throw new Error(`Bluesky 发帖失败: HTTP ${res.status} ${(res.text || '').slice(0, 300)}`);
    }
    const uri = res.json.uri;
    const rkey = String(uri).split('/').pop();
    return {
      platformPostId: uri,
      cid: res.json.cid,
      permalink: `https://bsky.app/profile/${account.username}/post/${rkey}`
    };
  }

  /** thread：reply 需要 root + parent 两个引用，逐条记录 cid */
  async publishThread(account, segments) {
    const results = [];
    let root = null;
    let parent = null;
    for (const seg of segments) {
      const msg = { text: seg.text || '', media: seg.media || [] };
      if (root && parent) msg.reply = { root, parent };
      const r = await this.publishPost(account, msg);
      const ref = { uri: r.platformPostId, cid: r.cid };
      if (!root) root = ref;
      parent = ref;
      results.push({ platformPostId: r.platformPostId, permalink: r.permalink });
    }
    return results;
  }
}

module.exports = BlueskyAdapter;
module.exports.buildLinkFacets = buildLinkFacets;
