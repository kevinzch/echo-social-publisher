/**
 * server/platforms.js — 平台适配器注册表
 * 新增平台（微博/小红书）：实现适配器后在这里注册一行。
 *
 * 适配器实例按传入的 config 创建（默认用全局 config），
 * 这样测试可以注入 mock API 地址。
 */
'use strict';
const XAdapter = require('./platforms/x');
const ThreadsAdapter = require('./platforms/threads');

function makeRegistry(config) {
  return {
    x: new XAdapter(config),
    threads: new ThreadsAdapter(config)
    // weibo: new WeiboAdapter(config),        // ← 未来扩展
    // xiaohongshu: new XiaohongshuAdapter(config)
  };
}

let defaultRegistry = null;
function getRegistry(config) {
  if (config) return makeRegistry(config);
  if (!defaultRegistry) defaultRegistry = makeRegistry(require('./config'));
  return defaultRegistry;
}

function getPlatform(id, config) {
  const r = getRegistry(config);
  return r[id] || null;
}

function listPlatforms(config) {
  return Object.values(getRegistry(config)).map((p) => ({
    id: p.constructor.id,
    name: p.constructor.name,
    configured: p.isConfigured(),
    authDoc: p.constructor.authDoc,
    limits: p.limits()
  }));
}

module.exports = { getRegistry, makeRegistry, getPlatform, listPlatforms };
