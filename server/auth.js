/**
 * server/auth.js — 账号连接与令牌生命周期管理
 */
'use strict';
const { PendingAuthStore, pkceChallenge } = require('./oauth');
const { getPlatform } = require('./platforms');

class AccountService {
  /**
   * @param {import('./store').Store} store
   * @param {object} config
   */
  constructor(store, config) {
    this.store = store;
    this.config = config;
    this.pending = new PendingAuthStore();
  }

  /** 生成授权 URL（含 state / PKCE） */
  startAuth(platformId) {
    const platform = getPlatform(platformId, this.config);
    if (!platform) throw Object.assign(new Error(`未知平台: ${platformId}`), { statusCode: 404 });
    if (!platform.isConfigured()) {
      throw Object.assign(new Error(`未配置 ${platform.constructor.name} 的 API 凭证，请参考 docs/API_APPLY_GUIDE.md`), {
        statusCode: 400,
        code: 'NOT_CONFIGURED'
      });
    }
    const { state, verifier } = this.pending.create(platformId);
    const codeChallenge = pkceChallenge(verifier);
    const redirectUri = platform.redirectUri;
    const authUrl = platform.buildAuthorizeUrl({ state, codeChallenge, redirectUri });
    return { state, authUrl, redirectUri, callbackUrl: platform.callbackUrl ? platform.callbackUrl() : null };
  }

