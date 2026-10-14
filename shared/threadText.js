/**
 * shared/threadText.js — 手动分段（thread）解析与合并（前后端共用，无依赖）
 *
 * 约定：用户在分隔符行输入 `---`（独立一行）表示手动分段。
 * UI 工具栏"手动分段"按钮会在光标处插入该分隔行。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EchoThreadText = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var SEPARATOR = '---';

  /**
   * 把编辑器全文拆为分段数组。
   * - 仅识别"独立一行且 trim 后为 ---"的行
   * - 每段 trim 前后空白；空段丢弃（连续分隔符不会产生空段）
   * @returns {string[]}
   */
  function splitSegments(text) {
    if (!text) return [];
    var lines = String(text).split(/\r?\n/);
    var segments = [];
    var current = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === SEPARATOR) {
        segments.push(current.join('\n'));
        current = [];
      } else {
        current.push(lines[i]);
      }
    }
    segments.push(current.join('\n'));
    var out = [];
    for (var j = 0; j < segments.length; j++) {
      var t = segments[j].trim();
      if (t) out.push(t);
    }
    return out;
  }

  /** 分段数组 → 编辑器全文（分隔符行前后留空行，保证渲染美观） */
  function joinSegments(segments) {
    return (segments || [])
      .map(function (s) { return String(s || '').trim(); })
      .filter(Boolean)
      .join('\n\n' + SEPARATOR + '\n\n');
  }

  /** 插入分段按钮：在光标处插入分隔符行 */
  function insertSeparator(text, cursorPos) {
    if (cursorPos == null) cursorPos = (text || '').length;
    var before = text.slice(0, cursorPos).replace(/\s+$/, '');
    var after = text.slice(cursorPos).replace(/^\s+/, '');
    var ins = '\n\n' + SEPARATOR + '\n\n';
    var pos = before.length + ins.length;
    return { text: before + ins + after, cursorPos: pos };
  }

  /** 给前端预览：把全文渲染为分段卡片数据 */
  function previewSegments(text) {
    return splitSegments(text);
  }

  return {
    SEPARATOR: SEPARATOR,
    splitSegments: splitSegments,
    joinSegments: joinSegments,
    insertSeparator: insertSeparator,
    previewSegments: previewSegments
  };
});
