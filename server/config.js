/**
 * server/config.js — 环境变量与默认配置
 * 支持按优先级：process.env > .env 文件 > 默认值
 */
'use strict';
const fs = require('fs');
const path = require('path');

function loadDotEnv(filePath) {
  const out = {};
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return out; // 没有 .env 就用默认值（未配置平台凭证时相关平台显示"未配置"）
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const rootDir = path.resolve(__dirname, '..');
const dotenv = loadDotEnv(path.join(rootDir, '.env'));

function env(key, fallback) {
  if (process.env[key] != null && process.env[key] !== '') return process.env[key];
  if (dotenv[key] != null && dotenv[key] !== '') return dotenv[key];
  return fallback;
}

function envInt(key, fallback) {
  const v = env(key, null);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const port = envInt('PORT', 8787);
// 注意：X 开发者控制台拒绝 localhost 形式的回调 URL（报 "Not a valid URL format"），
// 必须使用 127.0.0.1（或自定义本地域名）。此值会原样作为 OAuth redirect_uri 发给平台，
// 必须与 X/Threads 后台登记的回调地址逐字符一致。
const appBaseUrl = env('APP_BASE_URL', `http://127.0.0.1:${port}`).replace(/\/+$/, '');

const config = {
  rootDir,
  port,
  appBaseUrl,

  // 数据目录（草稿/账号/队列/媒体）
  dataDir: env('ECHO_DATA_DIR', path.join(rootDir, 'data')),

  // 调度器
  schedulerIntervalMs: envInt('SCHEDULER_INTERVAL_MS', 30_000),
  maxPublishAttempts: envInt('ECHO_MAX_ATTEMPTS', 3),
  retryBackoffMinutes: [5, 15, 60],

  // 外部请求超时
  httpTimeoutMs: envInt('ECHO_HTTP_TIMEOUT_MS', 20_000),

  // X (Twitter) OAuth2 应用凭证
  x: {
    clientId: env('X_CLIENT_ID', ''),
    clientSecret: env('X_CLIENT_SECRET', ''),
    // 测试/Mock 时可覆盖默认域名
    authBaseUrl: env('X_AUTH_BASE_URL', 'https://twitter.com'),
    apiBaseUrl: env('X_API_BASE_URL', 'https://api.twitter.com'),
    uploadBaseUrl: env('X_UPLOAD_BASE_URL', 'https://upload.twitter.com'),
    callbackPath: '/auth/x/callback'
  },

  // Threads OAuth2 应用凭证
  threads: {
    clientId: env('THREADS_CLIENT_ID', ''),
    clientSecret: env('THREADS_CLIENT_SECRET', ''),
    apiBaseUrl: env('THREADS_API_BASE_URL', 'https://graph.threads.net'),
    callbackPath: '/auth/threads/callback',
    // Threads 发布图片需要公网可访问 URL；本地可用隧道地址覆盖
    imageBaseUrl: env('THREADS_IMAGE_BASE_URL', appBaseUrl).replace(/\/+$/, '')
  },

  // 上传限制（取两平台并集的宽松上限，平台级校验在发布时执行）
  maxUploadBytes: envInt('ECHO_MAX_UPLOAD_BYTES', 8 * 1024 * 1024),
  allowedUploadMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],

  // 日志
  logRetention: envInt('ECHO_LOG_RETENTION', 500)
};

config.x.callbackUrl = config.appBaseUrl + config.x.callbackPath;
config.threads.callbackUrl = config.appBaseUrl + config.threads.callbackPath;

// 每平台独立的 OAuth 回调地址（默认跟随 APP_BASE_URL）。
// 背景：X 控制台拒绝 localhost（须用 127.0.0.1，HTTP 可）；Meta Threads 强制要求 HTTPS，
// 本机 HTTP 无法满足——需用隧道（cloudflared/ngrok）拿到 HTTPS 地址后单独配置。
// 平台后台登记的回调必须与此处逐字符一致。
config.x.redirectUri = env('X_REDIRECT_URI', config.x.callbackUrl).replace(/\/+$/, '');
config.threads.redirectUri = env('THREADS_REDIRECT_URI', config.threads.callbackUrl).replace(/\/+$/, '');

module.exports = config;
