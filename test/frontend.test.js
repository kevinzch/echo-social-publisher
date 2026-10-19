/**
 * test/frontend.test.js — 前端静态守卫
 * 背景：2026-10-19 一次编辑误删 `var cp = ev.target.closest(...)` 声明，
 * 导致账号页点击全部静默失效（ReferenceError，node --check 查不出）。
 * 这里用可编译性 + 结构配对检查堵住这类回归。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('app.js 可编译（语法正确）', () => {
  assert.doesNotThrow(() => new Function(appJs), 'app.js 存在语法错误');
});

test('每个 ev.target.closest() 的返回值都被赋值（防点击静默失效）', () => {
  const re = /(?:var\s+(\w+)\s*=\s*)?ev\.target\.closest\(/g;
  const unassigned = [];
  let m;
  while ((m = re.exec(appJs)) !== null) {
    if (!m[1]) {
      unassigned.push(appJs.slice(m.index, m.index + 70).split('\n')[0]);
    }
  }
  assert.equal(
    unassigned.length, 0,
    '以下 ev.target.closest() 未赋值，点击时会因未声明变量静默失效：\n' + unassigned.join('\n')
  );
  // 至少应存在若干事件委托（保证检查本身有效）
  const total = appJs.match(/ev\.target\.closest\(/g) || [];
  assert.ok(total.length >= 3, '未找到足够的事件委托，检查可能失效');
});

test('账号页三大操作处理器变量声明齐全', () => {
  // copy / connect / unbind 三个处理器
  assert.match(appJs, /var\s+cp\s*=\s*ev\.target\.closest\('\[data-copy\]'\)/);
  assert.match(appJs, /var\s+c\s*=\s*ev\.target\.closest\('\[data-connect\]'\)/);
  assert.match(appJs, /var\s+u\s*=\s*ev\.target\.closest\('\[data-unbind\]'\)/);
});

test('共享库与页面骨架被正确引用', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /src="\/shared\/chars\.js"/);
  assert.match(html, /src="\/shared\/threadText\.js"/);
  assert.match(html, /src="\/app\.js"/);
  // app.js 使用了共享库暴露的全局
  assert.match(appJs, /EchoChars\.analyze/);
  assert.match(appJs, /EchoThreadText\.splitSegments/);
});
