/**
 * test/chars.test.js — 中英文计数与 X 加权
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const EchoChars = require('../shared/chars');

test('中英文字符分别计数', () => {
  const a = EchoChars.analyze('Hello 世界');
  assert.equal(a.total, 8);   // 'Hello ' 6 个 + '世界' 2 个
  assert.equal(a.chinese, 2);
  assert.equal(a.other, 6);
});

test('空文本返回全 0', () => {
  const zero = { total: 0, chinese: 0, other: 0, weighted: 0, urls: 0, urlChars: 0, literal: 0 };
  assert.deepEqual(EchoChars.analyze(''), zero);
  assert.deepEqual(EchoChars.analyze(null), zero);
});

test('countFor：URL 按平台规则计数', () => {
  const url = 'https://www.reddit.com/r/witcher/comments/e7skgr/does_anyone_else_get_annoyed/';
  assert.equal(EchoChars.countFor(url, { weighted: true }), 23, 'X 链接按 23 计');
  assert.equal(EchoChars.countFor(url, { urlWeight: 23 }), 23, 'Mastodon 链接按 23 计');
  assert.equal(EchoChars.countFor(url, {}), url.length, 'Threads/Bluesky 按字面计');
  assert.equal(EchoChars.countFor('你好 abc', { weighted: true }), 8, '中文各 2、空格与英文各 1');
});

test('X 加权：中文按 2 计', () => {
  const a = EchoChars.analyze('你好');
  assert.equal(a.total, 2);
  assert.equal(a.chinese, 2);
  assert.equal(a.weighted, 4);
});

test('X 加权：英文逐字符 1', () => {
  const a = EchoChars.analyze('hello world');
  assert.equal(a.total, 11);
  assert.equal(a.weighted, 11);
});

test('X 加权：URL 整体按 23 计', () => {
  const a = EchoChars.analyze('see https://example.com/very/long/path now');
  assert.equal(a.urls, 1);
  // 'see ' 4 + ' now' 4 + 23
  assert.equal(a.weighted, 4 + 4 + 23);
});

test('X 加权：多个 URL', () => {
  const a = EchoChars.analyze('https://a.com https://b.io');
  assert.equal(a.urls, 2);
  assert.equal(a.weighted, 23 * 2 + 1); // 两个 URL 之间还有 1 个空格
});

test('X 加权：全角标点与 emoji', () => {
  const a = EchoChars.analyze('你好，world！');
  assert.equal(a.chinese, 2);          // ，！不算"中文"，归入 other
  // 你好(2×2) + ，(2) + world(5) + ！(2) = 13
  assert.equal(a.weighted, 13);
  const e = EchoChars.analyze('🔥');
  assert.equal(e.total, 1);
  assert.equal(e.weighted, 2);
});

test('混合中英 + 链接的剩余字数', () => {
  const text = '中文测试 English text https://openai.com';
  const a = EchoChars.analyze(text);
  assert.equal(a.chinese, 4);
  assert.equal(a.urls, 1);
  // 中文 4×2 + ' English text ' 14 + URL 23
  assert.equal(a.weighted, 4 * 2 + 14 + 23);
  assert.equal(EchoChars.remainingX(text, 280), 280 - a.weighted);
});

test('日文假名按加权 2 计', () => {
  const a = EchoChars.analyze('こんにちは');
  assert.equal(a.total, 5);
  assert.equal(a.weighted, 10);
  assert.equal(a.chinese, 0); // 假名不计入"中文"分类
});