  /** OAuth 回调：校验 state → 换 token → 拉资料 → 落库 */
  async handleCallback(platformId, { code, state }) {
    const platform = getPlatform(platformId, this.config);
    if (!platform) throw Object.assign(new Error(`未知平台: ${platformId}`), { statusCode: 404 });
    const pending = this.pending.consume(state);
    if (!pending) throw Object.assign(new Error('state 无效或已过期，请重新连接'), { statusCode: 400 });
    if (pending.platform !== platformId) throw Object.assign(new Error('state 与平台不匹配'), { statusCode: 400 });

    // 1) code → tokens；2) tokens → 用户资料（exchangeCode 不返回 profile，需单独拉取）
    const tokens = await platform.exchangeCode({ code, codeVerifier: pending.verifier, redirectUri: platform.redirectUri });
    const profile = await platform.fetchProfile(tokens.accessToken);
    if (!profile || !profile.externalId) {
      throw Object.assign(new Error('获取平台用户资料失败，请重试'), { statusCode: 502 });
    }
    const accountId = `${platformId}:${profile.externalId}`;
    const existing = this.store.accounts.get(accountId);
    const now = new Date().toISOString();
    const account = {
      id: accountId,
      platform: platformId,
      externalId: profile.externalId,
      username: profile.username,
      displayName: profile.displayName || profile.username,
      tokens,
      enabled: true,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    if (existing) await this.store.accounts.update(accountId, account);
    else await this.store.accounts.insert(account);
    await this.store.log('info', 'auth', `连接账号 ${platformId}:${profile.username}`);
    return this.publicView(account);
  }

  /** 列表（不含令牌） */
  listAccounts() {
    return this.store.accounts.list().map((a) => this.publicView(a));
  }

  /**
   * 手动粘贴长期令牌连接（Threads 专用）
   * 用于绕开 OAuth 回调配置：令牌来源 = Meta 应用后台的「用户口令生成器」。
   * 仍会调用 fetchProfile 验证令牌有效性后才落库。
   */
  async connectWithManualToken(platformId, token) {
    const platform = getPlatform(platformId, this.config);
    if (!platform) throw Object.assign(new Error(`未知平台: ${platformId}`), { statusCode: 404 });
    if (platformId !== 'threads') {
      throw Object.assign(new Error('手动令牌连接目前仅支持 Threads（X 的访问令牌 2 小时即过期，必须走 OAuth 自动刷新）'), { statusCode: 400 });
    }
    const clean = typeof token === 'string' ? token.trim() : '';
    if (clean.length < 20) {
      throw Object.assign(new Error('令牌格式不正确（太短），请粘贴 Meta 后台生成的完整长期令牌'), { statusCode: 400 });
    }
    let profile;
    try {
      profile = await platform.fetchProfile(clean);
    } catch (err) {
      throw Object.assign(new Error(`令牌验证失败：${err.message}（请确认是「用户口令生成器」生成的有效令牌）`), { statusCode: 401 });
    }
    if (!profile || !profile.externalId) {
      throw Object.assign(new Error('令牌验证失败：无法读取用户资料'), { statusCode: 401 });
    }
    const accountId = `${platformId}:${profile.externalId}`;
    const existing = this.store.accounts.get(accountId);
    const now = new Date().toISOString();
    // 长期令牌约 60 天有效；确切到期时间未知，按 59 天估算，
    // 到期前 ensureFreshToken 会自动用 th_refresh_token 续期（长期令牌满 24h 可续）
    const expiresAt = Date.now() + 59 * 24 * 3600 * 1000;
    const account = {
      id: accountId,
      platform: platformId,
      externalId: profile.externalId,
      username: profile.username,
      displayName: profile.displayName || profile.username,
      tokens: { accessToken: clean, refreshToken: clean, tokenType: 'Bearer', scope: null, expiresAt },
      manual: true,
      enabled: true,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    if (existing) await this.store.accounts.update(accountId, account);
    else await this.store.accounts.insert(account);
    await this.store.log('info', 'auth', `手动令牌连接账号 ${platformId}:${profile.username}`);
    return this.publicView(account);
  }

  /**
   * 按凭据连接（Bluesky / Mastodon 等无 OAuth 的平台）
   * credentials 结构由各平台 connect() 定义：
   *   bluesky:  { identifier, password }
   *   mastodon: { instance, token }
   */
  async connectWithCredentials(platformId, credentials) {
    const platform = getPlatform(platformId, this.config);
    if (!platform) throw Object.assign(new Error(`未知平台: ${platformId}`), { statusCode: 404 });
    if (typeof platform.connect !== 'function') {
      throw Object.assign(new Error(`${platform.constructor.name} 不支持凭据连接，请使用 OAuth 授权`), { statusCode: 400 });
    }

    let result;
    try {
      result = await platform.connect(credentials || {});
    } catch (err) {
      throw Object.assign(new Error(err.message || '凭据验证失败'), { statusCode: err.statusCode || 401 });
    }
    if (!result || !result.externalId || !result.tokens) {
      throw Object.assign(new Error('凭据验证失败：未获取到账号信息'), { statusCode: 401 });
    }

    const accountId = `${platformId}:${result.externalId}`;
    const existing = this.store.accounts.get(accountId);
    const now = new Date().toISOString();
    const account = {
      id: accountId,
      platform: platformId,
      externalId: String(result.externalId),
      username: result.username,
      displayName: result.displayName || result.username,
      tokens: result.tokens,
      manual: true,
      enabled: true,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    if (existing) await this.store.accounts.update(accountId, account);
    else await this.store.accounts.insert(account);
    await this.store.log('info', 'auth', `凭据连接账号 ${platformId}:${result.username}`);
    return this.publicView(account);
  }

  publicView(account) {
    return {
      id: account.id,
      platform: account.platform,
      username: account.username,
      displayName: account.displayName,
      enabled: account.enabled !== false,
      manual: !!account.manual,
      tokenExpiresAt: account.tokens && account.tokens.expiresAt ? new Date(account.tokens.expiresAt).toISOString() : null,
      tokenExpired: !!(account.tokens && account.tokens.expiresAt && account.tokens.expiresAt < Date.now()),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    };
  }

  getAccount(id) {
    return this.store.accounts.get(id);
  }

  async disconnect(id) {
    const ok = await this.store.accounts.remove(id);
    if (ok) await this.store.log('info', 'auth', `解绑账号 ${id}`);
    return ok;
  }

  /** 令牌将过期时自动刷新 */
  async ensureFreshToken(account) {
    const platform = getPlatform(account.platform, this.config);
    const expiresAt = account.tokens && account.tokens.expiresAt;
    const needsRefresh = expiresAt && this._shouldRefresh(account.platform, expiresAt);
    if (!needsRefresh) return account;
    const merged = await platform.refreshToken(account.tokens);
    const tokens = {
      ...account.tokens,
      accessToken: merged.accessToken || account.tokens.accessToken,
      refreshToken: merged.refreshToken || account.tokens.refreshToken,
      expiresAt: merged.expiresAt || account.tokens.expiresAt,
      tokenType: merged.tokenType || account.tokens.tokenType,
      scope: merged.scope || account.tokens.scope
    };
    const updated = await this.store.accounts.update(account.id, {
      tokens,
      updatedAt: new Date().toISOString()
    });
    await this.store.log('info', 'auth', `刷新令牌 ${account.id}`);
    return updated;
  }

  _shouldRefresh(platformId, expiresAt) {
    const remainMs = expiresAt - Date.now();
    if (remainMs <= 0) return true;
    if (platformId === 'x') return remainMs < 10 * 60 * 1000;      // X：10 分钟内过期就续
    if (platformId === 'threads') return remainMs < 7 * 24 * 3600 * 1000; // Threads：剩余 7 天内续（满 24h 可续）
    return remainMs < 10 * 60 * 1000;
  }
}

module.exports = { AccountService };
