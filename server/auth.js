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

    const { profile, tokens } = await platform.exchangeCode({ code, codeVerifier: pending.verifier, redirectUri: platform.redirectUri });
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

  publicView(account) {
    return {
      id: account.id,
      platform: account.platform,
      username: account.username,
      displayName: account.displayName,
      enabled: account.enabled !== false,
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
