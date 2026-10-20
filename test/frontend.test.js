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
  assert.match(appJs, /LINK_RE\.test\(t\) && ex\.indexOf\('x'\) === -1/);
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

test('预览按平台分列渲染（不混排）', () => {
  assert.match(appJs, /class="preview-col"/);
  assert.match(appJs, /preview-col-head/);
  assert.match(css, /\.preview-col\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.mock\s*\{[^}]*width:\s*100%/);
});

test('Bluesky / Mastodon 图标与凭据连接表单', () => {
  assert.match(appJs, /bluesky: 'M5\.202 2\.857/);
  assert.match(appJs, /mastodon: 'M23\.268 5\.313/);
  assert.match(appJs, /id="btn-connect-bsky"/);
  assert.match(appJs, /id="btn-connect-masto"/);
  assert.match(appJs, /platform: 'bluesky'/);
  assert.match(appJs, /platform: 'mastodon'/);
  assert.match(css, /\.plt\.bluesky/);
  assert.match(css, /\.plt\.mastodon/);
});

test('写作台始终展示全部平台，分段开关默认不勾选', () => {
  // 平台清单来自配置（4 个平台），不按"已连接账号"过滤
  assert.match(appJs, /function platformIds\(\)/);
  assert.match(appJs, /function visiblePlatforms\(\)\s*\{\s*return platformIds\(\);/);
  // 目标账号区：未连接平台给出入口
  assert.match(appJs, /acct-empty/);
  assert.match(appJs, /未连接 /);
  // 新分段默认排除所有平台（即不勾选）；已选账号时跟随账号
  assert.match(appJs, /function defaultSegmentExclude/);
  assert.match(appJs, /state\.segExclude\.push\(defaultSegmentExclude\(\)\)/);
  // 未连接平台的开关禁用
  assert.match(appJs, /seg-plat.*no-acct/);
  assert.match(appJs, /hasAccount \? '' : ' disabled'/);
  assert.match(css, /\.seg-plat\.no-acct/);
});

test('分段勾选与目标账号双向同步、空内容重置', () => {
  // 勾选分段 → 自动选中对应账号
  assert.match(appJs, /勾选某平台的分段 → 自动选中该平台的目标账号/);
  assert.match(appJs, /state\.selectedAccounts\.add\(a\.id\)/);
  // 取消最后一段 → 取消选中该平台账号
  assert.match(appJs, /state\.selectedAccounts\.delete\(a\.id\)/);
  // 主开关要覆盖空内容时的占位分段
  assert.match(appJs, /Math\.max\(texts\.length, state\.segExclude\.length\)/);
  // 默认值跟随已选账号
  assert.match(appJs, /function defaultSegmentExclude/);
  assert.match(appJs, /targetAccounts\(\)\.forEach/);
});

test('发布前预检与部分成功保留内容', () => {
  assert.match(appJs, /EchoPreflight\.analyze/);
  assert.match(appJs, /function preflightForTargets/);
  assert.match(appJs, /发布前校验未通过/);
  assert.match(appJs, /has-issue/);
  // 部分成功：保留内容，取消成功平台勾选
  assert.match(appJs, /okAccounts/);
  assert.match(appJs, /applyPlatformToAll\(plat, false\)/);
  assert.match(appJs, /部分成功/);
  // 超限样式必须排在平台配色之后（否则 Bluesky/Mastodon 不标红）
  const iBlue = css.indexOf('.chip.bluesky');
  const iOver = css.indexOf('.chip.over');
  assert.ok(iBlue > -1 && iOver > iBlue, '.chip.over 必须在 .chip.bluesky 之后');
  assert.match(css, /\.seg-card\.has-issue/);
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
