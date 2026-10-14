/**
 * server/media.js — 本地媒体存储
 * data/media/<id><ext> + data/media.json 元数据
 * HTTP 路由 /media/<id><ext> 提供文件访问（Threads 发布时需公网可达，见架构文档 §5.3）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

class MediaStore {
  constructor(dataDir, { allowedMimes, maxBytes }) {
    this.dir = path.join(dataDir, 'media');
    this.metaFile = path.join(dataDir, 'media.json');
    this.allowedMimes = allowedMimes;
    this.maxBytes = maxBytes;
    this.items = [];
    this.writeChain = Promise.resolve();
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      const parsed = JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
      this.items = Array.isArray(parsed) ? parsed : [];
    } catch { this.items = []; }
  }

  _flush() {
    const tmp = this.metaFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2));
    fs.renameSync(tmp, this.metaFile);
  }

  /**
   * @param {{name:string, mime:string, size:number, dataBase64:string}} input
   * @returns {Promise<{id,name,mime,size,ext,createdAt}>}
   */
  async save(input) {
    if (!this.allowedMimes.includes(input.mime)) {
      throw new Error(`不支持的图片格式: ${input.mime}（支持 ${this.allowedMimes.join('/')}）`);
    }
    const size = input.size || Buffer.from(input.dataBase64 || '', 'base64').length;
    if (!size || size > this.maxBytes) {
      throw new Error(`图片大小需在 1B ~ ${Math.floor(this.maxBytes / 1024 / 1024)}MB 之间（当前 ${Math.ceil(size / 1024 / 1024)}MB）`);
    }
    const id = `med_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = EXT_BY_MIME[input.mime] || '.bin';
    const record = {
      id,
      name: input.name || `image${ext}`,
      mime: input.mime,
      size,
      ext,
      createdAt: new Date().toISOString()
    };
    this.writeChain = this.writeChain.then(() => {
      fs.writeFileSync(path.join(this.dir, id + ext), Buffer.from(input.dataBase64, 'base64'));
      this.items.push(record);
      this._flush();
    });
    await this.writeChain;
    return record;
  }

  get(id) {
    return this.items.find((x) => x.id === id) || null;
  }

  pathOf(record) {
    return path.join(this.dir, record.id + record.ext);
  }

  /** 供 Threads 使用的公网 URL */
  urlFor(record, baseUrl) {
    return `${String(baseUrl).replace(/\/+$/, '')}/media/${record.id}${record.ext}`;
  }

  /** 删除（仅当不再被任何草稿引用时由路由层调用） */
  async remove(id) {
    const record = this.get(id);
    if (!record) return false;
    this.writeChain = this.writeChain.then(() => {
      try { fs.unlinkSync(this.pathOf(record)); } catch { /* 文件可能已不在 */ }
      this.items = this.items.filter((x) => x.id !== id);
      this._flush();
    });
    await this.writeChain;
    return true;
  }

  list() { return this.items.slice(); }
}

module.exports = { MediaStore, EXT_BY_MIME };
