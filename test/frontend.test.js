/**
 * test/frontend.test.js — 前端静态守卫
 * 覆盖两类真实事故：
 * 1. 编辑误删声明导致点击静默失效（ReferenceError）
 * 2. view.addEventListener 每次渲染重复绑定，导致确认框/动作叠加
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

test('app.js 可编译（语法正确）', () => {
  assert.doesNotThrow(() => new Function(appJs), 'app.js 存在语法错误');
});

test('点击事件走全局委托，视图渲染不再绑定 view 级监听（防叠加）', () => {
  assert.match(appJs, /document\.addEventListener\('click', handleGlobalClick\)/);
  assert.doesNotMatch(appJs, /view\.addEventListener\('click'/, 'renderXxx 中不应再挂 view 级 click 监听');
  ['data-del-draft', 'data-edit', 'data-pub-now', 'data-cancel', 'data-retry', 'data-connect', 'data-unbind', 'data-rm-media']
    .forEach(function (attr) {
      assert.ok(appJs.indexOf(attr) !== -1, '全局委托缺少 ' + attr + ' 处理');
    });
});

test('立即发布/定时发布不落草稿，且有防重复发布', () => {
  assert.match(appJs, /\/api\/compose\/publish/);
  assert.match(appJs, /\/api\/compose\/schedule/);
  assert.match(appJs, /if \(state\.publishing\) return;/);

  const pubStart = appJs.indexOf('async function publishDraft');
  const schedStart = appJs.indexOf('async function scheduleDraft');
  const pubFn = appJs.slice(pubStart, schedStart);
  assert.ok(pubStart > 0 && schedStart > pubStart, '未找到 publishDraft/scheduleDraft');
  assert.ok(pubFn.indexOf('saveDraft(') === -1, 'publishDraft 不应调用 saveDraft（否则会写入草稿箱）');
  const schedFn = appJs.slice(schedStart, schedStart + 1200);
  assert.ok(schedFn.indexOf('saveDraft(') === -1, 'scheduleDraft 不应调用 saveDraft');
});

test('发布进程弹窗：逐账号状态与关闭控制', () => {
  assert.match(html, /id="publish-modal"/);
  assert.match(html, /id="publish-rows"/);
  assert.match(html, /id="publish-close"/);
  assert.match(appJs, /function openPublishModal/);
  assert.match(appJs, /function updatePublishRow/);
  assert.match(appJs, /function setComposerBusy/);
  assert.match(css, /\.publish-row/);
});

test('图片交互：输入框添加 + 剪贴板粘贴 + 媒体条 + 清空同步', () => {
  assert.match(appJs, /id="btn-add-image"/);
  assert.match(appJs, /addEventListener\('paste'/);
  assert.match(appJs, /function renderMediaStrip/);
  assert.match(appJs, /function syncSegMedia/);
  assert.match(appJs, /function segmentIndexAt/);
  assert.ok(appJs.indexOf('data-add-media') === -1, '分段卡片内不应再有添加图片按钮');
  assert.match(css, /\.media-strip/);
});

test('未勾选目标账号时不得默认群发', () => {
  const start = appJs.indexOf('function targetAccounts');
  const fn = appJs.slice(start, start + 400);
  assert.ok(start > 0, '未找到 targetAccounts');
  assert.ok(fn.indexOf('!state.selectedAccounts.size') === -1, 'targetAccounts 不应在未选择时回退为全部账号');
  assert.match(fn, /state\.selectedAccounts\.has\(a\.id\)/);
  // 发布与定时都必须先校验目标账号
  const pubStart = appJs.indexOf('async function publishDraft');
  const schedStart = appJs.indexOf('async function scheduleDraft');
  assert.match(appJs.slice(pubStart, schedStart), /if \(!targets\.length\)/);
  assert.match(appJs.slice(schedStart, schedStart + 1200), /if \(!targets\.length\)/);
});

test('分段级平台开关与含链接高亮', () => {
  assert.match(appJs, /data-seg-plat/);
  assert.match(appJs, /function handleGlobalChange/);
  assert.match(appJs, /document\.addEventListener\('change', handleGlobalChange\)/);
  assert.match(appJs, /LINK_RE/);
  assert.match(appJs, /has-link/);
  assert.match(appJs, /segExclude/);
  assert.match(css, /\.seg-card\.has-link/);
  assert.match(css, /\.seg-plat/);
});

test('目标账号主开关与分段卡片联动', () => {
  // 主开关：勾选/取消平台时覆盖所有分段
  assert.match(appJs, /function applyPlatformToAll/);
  assert.match(appJs, /applyPlatformToAll\(acc\.platform, anyOn\)/);
  // 分段被部分取消时，目标账号复选框显示部分勾选
  assert.match(appJs, /function updateAccountCheckboxStates/);
  assert.match(appJs, /c\.indeterminate = selected && excluded > 0/);
  // 含链接段默认自动取消 X（用户手动改过的段不覆盖）
  assert.match(appJs, /function syncSegMedia/);
  assert.match(appJs, /manual\.x/);
  assert.match(appJs, /hasLink && !has/);
  // 初始不勾选任何目标账号
  assert.match(appJs, /selectedAccounts: new Set\(\)/);
});

test('分段未勾选任何平台时阻止发布并提示段号', () => {
  assert.match(appJs, /function segmentsWithoutAnyPlatform/);
  const pubStart = appJs.indexOf('async function publishDraft');
  const schedStart = appJs.indexOf('async function scheduleDraft');
  const pubFn = appJs.slice(pubStart, schedStart);
  assert.ok(pubFn.indexOf('segmentsWithoutAnyPlatform(allSegs, targetPlats)') !== -1, 'publishDraft 缺少覆盖校验');
  assert.ok(pubFn.indexOf('没有勾选任何发布平台') !== -1, 'publishDraft 缺少提示文案');
  const schedFn = appJs.slice(schedStart, schedStart + 1600);
  assert.ok(schedFn.indexOf('segmentsWithoutAnyPlatform(allSegs, targetPlats)') !== -1, 'scheduleDraft 缺少覆盖校验');
});

test('平台图标使用官方 SVG 路径', () => {
  assert.match(appJs, /PLATFORM_ICON_PATHS/);
  assert.match(appJs, /function platformIcon/);
  assert.match(appJs, /M14\.234 10\.162/);   // X 官方路径片段
  assert.match(appJs, /M18\.263 11\.097/);   // Threads 官方路径片段
  // 关键位置使用图标而非纯文字
  assert.ok(appJs.indexOf("esc(a.platform === 'x' ? 'X'") === -1, '账号列表不应再用文字标签');
  assert.match(css, /\.plat-ico/);
});

test('计数 chip 图标与文字同行（不换行）', () => {
  const chipBlock = css.slice(css.indexOf('.chip {'), css.indexOf('.chip {') + 260);
  assert.match(chipBlock, /inline-flex/);
  assert.match(chipBlock, /white-space:\s*nowrap/);
  assert.match(chipBlock, /align-items:\s*center/);
});

test('共享库与页面骨架被正确引用', () => {
  assert.match(html, /src="\/shared\/chars\.js\?v=\{\{BUILD\}\}"/);
  assert.match(html, /src="\/shared\/threadText\.js\?v=\{\{BUILD\}\}"/);
  assert.match(html, /src="\/app\.js\?v=\{\{BUILD\}\}"/);
  assert.match(html, /styles\.css\?v=\{\{BUILD\}\}/);
  assert.match(html, /build \{\{BUILD\}\} · \{\{BUILD_TIME\}\}/);
  assert.match(appJs, /EchoChars\.analyze/);
  assert.match(appJs, /EchoThreadText\.splitSegments/);
});
