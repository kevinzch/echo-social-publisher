/**
 * test/threadText.test.js — 手动分段
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const TT = require('../shared/threadText');

test('单行 --- 即分段', () => {
  assert.deepEqual(TT.splitSegments('第一段\n---\n第二段'), ['第一段', '第二段']);
});

test('带空行的标准写法', () => {
  const text = '第一段\n\n---\n\n第二段\n\n---\n\n第三段';
  assert.deepEqual(TT.splitSegments(text), ['第一段', '第二段', '第三段']);
});

test('连续分隔符不产生空段', () => {
  assert.deepEqual(TT.splitSegments('a\n---\n---\n---\nb'), ['a', 'b']);
});

test('无分隔符时为 1 段', () => {
  assert.deepEqual(TT.splitSegments('single line\ntwo lines'), ['single line\ntwo lines']);
});

test('空输入返回空数组', () => {
  assert.deepEqual(TT.splitSegments(''), []);
  assert.deepEqual(TT.splitSegments(null), []);
});

test('--- 前后有空白字符也识别', () => {
  assert.deepEqual(TT.splitSegments('a\n  ---  \nb'), ['a', 'b']);
});

test('joinSegments 与 splitSegments 互为逆运算', () => {
  const segs = ['一', '二', '三'];
  const text = TT.joinSegments(segs);
  assert.deepEqual(TT.splitSegments(text), segs);
});

test('joinSegments 过滤空段', () => {
  assert.equal(TT.joinSegments(['a', '', 'b', '  ']), 'a\n\n---\n\nb');
});

test('insertSeparator 在光标处插入分隔行', () => {
  const r = TT.insertSeparator('ABCDEF', 3);
  assert.equal(r.text, 'ABC\n\n---\n\nDEF');
  assert.equal(r.text.slice(0, r.cursorPos).endsWith('\n\n'), true);
});

test('insertSeparator 光标在末尾', () => {
  const r = TT.insertSeparator('ABC', 3);
  assert.equal(r.text, 'ABC\n\n---\n\n');
  assert.deepEqual(TT.splitSegments(r.text + 'def'), ['ABC', 'def']);
});

test('previewSegments 与 splitSegments 一致', () => {
  const text = 'x\n---\ny';
  assert.deepEqual(TT.previewSegments(text), TT.splitSegments(text));
});
