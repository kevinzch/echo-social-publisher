/**
 * test/preflight.test.js — 发布前本地校验（前后端共用）
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Preflight = require('../shared/preflight');

const X = { id: 'x', name: 'X', limits: { maxChars: 280, weighted: true, maxImages: 4, maxImageBytes: 5 * 1024 * 1024, imageMimes: ['image/png'] } };
const BS = { id: 'bluesky', name: 'Bluesky', limits: { maxChars: 300, weighted: false, maxImages: 4, maxImageBytes: 1024 * 1024, imageMimes: ['image/png'] } };
const MASTO = { id: 'mastodon', name: 'Mastodon', limits: { maxChars: 500, weighted: false, maxImages: 4, maxImageBytes: 16 * 1024 * 1024, imageMimes: ['image/png'] } };

const mediaMap = {
  small: { id: 'small', name: 'small.png', size: 200 * 1024, mime: 'image/png' },
  big: { id: 'big', name: 'big.png', size: 2 * 1024 * 1024, mime: 'image/png' },
  gif: { id: 'gif', name: 'anim.gif', size: 100 * 1024, mime: 'image/gif' }
};
const get = (id) => mediaMap[id] || null;

test('字数超限：按平台分别判定（X 加权 / 其他按字符）', () => {
  const segs = [{ text: 'a'.repeat(320), media: [], exclude: [] }];
  const issues = Preflight.analyze(segs, [X, BS, MASTO], get);
  const plats = issues.filter((i) => i.kind === 'chars').map((i) => i.platform);
  assert.deepEqual(plats.sort(), ['bluesky', 'x']);
  assert.ok(!plats.includes('mastodon'), 'Mastodon 500 字上限不应报错');
});

test('图片数量超限', () => {
  const segs = [{ text: 'hi', media: ['small', 'small', 'small', 'small', 'small'], exclude: [] }];
  const issues = Preflight.analyze(segs, [X], get);
  assert.equal(issues.filter((i) => i.kind === 'count').length, 1);
  assert.match(issues[0].message, /5 张/);
});

test('单图大小超限：按各平台上限分别判定', () => {
  const segs = [{ text: 'hi', media: ['big'], exclude: [] }];
  const issues = Preflight.analyze(segs, [BS, X, MASTO], get);
  const size = issues.filter((i) => i.kind === 'size').map((i) => i.platform);
  assert.deepEqual(size, ['bluesky'], '2MB 只超过 Bluesky 的 1MB');
  assert.match(issues[0].message, /2\.0 MB/);
});

test('图片格式不支持', () => {
  const segs = [{ text: 'hi', media: ['gif'], exclude: [] }];
  const issues = Preflight.analyze(segs, [X], get);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'mime');
});

test('被该段排除的平台不参与校验', () => {
  const segs = [{ text: 'a'.repeat(290), media: [], exclude: ['bluesky', 'x'] }];
  const issues = Preflight.analyze(segs, [X, BS], get);
  assert.equal(issues.length, 0);
});

test('空分段不参与校验；段号从 1 开始', () => {
  const segs = [
    { text: '', media: [], exclude: [] },
    { text: 'a'.repeat(600), media: [], exclude: [] }
  ];
  const issues = Preflight.analyze(segs, [MASTO], get);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].segNo, 2);
});

test('summary 截断并带总数', () => {
  const segs = [{ text: 'a'.repeat(600), media: ['big', 'big', 'big', 'big', 'big'], exclude: [] }];
  const issues = Preflight.analyze(segs, [X, BS, MASTO], get);
  const s = Preflight.summary(issues, 2);
  assert.match(s, /共 \d+ 项/);
});
