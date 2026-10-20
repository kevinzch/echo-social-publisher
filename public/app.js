/* =========================================================================
 * Echo — 个人贴文发布台 SPA
 * 依赖：/shared/chars.js (EchoChars)、/shared/threadText.js (EchoThreadText)
 * ========================================================================= */
'use strict';

/* ---------- 基础工具 ---------- */
var $ = function (sel, root) { return (root || document).querySelector(sel); };
var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function el(html) {
  var t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtTime(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function fmtCountdown(iso) {
  var diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return '即将发布';
  var m = Math.floor(diff / 60000);
  var h = Math.floor(m / 60);
  var d = Math.floor(h / 24);
  if (d > 0) return d + ' 天 ' + (h % 24) + ' 小时后';
  if (h > 0) return h + ' 小时 ' + (m % 60) + ' 分后';
  if (m > 0) return m + ' 分后';
  return Math.max(1, Math.floor(diff / 1000)) + ' 秒后';
}

function toast(msg, type) {
  var root = $('#toast-root');
  if (!root) return;
  var t = el('<div class="toast ' + (type || '') + '">' + esc(msg) + '</div>');
  root.appendChild(t);
  setTimeout(function () { t.remove(); }, type === 'err' ? 6000 : 3200);
}

/* ---------- 平台图标（Simple Icons 官方路径，currentColor 继承文字颜色） ---------- */
var PLATFORM_ICON_PATHS = {
  x: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
  threads: 'M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z',
  bluesky: 'M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026',
  mastodon: 'M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 0 0 .023-.043v-1.809a.052.052 0 0 0-.02-.041.053.053 0 0 0-.046-.01 20.282 20.282 0 0 1-4.709.545c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 0 1-.319-1.433.053.053 0 0 1 .066-.054c1.517.363 3.072.546 4.632.546.376 0 .75 0 1.125-.01 1.57-.044 3.224-.124 4.768-.422.038-.008.077-.015.11-.024 2.435-.464 4.753-1.92 4.989-5.604.008-.145.03-1.52.03-1.67.002-.512.167-3.63-.024-5.545zm-3.748 9.195h-2.561V8.29c0-1.309-.55-1.976-1.67-1.976-1.23 0-1.846.79-1.846 2.35v3.403h-2.546V8.663c0-1.56-.617-2.35-1.848-2.35-1.112 0-1.668.668-1.67 1.977v6.218H4.822V8.102c0-1.31.337-2.35 1.011-3.12.696-.77 1.608-1.164 2.74-1.164 1.311 0 2.302.5 2.962 1.498l.638 1.06.638-1.06c.66-.999 1.65-1.498 2.96-1.498 1.13 0 2.043.395 2.74 1.164.675.77 1.012 1.81 1.012 3.12z'
};

function platformIcon(id, size) {
  var d = PLATFORM_ICON_PATHS[id];
  if (!d) return '';
  var s = size || 14;
  return '<svg class="plat-ico" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true"><path d="' + d + '" fill="currentColor"/></svg>';
}

function debounce(fn, ms) {
  var timer = null;
  return function () {
    var args = arguments, self = this;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(self, args); }, ms);
  };
}

