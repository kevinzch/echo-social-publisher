/**
 * server/store.js — JSON 原子存储
 * - 每个集合一个文件（accounts/drafts/posts/settings/logs）
 * - 写操作串行化 + 临时文件 rename 原子替换，避免写一半损坏
 * - 容量小、单人使用，读全量放内存副本并提供同步 getter
 */
'use strict';
const fs = require('fs');
const path = require('path');

class Collection {
  constructor(file) {
    this.file = file;
    this.items = [];
    this.writeChain = Promise.resolve();
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.items = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.items = [];
    }
  }

  /** 原子写：先写 .tmp 再 rename */
  _flushSync() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2));
    fs.renameSync(tmp, this.file);
  }

  _mutate(fn) {
    // 串行化写，保证并发安全
    this.writeChain = this.writeChain.then(async () => {
      const result = fn(this.items);
      this._flushSync();
      return result;
    }).catch((err) => {
      // 写失败不能拖垮后续写
      console.error('[store] write failed:', err.message);
      throw err;
    });
    return this.writeChain;
  }

  list() { return this.items.slice(); }
  get(id) { return this.items.find((x) => x.id === id) || null; }
  find(predicate) { return this.items.find(predicate) || null; }
  filter(predicate) { return this.items.filter(predicate); }

  async insert(item) {
    return this._mutate((items) => {
      items.push(item);
      return item;
    });
  }

  async update(id, patch) {
    return this._mutate((items) => {
      const idx = items.findIndex((x) => x.id === id);
      if (idx === -1) return null;
      items[idx] = { ...items[idx], ...patch, id: items[idx].id };
      return items[idx];
    });
  }

  async remove(id) {
    return this._mutate((items) => {
      const idx = items.findIndex((x) => x.id === id);
      if (idx === -1) return false;
      items.splice(idx, 1);
      return true;
    });
  }

  /** 测试辅助：按需裁剪 */
  async truncate() {
    return this._mutate((items) => { items.length = 0; return true; });
  }
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const file = (name) => path.join(dataDir, `${name}.json`);
    this.accounts = new Collection(file('accounts'));
    this.drafts = new Collection(file('drafts'));
    this.posts = new Collection(file('posts'));
    this.logs = new Collection(file('logs'));
    this._settingsFile = file('settings');
    this._settingsCache = null;
  }

  get settings() {
    if (!this._settingsCache) {
      try {
        this._settingsCache = JSON.parse(fs.readFileSync(this._settingsFile, 'utf8'));
      } catch {
        this._settingsCache = null;
      }
    }
    return this._settingsCache || {};
  }

  saveSettings(patch) {
    const next = { ...this.settings, ...patch };
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = this._settingsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, this._settingsFile);
    this._settingsCache = next;
    return next;
  }

  /** 写日志并裁剪保留条数 */
  async log(level, scope, message, data) {
    const entry = {
      id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      level, scope, message,
      data: data || null
    };
    await this.logs.insert(entry);
    const retention = this.settings.logRetention || 500;
    const over = this.logs.items.length - retention;
    if (over > 0) {
      await this.logs._mutate((items) => { items.splice(0, over); });
    }
    return entry;
  }
}

let singleton = null;
function getStore(dataDir) {
  if (!singleton) singleton = new Store(dataDir);
  return singleton;
}

module.exports = { Store, Collection, getStore };
