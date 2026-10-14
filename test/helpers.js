/**
 * test/helpers.js — 测试辅助：mock HTTP 服务 + 临时数据目录
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * 启动一个 mock HTTP 服务。
 * handler({ method, path, query, body, form, json, headers }) => {status, body, headers}
 */
function startMock(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://local');
    const contentType = req.headers['content-type'] || '';
    let form = null, json = null;
    if (contentType.includes('application/x-www-form-urlencoded')) {
      form = Object.fromEntries(new URLSearchParams(raw));
    } else if (contentType.includes('application/json') && raw) {
      try { json = JSON.parse(raw); } catch { /* keep null */ }
    }
    let result;
    try {
      result = await handler({ method: req.method, path: url.pathname, query: url.searchParams, body: raw, form, json, headers: req.headers });
    } catch (err) {
      result = { status: 500, body: { error: String(err && err.message) } };
    }
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mock: no route' }));
      return;
    }
    const payload = typeof result.body === 'object' && result.body !== null
      ? JSON.stringify(result.body)
      : String(result.body == null ? '{}' : result.body);
    res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
    res.end(payload);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function baseUrlOf(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'echo-test-'));
}

/** 1x1 透明 PNG（用于媒体测试） */
const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function pngRecord(name) {
  return { name: name || 'pixel.png', mime: 'image/png', dataBase64: PNG_1PX_BASE64 };
}

module.exports = { startMock, baseUrlOf, tmpDir, pngRecord, PNG_1PX_BASE64 };