/* ---------- API ---------- */
async function api(method, path, body) {
  var res = await fetch(path, {
    method: method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  var data = {};
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

/* ---------- 全局状态 ---------- */
var state = {
  config: null,
  accounts: [],
  drafts: [],
  posts: [],
  mediaMap: new Map(),   // mediaId -> record
  route: 'composer',
  draftId: null,
  selectedAccounts: new Set(),
  segMedia: [],          // [[mediaId, ...], ...] 与分段一一对应
  segExclude: [],        // [['x'], ...] 该分段不发布的平台列表
  segManual: [],         // [{x:true}, ...] 用户手动设置过平台开关的分段（不再自动套用链接默认）
  activeSeg: 0,
  showPreview: false,
  publishing: false,
  queueTab: 'pending',
  historyTab: 'all',
  loaded: false
};

var LS_KEY = 'echo.editor';

function limits(platformId) {
  var p = (state.config && state.config.platforms || []).find(function (x) { return x.id === platformId; });
  return p ? p.limits : null;
}

function connectedOf(platformId) {
  return state.accounts.filter(function (a) { return a.platform === platformId; });
}

/* ---------- 启动 ---------- */
async function init() {
  state.config = await api('GET', '/api/config');
  await Promise.all([refreshAccounts(), refreshDrafts(), refreshPosts(), refreshMedia()]);
  state.loaded = true;
  renderBadges();
  window.addEventListener('hashchange', route);
  // 全局点击委托：只绑定一次，杜绝重复渲染导致的监听叠加
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('change', handleGlobalChange);
  route();
  handleQueryToast();
  setInterval(tickCountdown, 1000);
  setInterval(autoRefresh, 20000);
}

function handleQueryToast() {
  var q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.get('connected')) toast('账号连接成功：' + q.get('connected'), 'ok');
  if (q.get('error')) toast(decodeURIComponent(q.get('error')), 'err');
}

function tickCountdown() {
  $$('[data-countdown]').forEach(function (n) {
    n.textContent = fmtCountdown(n.getAttribute('data-countdown'));
  });
}

async function autoRefresh() {
  try {
    if (state.route === 'queue' || state.route === 'history') { await refreshPosts(); renderView(); }
    else if (state.route === 'drafts') { await refreshDrafts(); renderView(); }
    renderBadges();
  } catch (e) { /* 静默 */ }
}

async function refreshAccounts() { state.accounts = (await api('GET', '/api/accounts')).accounts; }
async function refreshDrafts() { state.drafts = (await api('GET', '/api/drafts')).drafts; }
async function refreshPosts() { state.posts = (await api('GET', '/api/posts')).posts; }
async function refreshMedia() {
  var r = await api('GET', '/api/media-list');
  state.mediaMap = new Map(r.media.map(function (m) {
    // 兜底：旧数据/异常响应没有 url 时按相对路径补上，避免缩略图 src=undefined
    return [m.id, m.url ? m : Object.assign({ url: '/media/' + m.id + m.ext }, m)];
  }));
}

function renderBadges() {
  var db = $('#draft-badge');
  if (db) { db.textContent = state.drafts.length; db.hidden = state.drafts.length === 0; }
  var qb = $('#queue-badge');
  var pending = state.posts.filter(function (p) { return p.status === 'pending'; }).length;
  if (qb) { qb.textContent = pending; qb.hidden = pending === 0; }
}

/* ---------- 路由 ---------- */
function route() {
  var hash = location.hash || '#/composer';
  var path = hash.split('?')[0].replace(/^#\//, '') || 'composer';
  state.route = ['composer', 'drafts', 'queue', 'history', 'accounts', 'settings', 'guide'].indexOf(path) >= 0 ? path : 'composer';
  $$('#nav a').forEach(function (a) {
    a.classList.toggle('active', a.getAttribute('data-route') === state.route);
  });
  renderView();
}

function renderView() {
  switch (state.route) {
    case 'composer': renderComposer(); break;
    case 'drafts': renderDrafts(); break;
    case 'queue': renderQueue(); break;
    case 'history': renderHistory(); break;
    case 'accounts': renderAccounts(); break;
    case 'settings': renderSettings(); break;
    case 'guide': renderGuide(); break;
  }
}

/* ---------- 编辑器：分段与计数 ---------- */
function currentSegments() {
  var ta = $('#composer-text');
  var texts = ta ? EchoThreadText.splitSegments(ta.value) : [];
  if (!texts.length) {
    texts = [ta ? ta.value.trim() : ''];
  }
  // 分段数量变化时对齐媒体/平台开关数组
  while (state.segMedia.length < texts.length) state.segMedia.push([]);
  if (state.segMedia.length > texts.length) state.segMedia.length = texts.length;
  // 新分段默认所有平台都不勾选（与"目标账号默认不勾选"保持一致）
  while (state.segExclude.length < texts.length) state.segExclude.push(defaultSegmentExclude());
  if (state.segExclude.length > texts.length) state.segExclude.length = texts.length;
  return texts.map(function (t, i) {
    return {
      text: t,
      media: (state.segMedia[i] || []).slice(),
      exclude: (state.segExclude[i] || []).slice()
    };
  });
}

/** 输入内容变化后同步媒体/平台数组：内容清空时一并清空（修复"图片复活"） */
function syncSegMedia() {
  var ta = $('#composer-text');
  if (!ta) return;
  var texts = EchoThreadText.splitSegments(ta.value);
  if (!texts.length) { state.segMedia = []; state.segExclude = []; state.segManual = []; return; }
  // 分段数量变化时重置手动标记（索引会变）
  if (state.segManual.length !== texts.length) {
    state.segManual = texts.map(function () { return {}; });
  }
  while (state.segMedia.length < texts.length) state.segMedia.push([]);
  if (state.segMedia.length > texts.length) state.segMedia.length = texts.length;
  while (state.segExclude.length < texts.length) state.segExclude.push(defaultSegmentExclude());
  if (state.segExclude.length > texts.length) state.segExclude.length = texts.length;

  // 含链接段默认自动取消 X（仅"新增链接"时生效；默认本就未勾选，不自动勾回）
  texts.forEach(function (t, i) {
    var manual = state.segManual[i] || (state.segManual[i] = {});
    if (manual.x) return;
    var ex = state.segExclude[i] || (state.segExclude[i] = []);
    if (LINK_RE.test(t) && ex.indexOf('x') === -1) ex.push('x');
  });
}

/** 主开关：把某平台的勾选状态应用到全部分段（不写手动标记，链接默认仍可在后续输入时生效） */
function applyPlatformToAll(plat, on) {
  var ta = $('#composer-text');
  if (!ta) return;
  var texts = EchoThreadText.splitSegments(ta.value);
  // 内容为空时 currentSegments 仍会保留一个占位分段，这里必须一起处理，
  // 否则"清空内容→勾选账号→重新输入"会出现分段状态没跟着账号走的问题
  var n = Math.max(texts.length, state.segExclude.length);
  if (n === 0) {
    state.segExclude = [defaultSegmentExclude()];
    n = 1;
  }
  for (var i = 0; i < n; i++) {
    var ex = state.segExclude[i] || (state.segExclude[i] = []);
    if (on) state.segExclude[i] = ex.filter(function (p) { return p !== plat; });
    else if (ex.indexOf(plat) === -1) ex.push(plat);
  }
}

/** 目标账号复选框状态 = 账号是否选中 + 该平台分段是否被部分/全部排除 */
function updateAccountCheckboxStates() {
  var ta = $('#composer-text');
  var texts = ta ? EchoThreadText.splitSegments(ta.value) : [];
  var n = texts.length;
  $$('.acct-check').forEach(function (c) {
    var acc = state.accounts.find(function (a) { return a.id === c.value; });
    if (!acc) return;
    var excluded = 0;
    for (var i = 0; i < n; i++) {
      if ((state.segExclude[i] || []).indexOf(acc.platform) !== -1) excluded++;
    }
    var selected = state.selectedAccounts.has(acc.id);
    c.checked = selected;
    c.indeterminate = selected && excluded > 0;
  });
}

/** 光标所在分段索引（按分隔符计数，越界收敛到合法范围） */
function segmentIndexAt(text, pos) {
  var texts = EchoThreadText.splitSegments(text || '');
  if (!texts.length) return 0;
  var before = String(text || '').slice(0, Math.max(0, pos || 0));
  var lines = before.split(/\r?\n/);
  var count = 0;
  for (var i = 0; i < lines.length; i++) if (lines[i].trim() === '---') count++;
  return Math.max(0, Math.min(count, texts.length - 1));
}

function currentSegIndex() {
  var ta = $('#composer-text');
  if (!ta) return 0;
  return segmentIndexAt(ta.value, ta.selectionStart || 0);
}

function updateActiveSegLabel() {
  var btn = $('#btn-add-image');
  if (!btn) return;
  btn.textContent = '🖼 添加图片（第 ' + (currentSegIndex() + 1) + ' 段）';
}

/** 写作台媒体条：所有已添加图片，按分段标注，可移除 */
function renderMediaStrip() {
  var box = $('#media-strip');
  if (!box) return;
  var items = [];
  state.segMedia.forEach(function (ids, segIdx) {
    (ids || []).forEach(function (id) {
      var m = state.mediaMap.get(id);
      if (m) items.push({ m: m, seg: segIdx });
    });
  });
  if (!items.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = items.map(function (it) {
    return '<div class="media-item"><img src="' + esc(it.m.url) + '" alt="' + esc(it.m.name) + '">' +
      '<span class="media-seg">第 ' + (it.seg + 1) + ' 段</span>' +
      '<button class="rm" data-rm-media="' + esc(it.m.id) + '" data-seg="' + it.seg + '" title="移除图片">×</button></div>';
  }).join('');
}

function editorPlatformChips(text) {
  var a = EchoChars.analyze(text);
  var html = '<span class="chip">中 ' + a.chinese + '</span>' +
             '<span class="chip">英 ' + a.other + '</span>';
  (state.config.platforms || []).forEach(function (p) {
    var lim = p.limits;
    var count, over;
    if (lim.weighted) { count = a.weighted; over = count > lim.maxChars; }
    else { count = a.total; over = count > lim.maxChars; }
    html += '<span class="chip ' + p.id + ' ' + (over ? 'over' : 'ok') + '">' +
            platformIcon(p.id, 12) + ' ' + count + '/' + lim.maxChars + '</span>';
  });
  return html;
}

var LINK_RE = /(https?:\/\/|www\.)\S+/i;

/** 所有已配置平台（写作台始终展示全部平台，未连接的给出入口） */
function platformIds() {
  return (state.config.platforms || []).map(function (p) { return p.id; });
}

function visiblePlatforms() {
  return platformIds();
}

/** 取平台对象（含 limits），供预检使用 */
function platformObjects(ids) {
  var out = [];
  (state.config.platforms || []).forEach(function (p) {
    if (!ids || ids.indexOf(p.id) !== -1) out.push({ id: p.id, name: p.name, limits: p.limits });
  });
  return out;
}

function mediaLookup(id) {
  return state.mediaMap.get(id) || null;
}

/** 发布前本地预检：字数 / 图片数量 / 单图大小 / 格式（逐段 × 逐目标平台） */
function preflightForTargets(segments, targets) {
  var plats = [];
  targets.forEach(function (a) {
    if (plats.indexOf(a.platform) === -1) plats.push(a.platform);
  });
  return EchoPreflight.analyze(segments, platformObjects(plats), mediaLookup);
}

/** 新分段的默认平台状态：跟随当前已选目标账号；未选账号则全部不勾选 */
function defaultSegmentExclude() {
  var on = {};
  targetAccounts().forEach(function (a) { on[a.platform] = true; });
  return platformIds().filter(function (pid) { return !on[pid]; });
}

function renderSegments() {
  var box = $('#seg-list');
  if (!box) return;
  var segments = currentSegments();
  if (!segments.length || (segments.length === 1 && !segments[0].text.trim())) {
    box.innerHTML = '<div class="empty">输入内容后这里会显示分段卡片（每段独立计数、配图、平台开关）</div>';
    return;
  }
  var plats = visiblePlatforms();
  var connectedPlats = {};
  state.accounts.forEach(function (a) { connectedPlats[a.platform] = true; });
  // 预检问题（按段分组）：已选账号则只校验目标平台，未选则校验全部平台
  var selectedPlatsForWarn = [];
  targetAccounts().forEach(function (a) {
    if (selectedPlatsForWarn.indexOf(a.platform) === -1) selectedPlatsForWarn.push(a.platform);
  });
  var segIssues = {};
  EchoPreflight.analyze(segments, platformObjects(selectedPlatsForWarn.length ? selectedPlatsForWarn : plats), mediaLookup)
    .forEach(function (it) {
      (segIssues[it.segNo - 1] = segIssues[it.segNo - 1] || []).push(it);
    });
  var html = '';
  segments.forEach(function (seg, i) {
    var over = false;
    (state.config.platforms || []).forEach(function (p) {
      var lim = p.limits;
      var a = EchoChars.analyze(seg.text);
      var c = lim.weighted ? a.weighted : a.total;
      if (c > lim.maxChars) over = true;
    });
    var hasLink = LINK_RE.test(seg.text);
    var excluded = seg.exclude || [];
    // 仅当"已选目标账号"且该段对所有已选平台都被排除时，才置灰提示
    var selectedPlats = [];
    targetAccounts().forEach(function (a) {
      if (selectedPlats.indexOf(a.platform) === -1) selectedPlats.push(a.platform);
    });
    var allExcluded = selectedPlats.length > 0 && selectedPlats.every(function (pid) { return excluded.indexOf(pid) !== -1; });
    var issues = segIssues[i] || [];
    var cls = 'seg-card' + (over ? ' over' : '') + (hasLink ? ' has-link' : '') +
      (allExcluded ? ' muted-card' : '') + (issues.length ? ' has-issue' : '');
    html += '<div class="' + cls + '" data-seg="' + i + '">' +
      '<div class="seg-head"><span class="seg-no">' + (i + 1) + '</span>' +
      '<span class="muted small">第 ' + (i + 1) + ' 段</span>' +
      (hasLink ? '<span class="chip warn" title="X 对含链接的帖子按 $0.20/条计费">含链接</span>' : '') +
      (issues.length
        ? '<span class="chip issue" title="' + esc(issues.map(function (x) { return x.message; }).join('\n')) + '">⚠ ' + issues.length + ' 项超限</span>'
        : '') +
      '<div class="seg-counts">' + editorPlatformChips(seg.text) + '</div></div>';
    // 分段级平台开关：取消勾选即不发布到该平台
    html += '<div class="seg-plats">';
    plats.forEach(function (pid) {
      var p = (state.config.platforms || []).find(function (x) { return x.id === pid; });
      var on = excluded.indexOf(pid) === -1;
      var hasAccount = !!connectedPlats[pid];
      html += '<label class="seg-plat' + (on ? '' : ' off') + (hasAccount ? '' : ' no-acct') + '"' +
        (hasAccount ? '' : ' title="未连接该平台账号，发布时不会发送"') + '>' +
        '<input type="checkbox" data-seg-plat="' + esc(pid) + '" data-seg="' + i + '"' + (on ? ' checked' : '') +
        (hasAccount ? '' : ' disabled') + '>' +
        '<span class="plt ' + esc(pid) + '">' + platformIcon(pid, 12) + '</span></label>';
    });
    html += '</div>';
    // 文本预览
    var preview = seg.text.length > 140 ? seg.text.slice(0, 140) + '…' : seg.text;
    html += '<div class="seg-text small muted">' + esc(preview).replace(/\n/g, '<br>') + '</div>';
    // 图片预览（只读；添加/删除在输入框下方的媒体条操作）
    if ((seg.media || []).length) {
      html += '<div class="seg-media">';
      (seg.media || []).forEach(function (mid) {
        var m = state.mediaMap.get(mid);
        if (!m) return;
        html += '<div class="media-thumb"><img src="' + esc(m.url) + '" alt="' + esc(m.name) + '"></div>';
      });
      html += '</div>';
    }
    html += '</div>';
  });
  box.innerHTML = html;
  updateAccountCheckboxStates();
}

/* ---------- 编辑器：媒体上传 ---------- */
async function uploadFiles(files, segIndex) {
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    try {
      var dataUrl = await new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      var base64 = String(dataUrl).split(',')[1];
      var r = await api('POST', '/api/media', {
        name: f.name, mime: f.type, size: f.size, dataBase64: base64
      });
      state.mediaMap.set(r.media.id, r.media);
      if (!state.segMedia[segIndex]) state.segMedia[segIndex] = [];
      state.segMedia[segIndex].push(r.media.id);
    } catch (err) {
      toast('图片上传失败：' + err.message, 'err');
    }
  }
  renderSegments();
  renderMediaStrip();
}

/* ---------- 视图：写作台 ---------- */
function draftBodyFromEditor() {
  var ta = $('#composer-text');
  var segments = currentSegments();
  var title = (segments[0] && segments[0].text || '').split('\n')[0].slice(0, 40);
  return {
    title: title,
    accountIds: Array.from(state.selectedAccounts),
    segments: segments
  };
}

function renderComposer() {
  var view = $('#view');
  var accountsHtml = '';
  (state.config.platforms || []).forEach(function (p) {
    var list = state.accounts.filter(function (a) { return a.platform === p.id; });
    if (!list.length) {
      accountsHtml += '<div class="acct-empty"><span class="plt ' + esc(p.id) + '">' + platformIcon(p.id, 12) + '</span>' +
        '<span class="small muted">未连接 ' + esc(p.name.split(' ')[0]) + '</span>' +
        '<a class="small" href="#/accounts" style="margin-left:auto">去连接</a></div>';
      return;
    }
    list.forEach(function (a) {
      var checked = state.selectedAccounts.has(a.id) ? ' checked' : '';
      accountsHtml += '<label><input type="checkbox" class="acct-check" value="' + esc(a.id) + '"' + checked + '>' +
        '<span class="plt ' + esc(a.platform) + '">' + platformIcon(a.platform, 12) + '</span>' +
        '<span>' + esc(a.displayName || a.username) + '</span></label>';
    });
  });

  var limitsHtml = (state.config.platforms || []).map(function (p) {
    return '<div class="small muted" style="margin:2px 0"><strong>' + esc(p.name.split(' ')[0]) + '</strong>：' + esc(p.limits.note) + '</div>';
  }).join('');

  // 默认定时时间：1 小时后取整 5 分钟
  var d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  var localIso = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());

  view.innerHTML =
    '<h2 class="page-title">写作台</h2>' +
    '<p class="page-sub">写好后选择平台发布、定时或存草稿。用「手动分段」插入 <code>---</code> 分隔线切分长贴文。</p>' +
    '<div class="composer-grid">' +
    '  <div>' +
    '    <div class="card">' +
    '      <div class="editor-toolbar">' +
    '        <button class="btn sm" id="btn-split">✂️ 手动分段</button>' +
    '        <button class="btn sm" id="btn-add-image">🖼 添加图片（第 1 段）</button>' +
    '        <button class="btn sm" id="btn-preview">👁 预览</button>' +
    '        <span class="spacer"></span>' +
    '        <button class="btn sm" id="btn-save">💾 保存草稿</button>' +
    '      </div>' +
    '      <textarea id="composer-text" placeholder="在这里写贴文……&#10;&#10;「手动分段」插入分隔线；图片可点上方按钮添加，或直接 Ctrl+V 粘贴到光标处。"></textarea>' +
    '      <div id="media-strip" class="media-strip" hidden></div>' +
    '      <div class="row" style="margin-top:10px">' +
    '        <input type="datetime-local" id="sched-time" value="' + localIso + '">' +
    '        <button class="btn primary" id="btn-schedule">⏰ 定时发布</button>' +
    '        <button class="btn x" id="btn-publish">🚀 立即发布</button>' +
    '      </div>' +
    '    </div>' +
    '    <div id="seg-list" class="seg-list"></div>' +
    '    <div id="preview-wrap" style="margin-top:16px"' + (state.showPreview ? '' : ' hidden') + '></div>' +
    '  </div>' +
    '  <aside>' +
    '    <div class="card"><h3>目标账号</h3><div class="account-pick">' + accountsHtml + '</div>' +
    '    <div class="small muted" style="margin-top:8px">需至少勾选一个账号才能发布（不会默认全选）。</div></div>' +
    '    <div class="card"><h3>平台规则</h3>' + limitsHtml + '</div>' +
    '  </aside>' +
    '</div>' +
    '<input type="file" id="media-input" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>';

  var ta = $('#composer-text');
  // 恢复草稿/localStorage
  if (state.draftId) {
    var draft = state.drafts.find(function (x) { return x.id === state.draftId; });
    if (draft) {
      ta.value = EchoThreadText.joinSegments(draft.segments.map(function (s) { return s.text; }));
      state.segMedia = draft.segments.map(function (s) { return (s.media || []).slice(); });
      state.segExclude = draft.segments.map(function (s) {
        return Array.isArray(s.exclude) ? s.exclude.slice() : defaultSegmentExclude();
      });
      // 草稿中的平台开关视为用户已确定，不再被"含链接默认"覆盖
      state.segManual = draft.segments.map(function () { return { x: true }; });
      state.selectedAccounts = new Set(draft.accountIds || []);
      $$('.acct-check').forEach(function (c) { c.checked = state.selectedAccounts.has(c.value); });
    }
  } else {
    var saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch (e) { }
    if (saved && !ta.value) ta.value = saved;
  }

  ta.addEventListener('input', function () {
    autoGrow(ta);
    syncSegMedia();
    renderSegments();
    renderMediaStrip();
    updateActiveSegLabel();
    if (state.showPreview) renderPreview();
    try { localStorage.setItem(LS_KEY, ta.value); } catch (e) { }
  });

  // 光标位置 → 当前分段（图片默认加到光标所在段）
  ta.addEventListener('click', updateActiveSegLabel);
  ta.addEventListener('keyup', updateActiveSegLabel);

  // 剪贴板粘贴图片（Ctrl+V）
  ta.addEventListener('paste', function (ev) {
    var items = ev.clipboardData && ev.clipboardData.items;
    if (!items) return;
    var files = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && items[i].type && items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      ev.preventDefault();
      uploadFiles(files, currentSegIndex());
    }
  });

  $('#btn-split').addEventListener('click', function () {
    var pos = ta.selectionStart || ta.value.length;
    var r = EchoThreadText.insertSeparator(ta.value, pos);
    ta.value = r.text;
    ta.focus();
    ta.setSelectionRange(r.cursorPos, r.cursorPos);
    autoGrow(ta);
    syncSegMedia();
    renderSegments();
    renderMediaStrip();
    updateActiveSegLabel();
    try { localStorage.setItem(LS_KEY, ta.value); } catch (e) { }
  });

  $('#btn-preview').addEventListener('click', function () {
    state.showPreview = !state.showPreview;
    $('#preview-wrap').hidden = !state.showPreview;
    if (state.showPreview) renderPreview();
  });

  $('#btn-save').addEventListener('click', saveDraft);
  $('#btn-schedule').addEventListener('click', scheduleDraft);
  $('#btn-publish').addEventListener('click', publishDraft);

  $$('.acct-check').forEach(function (c) {
    c.addEventListener('change', function () {
      if (c.checked) state.selectedAccounts.add(c.value);
      else state.selectedAccounts.delete(c.value);
      // 主开关：勾选/取消该平台时覆盖所有分段卡片的平台状态
      var acc = state.accounts.find(function (a) { return a.id === c.value; });
      if (acc) {
        var anyOn = state.accounts.some(function (a) {
          return a.platform === acc.platform && state.selectedAccounts.has(a.id);
        });
        applyPlatformToAll(acc.platform, anyOn);
      }
      renderSegments();
      updateAccountCheckboxStates();
    });
  });

  var mediaInput = $('#media-input');
  mediaInput.addEventListener('change', function () {
    if (mediaInput.files && mediaInput.files.length) {
      uploadFiles(mediaInput.files, currentSegIndex());
      mediaInput.value = '';
    }
  });

  $('#btn-add-image').addEventListener('click', function () {
    $('#media-input').click();
  });

  renderSegments();
  renderMediaStrip();
  updateActiveSegLabel();
  autoGrow(ta);
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(190, ta.scrollHeight) + 'px';
}

async function saveDraft() {
  var ta = $('#composer-text');
  if (!ta || !ta.value.trim()) { toast('内容为空，无需保存', 'err'); return null; }
  var body = draftBodyFromEditor();
  if (state.draftId) {
    await api('PUT', '/api/drafts/' + state.draftId, body);
    toast('草稿已更新', 'ok');
  } else {
    var r = await api('POST', '/api/drafts', body);
    state.draftId = r.draft.id;
    toast('草稿已保存', 'ok');
  }
  await refreshDrafts();
  renderBadges();
  return state.draftId;
}

/* ---------- 发布进程弹窗 ---------- */
function accountLabel(a) {
  var p = (state.config.platforms || []).find(function (x) { return x.id === a.platform; });
  return (p ? p.name.split(' ')[0] : a.platform) + ' @' + a.username;
}

function openPublishModal(title, accounts) {
  var modal = $('#publish-modal');
  if (!modal) return;
  $('#publish-modal-title').textContent = title;
  $('#publish-rows').innerHTML = accounts.map(function (a) {
    return '<div class="publish-row" data-row="' + esc(a.id) + '">' +
      '<span class="publish-ico">⏳</span>' +
      '<span class="publish-label">' + esc(accountLabel(a)) + '</span>' +
      '<span class="publish-detail muted">等待中…</span></div>';
  }).join('');
  modal.hidden = false;
  $('#publish-close').hidden = true; // 进行中不可关闭
}

function updatePublishRow(accountId, status, detail, urls) {
  var row = document.querySelector('[data-row="' + accountId + '"]');
  if (!row) return;
  var ico = row.querySelector('.publish-ico');
  var det = row.querySelector('.publish-detail');
  if (status === 'sending') {
    ico.textContent = '⏳';
    det.className = 'publish-detail muted';
    det.textContent = '发送中…';
  } else if (status === 'ok') {
    ico.textContent = '✅';
    det.className = 'publish-detail';
    if (urls && urls.length) {
      det.innerHTML = urls.map(function (u) {
        return '<a href="' + esc(u) + '" target="_blank" rel="noopener">查看已发布 ↗</a>';
      }).join(' ');
    } else {
      det.textContent = detail || '成功';
    }
  } else if (status === 'fail') {
    ico.textContent = '❌';
    det.className = 'publish-detail';
    det.style.color = 'var(--err)';
    det.textContent = detail || '失败';
  }
}

function closePublishModal() {
  var m = $('#publish-modal');
  if (m) m.hidden = true;
}

function setComposerBusy(busy) {
  state.publishing = busy;
  ['btn-publish', 'btn-schedule', 'btn-save'].forEach(function (id) {
    var b = $('#' + id);
    if (b) b.disabled = busy;
  });
  var pub = $('#btn-publish');
  if (pub) pub.textContent = busy ? '⏳ 发布中…' : '🚀 立即发布';
}

/** 目标账号列表：只返回用户显式勾选的账号（未勾选时为空，绝不默认全选） */
function targetAccounts() {
  return state.accounts.filter(function (a) {
    return state.selectedAccounts.has(a.id);
  });
}

/** 发布/定时成功后：清空写作台；若在编辑草稿则消费掉该草稿 */
async function afterComposeDone() {
  var ta = $('#composer-text');
  if (ta) ta.value = '';
  state.segMedia = [];
  state.segExclude = [];
  state.segManual = [];
  state.showPreview = false;
  try { localStorage.removeItem(LS_KEY); } catch (e) { }
  if (state.draftId) {
    try { await api('DELETE', '/api/drafts/' + state.draftId); } catch (e) { /* 忽略 */ }
    state.draftId = null;
  }
  await Promise.all([refreshDrafts(), refreshPosts()]);
  renderBadges();
  renderComposer();
}

/** 找出"所有目标平台都被取消"的分段，返回从 1 开始的段号 */
function segmentsWithoutAnyPlatform(segments, targetPlats) {
  var bad = [];
  segments.forEach(function (s, i) {
    var hasContent = (s.text || '').trim() || (s.media || []).length;
    if (!hasContent) return;
    var any = targetPlats.some(function (p) { return (s.exclude || []).indexOf(p) === -1; });
    if (!any) bad.push(i + 1);
  });
  return bad;
}

async function publishDraft() {
  if (state.publishing) return;
  var allSegs = currentSegments();
  var segments = allSegs.filter(function (s) { return (s.text || '').trim() || (s.media || []).length; });
  if (!segments.length) { toast('内容为空，无法发布', 'err'); return; }
  var targets = targetAccounts();
  if (!targets.length) { toast('未勾选目标账号：请先在右侧至少勾选一个账号（不会默认发到全部账号）', 'err'); return; }

  // 分段把所选平台全部取消 → 该段无处可发，阻止发布并提示
  var targetPlats = Array.from(new Set(targets.map(function (a) { return a.platform; })));
  var bad = segmentsWithoutAnyPlatform(allSegs, targetPlats);
  if (bad.length) {
    toast('第 ' + bad.join('、') + ' 段没有勾选任何发布平台，无法发布。请至少勾选一个平台，或清空该段内容。', 'err');
    return;
  }

  // 本地预检（字数 / 图片数量 / 单图大小 / 格式）：任一段超限就整体阻止，
  // 避免"部分平台发出去、超限平台被跳过"导致贴文缺段
  var issues = preflightForTargets(allSegs, targets);
  if (issues.length) {
    toast('发布前校验未通过：' + EchoPreflight.summary(issues, 2), 'err');
    return;
  }

  setComposerBusy(true);
  openPublishModal('发布进程', targets);
  var okAccounts = [];
  var failAccounts = [];
  for (var i = 0; i < targets.length; i++) {
    var acc = targets[i];
    updatePublishRow(acc.id, 'sending');
    try {
      var r = await api('POST', '/api/compose/publish', { segments: segments, accountIds: [acc.id] });
      var res = (r.results && r.results[0]) || {};
      if (res.ok) { okAccounts.push(acc); updatePublishRow(acc.id, 'ok', '', res.urls); }
      else { failAccounts.push(acc); updatePublishRow(acc.id, 'fail', res.error || '发布失败'); }
    } catch (e) {
      failAccounts.push(acc);
      updatePublishRow(acc.id, 'fail', e.message);
    }
  }
  setComposerBusy(false);
  var closeBtn = $('#publish-close');
  if (closeBtn) closeBtn.hidden = false;

  if (!failAccounts.length) {
    toast('发布完成：成功 ' + okAccounts.length + '/' + targets.length, 'ok');
    await afterComposeDone();
    return;
  }

  if (!okAccounts.length) {
    toast('发布失败：0/' + targets.length + '，内容已保留，可修改后重试', 'err');
    return;
  }

  // 部分成功：保留写作台内容；取消已成功平台的分段勾选与账号选中，
  // 失败平台保持原样，方便直接重试
  var okPlats = [];
  var failPlats = [];
  okAccounts.forEach(function (a) { if (okPlats.indexOf(a.platform) === -1) okPlats.push(a.platform); });
  failAccounts.forEach(function (a) { if (failPlats.indexOf(a.platform) === -1) failPlats.push(a.platform); });
  okPlats.forEach(function (plat) {
    if (failPlats.indexOf(plat) === -1) applyPlatformToAll(plat, false);
  });
  okAccounts.forEach(function (a) { state.selectedAccounts.delete(a.id); });
  renderSegments();
  updateAccountCheckboxStates();
  if (state.showPreview) renderPreview();
  toast('部分成功：' + okAccounts.length + '/' + targets.length +
    '。内容已保留，已取消成功平台，可直接重试失败平台', 'warn');
}

async function scheduleDraft() {
  if (state.publishing) return;
  var when = $('#sched-time').value;
  if (!when) { toast('请先选择定时时间', 'err'); return; }
  var allSegs = currentSegments();
  var segments = allSegs.filter(function (s) { return (s.text || '').trim() || (s.media || []).length; });
  if (!segments.length) { toast('内容为空，无法定时', 'err'); return; }
  var targets = targetAccounts();
  if (!targets.length) { toast('未勾选目标账号：请先在右侧至少勾选一个账号（不会默认发到全部账号）', 'err'); return; }

  var targetPlats = Array.from(new Set(targets.map(function (a) { return a.platform; })));
  var bad = segmentsWithoutAnyPlatform(allSegs, targetPlats);
  if (bad.length) {
    toast('第 ' + bad.join('、') + ' 段没有勾选任何发布平台，无法定时发布。请至少勾选一个平台，或清空该段内容。', 'err');
    return;
  }

  // 与立即发布同一套本地预检
  var issues = preflightForTargets(allSegs, targets);
  if (issues.length) {
    toast('定时前校验未通过：' + EchoPreflight.summary(issues, 2), 'err');
    return;
  }

  setComposerBusy(true);
  openPublishModal('定时发布', targets);
  targets.forEach(function (a) { updatePublishRow(a.id, 'sending'); });
  var created = [];
  try {
    var r = await api('POST', '/api/compose/schedule', {
      segments: segments,
      accountIds: targets.map(function (a) { return a.id; }),
      scheduledAt: when
    });
    created = r.posts || [];
    created.forEach(function (p) {
      updatePublishRow(p.accountId, 'ok', '已加入队列 · ' + fmtTime(p.scheduledAt));
    });
    // 未入队的账号标记失败
    targets.forEach(function (a) {
      if (!created.some(function (p) { return p.accountId === a.id; })) {
        updatePublishRow(a.id, 'fail', '未加入队列（该平台没有可发布的分段）');
      }
    });
  } catch (e) {
    targets.forEach(function (a) { updatePublishRow(a.id, 'fail', e.message); });
    toast(e.message, 'err');
  }
  setComposerBusy(false);
  var closeBtn2 = $('#publish-close');
  if (closeBtn2) closeBtn2.hidden = false;

  if (!created.length) return;
  if (created.length === targets.length) {
    await afterComposeDone();
    toast('已加入队列：' + created.length + ' 个账号', 'ok');
    return;
  }
  // 部分入队：保留内容，取消已入队账号/平台
  var okAccs = targets.filter(function (a) {
    return created.some(function (p) { return p.accountId === a.id; });
  });
  var okPlats = [];
  okAccs.forEach(function (a) { if (okPlats.indexOf(a.platform) === -1) okPlats.push(a.platform); });
  var failPlats = [];
  targets.forEach(function (a) {
    if (!okAccs.some(function (x) { return x.id === a.id; }) && failPlats.indexOf(a.platform) === -1) failPlats.push(a.platform);
  });
  okPlats.forEach(function (plat) {
    if (failPlats.indexOf(plat) === -1) applyPlatformToAll(plat, false);
  });
  okAccs.forEach(function (a) { state.selectedAccounts.delete(a.id); });
  renderSegments();
  updateAccountCheckboxStates();
  if (state.showPreview) renderPreview();
  toast('部分入队：' + created.length + '/' + targets.length + '。内容已保留，可修正后重试', 'warn');
}

/* ---------- 视图：预览 ---------- */
function renderPreview() {
  var wrap = $('#preview-wrap');
  var segments = currentSegments().filter(function (s) { return s.text.trim() || (s.media || []).length; });
  if (!segments.length) { wrap.innerHTML = '<div class="empty">暂无内容可预览</div>'; return; }
  var targets = state.accounts.filter(function (a) { return !state.selectedAccounts.size || state.selectedAccounts.has(a.id); });
  var platforms = state.selectedAccounts.size
    ? Array.from(new Set(targets.map(function (a) { return a.platform; })))
    : (state.config.platforms || []).map(function (p) { return p.id; });
  var html = '<div class="card"><h3>预览</h3><div class="preview-wrap">';
  platforms.forEach(function (pid) {
    var p = (state.config.platforms || []).find(function (x) { return x.id === pid; });
    if (!p) return;
    var acct = targets.find(function (a) { return a.platform === pid; });
    var name = acct ? (acct.displayName || acct.username) : '我';
    var user = acct ? acct.username : 'me';
    // 按分段平台开关过滤：被排除的段不在此平台预览
    var visible = segments.filter(function (s) { return (s.exclude || []).indexOf(pid) === -1; });
    // 每个平台独立一列，避免不同平台的帖子在 flex 中混排
    html += '<div class="preview-col">' +
      '<div class="preview-col-head">' + platformIcon(pid, 14) + '<span>' + esc(p.name.split(' ')[0]) + ' · @' + esc(user) + '</span></div>';
    if (!visible.length) {
      html += '<div class="empty">该平台没有可发布的分段（已被平台开关排除）</div>';
    } else {
      visible.forEach(function (seg, i) {
        html += mockPost(p, name, user, seg, limits(pid));
        if (i < visible.length - 1) html += '<div class="mock-thread-arrow">↓</div>';
      });
    }
    html += '</div>';
  });
  html += '</div></div>';
  wrap.innerHTML = html;
}

function mockPost(p, name, user, seg, lim) {
  var color = p.id === 'x' ? '#0f1419' : p.id === 'threads' ? '#833ab4' : '#4f46e5';
  var html = '<div class="mock">' +
    '<div class="mock-head">' +
    '<div class="mock-avatar" style="background:' + color + '">' + esc(name.slice(0, 1).toUpperCase()) + '</div>' +
    '<div><div class="mock-name">' + esc(name) + '</div><div class="mock-user">@' + esc(user) + ' · 现在</div></div>' +
    '</div>' +
    '<div class="mock-text">' + esc(seg.text) + '</div>';
  var media = (seg.media || []).map(function (mid) { return state.mediaMap.get(mid); }).filter(Boolean);
  if (media.length) {
    var n = Math.min(media.length, lim ? lim.maxImages : 4);
    html += '<div class="mock-imgs n' + Math.min(n, 4) + '">';
    media.slice(0, n).forEach(function (m) {
      html += '<img src="' + esc(m.url) + '" alt="">';
    });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

/* ---------- 视图：草稿箱 ---------- */
function renderDrafts() {
  var view = $('#view');
  if (!state.drafts.length) {
    view.innerHTML = '<h2 class="page-title">草稿箱</h2><div class="empty">还没有草稿。去<a href="#/composer">写作台</a>写第一条吧。</div>';
    return;
  }
  var html = '<h2 class="page-title">草稿箱</h2><p class="page-sub">共 ' + state.drafts.length + ' 条草稿</p><div class="list">';
  state.drafts.slice().sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; }).forEach(function (d) {
    var first = (d.segments[0] && d.segments[0].text || '（无标题）').split('\n')[0].slice(0, 50);
    var imgs = d.segments.reduce(function (n, s) { return n + (s.media || []).length; }, 0);
    html += '<div class="list-item">' +
      '<div class="grow">' +
      '<div class="title">' + esc(first) + '</div>' +
      '<div class="meta">' + d.segments.length + ' 段 · ' + imgs + ' 图 · 更新于 ' + fmtTime(d.updatedAt) + '</div>' +
      '</div>' +
      '<div class="actions">' +
      '<button class="btn sm" data-edit="' + esc(d.id) + '">编辑</button>' +
      '<button class="btn sm danger" data-del-draft="' + esc(d.id) + '">删除</button>' +
      '</div></div>';
  });
  html += '</div>';
  view.innerHTML = html;
}

/* ---------- 视图：发布队列 ---------- */
var QUEUE_TABS = [
  { key: 'pending', label: '待发布' },
  { key: 'published', label: '已发布' },
  { key: 'failed', label: '失败' },
  { key: 'canceled', label: '已取消' }
];

function statusLabel(s) {
  return { pending: '待发布', publishing: '发布中', published: '已发布', failed: '失败', canceled: '已取消' }[s] || s;
}

function renderQueue() {
  var view = $('#view');
  var tabs = '<div class="tabs">' + QUEUE_TABS.map(function (t) {
    var count = state.posts.filter(function (p) { return p.status === t.key; }).length;
    return '<a href="javascript:void(0)" class="' + (state.queueTab === t.key ? 'active' : '') + '" data-qt="' + t.key + '">' + t.label + '（' + count + '）</a>';
  }).join('') + '</div>';

  // 由新到旧：最近创建的排在最前（与发布记录一致）
  var posts = state.posts.filter(function (p) { return p.status === state.queueTab; })
    .sort(function (a, b) {
      var ak = a.createdAt || a.scheduledAt || '';
      var bk = b.createdAt || b.scheduledAt || '';
      if (ak === bk) return (a.scheduledAt || '') < (b.scheduledAt || '') ? 1 : -1;
      return ak < bk ? 1 : -1;
    });

  var html = '<h2 class="page-title">发布队列</h2><p class="page-sub">调度器每 30 秒检查一次；进程关闭期间到期的任务，下次启动会自动补投。</p>' + tabs;
  if (!posts.length) {
    html += '<div class="empty">当前分类下没有记录</div>';
  } else {
    html += '<div class="list">';
    posts.forEach(function (p) {
      var dot = 'status-' + p.status;
      html += '<div class="list-item">' +
        '<span class="status-dot ' + dot + '"></span>' +
        '<div class="grow">' +
        '<div class="title">' + esc(p.preview || '（无文字）') + '</div>' +
        '<div class="meta">' + esc(p.accountLabel) + ' · ' + p.segmentsCount + ' 段 · 计划 ' + fmtTime(p.scheduledAt) +
        (p.status === 'pending' ? ' · <span data-countdown="' + esc(p.scheduledAt) + '">' + fmtCountdown(p.scheduledAt) + '</span>' : '') +
        (p.status === 'failed' && p.error ? ' · <span style="color:var(--err)">' + esc(p.error) + '</span>' : '') +
        '</div>' +
        (p.result && p.result.urls && p.result.urls.length
          ? '<div class="meta" style="margin-top:4px">' + p.result.urls.map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">查看发布结果 ↗</a>'; }).join(' · ') + '</div>'
          : '') +
        '</div>' +
        '<div class="actions">' +
        (p.status === 'pending' ? '<button class="btn sm" data-pub-now="' + esc(p.id) + '">立即发布</button>' : '') +
        (p.status === 'pending' ? '<button class="btn sm danger" data-cancel="' + esc(p.id) + '">取消</button>' : '') +
        (p.status === 'failed' ? '<button class="btn sm primary" data-retry="' + esc(p.id) + '">重试</button>' : '') +
        '</div></div>';
    });
    html += '</div>';
  }
  view.innerHTML = html;
}

function postAction(path, okMsg, method) {
  api(method || 'POST', path).then(async function (r) {
    if (r.urls && r.urls.length) {
      toast(okMsg + '，成功 ' + r.urls.length + ' 段', 'ok');
      r.urls.forEach(function (u) { window.open(u, '_blank'); });
    } else {
      toast(okMsg, 'ok');
    }
    await refreshPosts();
    renderBadges();
    renderView();
  }).catch(function (e) { toast(e.message, 'err'); });
}

/* ---------- 视图：发布记录 ---------- */
function renderHistory() {
  var view = $('#view');
  var posts = state.posts.slice().sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
  var html = '<h2 class="page-title">发布记录</h2><p class="page-sub">所有账号的发布流水（含失败原因）。</p><div class="list">';
  if (!posts.length) html += '<div class="empty">暂无记录</div>';
  posts.forEach(function (p) {
    html += '<div class="list-item">' +
      '<span class="status-dot status-' + p.status + '"></span>' +
      '<div class="grow">' +
      '<div class="title">' + esc(p.preview || '（无文字）') + '</div>' +
      '<div class="meta">' + esc(p.accountLabel) + ' · ' + statusLabel(p.status) + ' · ' + fmtTime(p.updatedAt) +
      (p.error ? ' · <span style="color:var(--err)">' + esc(p.error) + '</span>' : '') + '</div>' +
      (p.result && p.result.urls && p.result.urls.length
        ? '<div class="meta" style="margin-top:4px">' + p.result.urls.map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u.replace(/^https?:\/\//, '').slice(0, 46)) + ' ↗</a>'; }).join(' · ') + '</div>'
        : '') +
      '</div></div>';
  });
  html += '</div>';
  view.innerHTML = html;
}

/* ---------- 视图：账号 ---------- */
function renderAccounts() {
  var view = $('#view');
  var html = '<h2 class="page-title">账号</h2><p class="page-sub">X / Threads 通过 OAuth 授权；Bluesky / Mastodon 使用应用凭据直接连接（无需开发者审核）。</p>';
  (state.config.platforms || []).forEach(function (p) {
    var cfg = p.configured;
    var credentialBased = p.id === 'bluesky' || p.id === 'mastodon';
    var statusChip = credentialBased
      ? '<span class="chip ok">凭据连接</span>'
      : (cfg ? '<span class="chip ok">凭证已配置</span>' : '<span class="chip over">未配置凭证</span>');
    html += '<div class="card">' +
      '<div class="row"><span class="plt ' + esc(p.id) + '">' + platformIcon(p.id, 12) + '</span>' +
      '<h3 style="margin:0">' + esc(p.name) + '</h3>' +
      statusChip +
      '<span class="spacer"></span>' +
      (credentialBased
        ? ''
        : (cfg
          ? '<button class="btn ' + (p.id === 'x' ? 'x' : p.id === 'threads' ? 'threads' : 'primary') + '" data-connect="' + esc(p.id) + '">连接 ' + esc(p.name.split(' ')[0]) + ' 账号</button>'
          : '<a class="btn" href="#/guide">查看申请指南</a>')) +
      '</div>' +
      '<div class="small muted" style="margin-top:8px">' + esc(p.limits.note) + '</div>' +
      (p.redirectUri
        ? '<div class="small" style="margin-top:6px">回调地址（需在平台后台登记）：<code>' + esc(p.redirectUri) + '</code> <button class="btn sm ghost" data-copy="' + esc(p.redirectUri) + '">复制</button>' +
          (p.id === 'threads' ? '<div class="muted" style="margin-top:4px">Threads 要求回调必须为 HTTPS——本机请先用隧道（如 cloudflared）拿到地址，再设置 <code>THREADS_REDIRECT_URI</code>（见设置页与申请指南）</div>' : '') +
          '</div>'
        : '') +
      '<div style="margin-top:10px">';
    var accts = connectedOf(p.id);
    if (!accts.length) html += '<div class="small muted">未连接账号</div>';
    accts.forEach(function (a) {
      html += '<div class="row" style="padding:6px 0;border-top:1px solid var(--border)">' +
        '<span class="plt ' + esc(a.platform) + '">' + platformIcon(a.platform, 12) + '</span>' +
        '<span><strong>' + esc(a.displayName || a.username) + '</strong> <span class="muted small">@' + esc(a.username) + '</span></span>' +
        (a.manual ? '<span class="chip">手动令牌</span>' : '') +
        (a.tokenStatus === 'expired'
          ? '<span class="chip over" title="' + esc(a.reauthReason || '续期凭证已失效，请重新连接') + '">令牌已失效</span>'
          : (a.tokenStatus === 'refreshable'
            ? '<span class="chip warn" title="' + esc('access token 已到期，下次发布会自动续期，无需操作' +
                (a.refreshExpiresAt ? '（续期凭证有效至 ' + fmtTime(a.refreshExpiresAt) + '）' : '')) + '">待自动续期</span>'
            : '')) +
        '<span class="spacer"></span>' +
        '<button class="btn sm danger" data-unbind="' + esc(a.id) + '">解绑</button></div>';
    });
    html += '</div>';
    // Bluesky / Mastodon：凭据连接表单（无需 OAuth）
    if (p.id === 'bluesky') {
      html += '<div style="margin-top:10px;border-top:1px dashed var(--border);padding-top:10px">' +
        '<div class="small muted" style="margin-bottom:6px">在 Bluesky「设置 → App Passwords」生成应用密码（不要用主密码）。会话由 Echo 自动续期，通常无需重复操作。</div>' +
        '<div class="row" style="margin-bottom:6px"><input type="text" id="bsky-handle" placeholder="handle，如 kevin.bsky.social" style="flex:1"></div>' +
        '<div class="row"><input type="password" id="bsky-password" placeholder="App Password（xxxx-xxxx-xxxx-xxxx）" style="flex:1">' +
        '<button class="btn primary sm" id="btn-connect-bsky">连接 Bluesky</button></div></div>';
    }
    if (p.id === 'mastodon') {
      html += '<div style="margin-top:10px;border-top:1px dashed var(--border);padding-top:10px">' +
        '<div class="small muted" style="margin-bottom:6px">在你的实例「首选项 → 开发 → 新建应用」勾选 write 权限，创建后复制「访问令牌」。令牌默认长期有效。</div>' +
        '<div class="row" style="margin-bottom:6px"><input type="text" id="masto-instance" placeholder="实例地址，如 https://mastodon.social" style="flex:1"></div>' +
        '<div class="row"><input type="password" id="masto-token" placeholder="访问令牌" style="flex:1">' +
        '<button class="btn primary sm" id="btn-connect-masto">连接 Mastodon</button></div></div>';
    }
    // Threads：OAuth 回调配置受阻时的手动令牌入口（Meta 后台「用户口令生成器」）
    if (p.id === 'threads' && !connectedOf('threads').length) {
      html += '<div style="margin-top:10px;border-top:1px dashed var(--border);padding-top:10px">' +
        '<div class="small muted" style="margin-bottom:6px">回调地址保存受阻？备用通道：在 Meta 应用后台「Threads API → 设置 → 用户口令生成器」生成长期口令，粘贴到下面直接连接（文字帖无需隧道；带图帖仍需隧道）。</div>' +
        '<div class="row"><input type="text" id="manual-token" placeholder="粘贴 Threads 长期访问口令" style="flex:1">' +
        '<button class="btn primary sm" id="btn-manual-token">令牌连接</button></div></div>';
    }
    html += '</div></div>';
  });
  view.innerHTML = html;

  // Bluesky：handle + App Password
  var btnBsky = $('#btn-connect-bsky');
  if (btnBsky) {
    btnBsky.addEventListener('click', async function () {
      var identifier = ($('#bsky-handle').value || '').trim();
      var password = ($('#bsky-password').value || '').trim();
      if (!identifier || !password) { toast('请填写 handle 和 App Password', 'err'); return; }
      btnBsky.disabled = true;
      btnBsky.textContent = '验证中…';
      try {
        var r = await api('POST', '/api/accounts/manual', {
          platform: 'bluesky',
          credentials: { identifier: identifier, password: password }
        });
        toast('Bluesky 连接成功：@' + r.account.username, 'ok');
        await refreshAccounts();
        renderAccounts();
      } catch (e) {
        toast(e.message, 'err');
        btnBsky.disabled = false;
        btnBsky.textContent = '连接 Bluesky';
      }
    });
  }

  // Mastodon：实例 + 访问令牌
  var btnMasto = $('#btn-connect-masto');
  if (btnMasto) {
    btnMasto.addEventListener('click', async function () {
      var instance = ($('#masto-instance').value || '').trim();
      var token = ($('#masto-token').value || '').trim();
      if (!instance || !token) { toast('请填写实例地址和访问令牌', 'err'); return; }
      btnMasto.disabled = true;
      btnMasto.textContent = '验证中…';
      try {
        var r = await api('POST', '/api/accounts/manual', {
          platform: 'mastodon',
          credentials: { instance: instance, token: token }
        });
        toast('Mastodon 连接成功：@' + r.account.username, 'ok');
        await refreshAccounts();
        renderAccounts();
      } catch (e) {
        toast(e.message, 'err');
        btnMasto.disabled = false;
        btnMasto.textContent = '连接 Mastodon';
      }
    });
  }

  // 手动令牌连接（Threads 备用通道）
  var btnManual = $('#btn-manual-token');
  if (btnManual) {
    btnManual.addEventListener('click', function () {
      var token = ($('#manual-token').value || '').trim();
      if (!token) { toast('请先粘贴长期访问口令', 'err'); return; }
      btnManual.disabled = true;
      btnManual.textContent = '验证中…';
      api('POST', '/api/accounts/manual', { platform: 'threads', token: token }).then(async function (r) {
        toast('Threads 令牌连接成功：@' + r.account.username, 'ok');
        await refreshAccounts();
        renderAccounts();
      }).catch(function (e) {
        toast(e.message, 'err');
        btnManual.disabled = false;
        btnManual.textContent = '令牌连接';
      });
    });
  }

}

/* ---------- 全局点击委托（只绑定一次，避免重复渲染叠加监听） ---------- */
/* ---------- 全局 change 委托（分段平台开关等） ---------- */
function handleGlobalChange(ev) {
  var el = ev.target.closest('[data-seg-plat]');
  if (!el) return;
  var seg = parseInt(el.getAttribute('data-seg'), 10) || 0;
  var plat = el.getAttribute('data-seg-plat');
  var list = state.segExclude[seg] || (state.segExclude[seg] = []);
  // 标记为手动设置，后续输入不再套用"含链接默认取消 X"
  (state.segManual[seg] = state.segManual[seg] || {})[plat] = true;
  if (el.checked) {
    state.segExclude[seg] = list.filter(function (p) { return p !== plat; });
    // 反向同步：勾选某平台的分段 → 自动选中该平台的目标账号
    state.accounts.forEach(function (a) {
      if (a.platform === plat) state.selectedAccounts.add(a.id);
    });
  } else if (list.indexOf(plat) === -1) {
    list.push(plat);
    // 该平台已无任何分段勾选 → 取消选中该平台的目标账号（不再触发主开关覆盖）
    var anyOn = false;
    for (var k = 0; k < state.segExclude.length; k++) {
      if ((state.segExclude[k] || []).indexOf(plat) === -1) { anyOn = true; break; }
    }
    if (!anyOn) {
      state.accounts.forEach(function (a) {
        if (a.platform === plat) state.selectedAccounts.delete(a.id);
      });
    }
  }
  renderSegments();
  updateAccountCheckboxStates();
  if (state.showPreview) renderPreview();
}

function handleGlobalClick(ev) {
  var t = ev.target;

  var copyEl = t.closest('[data-copy]');
  if (copyEl) {
    var text = copyEl.getAttribute('data-copy');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制：' + text, 'ok'); }, function () { toast('复制失败，请手动复制', 'err'); });
    } else { toast('浏览器不支持自动复制', 'err'); }
    return;
  }

  var connectEl = t.closest('[data-connect]');
  if (connectEl) {
    var pid = connectEl.getAttribute('data-connect');
    api('POST', '/api/auth/' + pid + '/start').then(function (r) {
      location.href = r.authUrl;
    }).catch(function (e) { toast(e.message, 'err'); });
    return;
  }

  var unbindEl = t.closest('[data-unbind]');
  if (unbindEl) {
    var uid = unbindEl.getAttribute('data-unbind');
    if (!confirm('解绑后需要重新授权才能发布，确定解绑？')) return;
    api('DELETE', '/api/accounts/' + uid).then(async function () {
      toast('已解绑', 'ok');
      await refreshAccounts();
      renderAccounts();
    }).catch(function (e) { toast(e.message, 'err'); });
    return;
  }

  var editEl = t.closest('[data-edit]');
  if (editEl) {
    state.draftId = editEl.getAttribute('data-edit');
    location.hash = '#/composer';
    return;
  }

  var delDraftEl = t.closest('[data-del-draft]');
  if (delDraftEl) {
    var did = delDraftEl.getAttribute('data-del-draft');
    if (!confirm('确定删除这条草稿？')) return;
    api('DELETE', '/api/drafts/' + did).then(async function () {
      toast('草稿已删除', 'ok');
      if (state.draftId === did) state.draftId = null;
      await refreshDrafts();
      renderBadges();
      renderDrafts();
    }).catch(function (e) { toast(e.message, 'err'); });
    return;
  }

  var qtEl = t.closest('[data-qt]');
  if (qtEl) {
    state.queueTab = qtEl.getAttribute('data-qt');
    renderQueue();
    return;
  }

  var pubNowEl = t.closest('[data-pub-now]');
  if (pubNowEl) {
    postAction('/api/posts/' + pubNowEl.getAttribute('data-pub-now') + '/publish-now', '已触发发布');
    return;
  }

  var cancelEl = t.closest('[data-cancel]');
  if (cancelEl) {
    postAction('/api/posts/' + cancelEl.getAttribute('data-cancel'), '已取消', 'DELETE');
    return;
  }

  var retryEl = t.closest('[data-retry]');
  if (retryEl) {
    postAction('/api/posts/' + retryEl.getAttribute('data-retry') + '/retry', '重试结果');
    return;
  }

  var rmMediaEl = t.closest('[data-rm-media]');
  if (rmMediaEl) {
    var mid = rmMediaEl.getAttribute('data-rm-media');
    var seg = parseInt(rmMediaEl.getAttribute('data-seg'), 10) || 0;
    state.segMedia[seg] = (state.segMedia[seg] || []).filter(function (x) { return x !== mid; });
    renderSegments();
    renderMediaStrip();
    return;
  }

  if (t.closest('[data-modal-close]')) {
    closePublishModal();
    return;
  }
}
/* ---------- 视图：设置 ---------- */
async function renderSettings() {
  var view = $('#view');
  var s = { schedulerIntervalMs: 30000, defaultQueueTimes: ['09:00', '12:00', '18:00'], threadsImageBaseUrl: '' };
  try { s = await api('GET', '/api/settings').then(function (r) { return r.settings; }); } catch (e) { }
  view.innerHTML =
    '<h2 class="page-title">设置</h2>' +
    '<div class="card"><h3>调度</h3>' +
    '<div class="row" style="margin-bottom:8px"><label style="min-width:170px">轮询间隔（毫秒，≥5000）</label>' +
    '<input type="text" id="set-interval" value="' + esc(s.schedulerIntervalMs) + '" style="width:120px"></div>' +
    '<div class="row"><label style="min-width:170px">默认发布时间（队列快捷用）</label>' +
    '<input type="text" id="set-queue-times" value="' + esc((s.defaultQueueTimes || []).join(', ')) + '" style="width:200px" placeholder="09:00, 12:00, 18:00"></div>' +
    '</div>' +
    '<div class="card"><h3>Threads 图片公网地址</h3>' +
    '<p class="small muted">Threads API 要求图片 URL 可被其服务器访问。本机服务默认地址对 Threads 不可达；使用隧道（如 cloudflared / ngrok）拿到公网地址后填在这里，即可发布带图贴文。纯文字不受影响。</p>' +
    '<div class="row"><label style="min-width:170px">图片 Base URL</label>' +
    '<input type="text" id="set-threads-base" value="' + esc(s.threadsImageBaseUrl || '') + '" style="flex:1" placeholder="https://your-tunnel.example.com"></div>' +
    '</div>' +
    '<div class="row"><button class="btn primary" id="btn-save-settings">保存设置</button></div>';

  $('#btn-save-settings').addEventListener('click', async function () {
    var interval = parseInt($('#set-interval').value, 10);
    var times = $('#set-queue-times').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var base = $('#set-threads-base').value.trim();
    try {
      await api('PUT', '/api/settings', {
        schedulerIntervalMs: interval,
        defaultQueueTimes: times,
        threadsImageBaseUrl: base
      });
      toast('设置已保存（重启后 Tunnel 地址需写入 .env 才能持久化）', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ---------- 视图：申请指南 ---------- */
async function renderGuide() {
  var view = $('#view');
  view.innerHTML = '<h2 class="page-title">API / 开发者账号申请指南</h2><div class="loading">加载中…</div>';
  try {
    var r = await api('GET', '/api/apply-guide');
    view.innerHTML = '<h2 class="page-title">API / 开发者账号申请指南</h2>' + renderMarkdown(r.markdown);
  } catch (e) {
    view.innerHTML = '<h2 class="page-title">申请指南</h2><div class="empty">文档缺失：docs/API_APPLY_GUIDE.md</div>';
  }
}

function renderMarkdown(src) {
  var lines = String(src).split(/\r?\n/);
  var html = '', inCode = false, listType = null, para = [];
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, function (m, c) { return '<code>' + c + '</code>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function flushPara() {
    if (para.length) { html += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; }
  }
  function flushList() { if (listType) { html += '</' + listType + '>'; listType = null; } }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.trim().indexOf('```') === 0) {
      flushPara(); flushList();
      if (inCode) { html += '</code></pre>'; inCode = false; } else { html += '<pre><code>'; inCode = true; }
      continue;
    }
    if (inCode) { html += esc(line) + '\n'; continue; }
    if (/^#{1,6}\s/.test(line)) {
      flushPara(); flushList();
      var lv = Math.min(line.match(/^#+/)[0].length, 4);
      html += '<h' + lv + '>' + inline(line.replace(/^#+\s/, '')) + '</h' + lv + '>';
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) { flushPara(); flushList(); html += '<hr>'; continue; }
    if (/^&gt;\s?/.test(esc(line))) { flushPara(); flushList(); html += '<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>'; continue; }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (listType !== 'ul') { flushList(); html += '<ul>'; listType = 'ul'; }
      html += '<li>' + inline(line.replace(/^[-*]\s+/, '')) + '</li>';
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushPara();
      if (listType !== 'ol') { flushList(); html += '<ol>'; listType = 'ol'; }
      html += '<li>' + inline(line.replace(/^\d+\.\s+/, '')) + '</li>';
      continue;
    }
    if (line.trim() === '') { flushPara(); flushList(); continue; }
    para.push(line);
  }
  flushPara(); flushList();
  if (inCode) html += '</code></pre>';
  return '<div class="md">' + html + '</div>';
}

/* ---------- 启动 ---------- */
init().catch(function (e) {
  $('#view').innerHTML = '<div class="empty">初始化失败：' + esc(e.message) + '</div>';
});
