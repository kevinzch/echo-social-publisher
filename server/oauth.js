/**
 * server/oauth.js — PKCE / state / HTTP 请求基础设施
 */
'use strict';
const crypto = require('crypto');
const { randomUrlSafe, sha256, base64url } = require('./http');

class PendingAuthStore {
  /** state -> { platform, verifier, meta, createdAt }；一次性、5 分钟有效 */
  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }
  create(platform, meta) {
    const state = randomUrlSafe(16);
    const verifier = randomUrlSafe(32);
    this.map.set(state, { platform, verifier, meta: meta || {}, createdAt: Date.now() });
    return { state, verifier };
  }
  consume(state) {
    const entry = this.map.get(state);
    if (!entry) return null;
    this.map.delete(state);
    if (Date.now() - entry.createdAt > this.ttlMs) return null;
    return entry;
  }
  size() { return this.map.size; }
}

/** S256 code challenge */
function pkceChallenge(verifier) {
  return base64url(sha256(verifier));
}

function expiresAtFrom(json, fallbackMs) {
  if (json && typeof json.expires_in === 'number') {
    return Date.now() + json.expires_in * 1000;
  }
  return fallbackMs ? Date.now() + fallbackMs : null;
}

/**
 * 统一 HTTP 请求：支持 form / json，返回 {status, headers, text, json}
 */
async function httpRequest(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    form,          // URLSearchParams
    json,          // object
    body,          // Buffer/string
    timeoutMs = 20000
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = { method, headers: { ...headers }, signal: controller.signal };
  if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = form;
  } else if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (body !== undefined) {
    init.body = body;
  }

  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      try { parsed = JSON.parse(text); } catch { /* keep null */ }
    }
    return { status: res.status, headers: res.headers, text, json: parsed };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`请求超时（>${timeoutMs}ms）: ${String(url).slice(0, 120)}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function authHeader(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

module.exports = { PendingAuthStore, pkceChallenge, expiresAtFrom, httpRequest, authHeader };
