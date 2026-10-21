/**
 * shared/chars.js — 中英文字符统计 + X 加权字数（前后端共用，无依赖）
 *
 * 规则说明：
 * - chinese：CJK 统一表意文字（含扩展 A/B、兼容表意、CJK 标点、全角符号中的表意部分）
 * - other  ：其余 Unicode 标量（英文、数字、符号、emoji 等）
 * - weighted（X 规则）：CJK/韩文/日文假名/全角等区间按 2 计；URL 整体按 23 计；其余按 1 计
 *   （对齐 twitter-text 的公开配置，最终以 X 官方计数为准）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EchoChars = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 中文判定：CJK 统一表意 + 扩展 A + 兼容表意 + 扩展 B+ + CJK 标点
  var CHINESE_RANGES = [
    [0x2e80, 0x2eff], // CJK 部首补充
    [0x3000, 0x303f], // CJK 标点符号
    [0x3400, 0x4dbf], // 扩展 A
    [0x4e00, 0x9fff], // 基本区
    [0xf900, 0xfaff], // 兼容表意
    [0x20000, 0x2a6df], // 扩展 B
    [0x2a700, 0x2ebef], // 扩展 C-F
    [0x2f800, 0x2fa1f], // 兼容表意补充
    [0x30000, 0x3134f]  // 扩展 G
  ];
  function inRanges(cp, ranges) {
    for (var i = 0; i < ranges.length; i++) {
      if (cp >= ranges[i][0] && cp <= ranges[i][1]) return true;
    }
    return false;
  }
  function isChineseChar(ch) {
    var cp = ch.codePointAt(0);
    return inRanges(cp, CHINESE_RANGES);
  }

  // X 加权计数区间（twitter-text 公开配置，权重 2）
  var X_WEIGHT2_RANGES = [
    [0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0xa4cf], [0xa960, 0xa97f],
    [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
    [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x2fa1f], [0x30000, 0x3fffd]
  ];
  function isWeight2Char(ch) {
    return inRanges(ch.codePointAt(0), X_WEIGHT2_RANGES);
  }

  var URL_RE = /https?:\/\/[^\s]+/g;
  var X_URL_WEIGHT = 23;
  var EMOJI_WEIGHT = 2; // X 对多数 emoji 按 2 计

  function isEmoji(ch) {
    var cp = ch.codePointAt(0);
    return (
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x1f1e6 && cp <= 0x1f1ff) ||
      cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)
    );
  }

  /**
   * 分析一段文本
   * @returns {{total:number, chinese:number, other:number, weighted:number, urls:number, chars:Array}}
   *   total/other 以 Unicode 标量（code point）计；emoji 组合不当拆分（单独计数）
   */
  function analyze(text) {
    var res = { total: 0, chinese: 0, other: 0, weighted: 0, urls: 0, urlChars: 0, literal: 0 };
    if (!text) return res;
    var str = String(text);
    // 先把 URL 抠出来按 23 计，剩余字符按规则加权
    var urls = str.match(URL_RE) || [];
    res.urls = urls.length;
    res.urlChars = urls.reduce(function (n, u) { return n + Array.from(u).length; }, 0);
    var withoutUrls = str.replace(URL_RE, '');
    var weighted = urls.length * X_URL_WEIGHT;

    var chars = Array.from(withoutUrls);
    res.total = chars.length;
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (isChineseChar(ch)) {
        res.chinese += 1;
        res.other += 0;
        weighted += 2;
      } else if (isEmoji(ch)) {
        res.other += 1;
        weighted += EMOJI_WEIGHT;
      } else {
        // 英文/数字/ASCII 符号/拉丁扩展等
        res.other += 1;
        weighted += isWeight2Char(ch) ? 2 : 1;
      }
    }
    res.weighted = weighted;
    // literal：URL 按原样计入的总字符数（Threads/Bluesky 等按字面计数的平台用）
    res.literal = res.total + res.urlChars;
    return res;
  }

  /**
   * 按平台限额计算字数
   * - weighted（X）：URL 按 23 计、CJK 按 2 计
   * - urlWeight（Mastodon）：URL 按 23 计，其余按 1
   * - 其余（Threads / Bluesky）：URL 按字面长度计
   */
  function countFor(text, limits) {
    var a = analyze(text);
    if (!limits) return a.literal;
    if (limits.weighted) return a.weighted;
    if (limits.urlWeight) return a.total + a.urls * limits.urlWeight;
    return a.literal;
  }

  /** X 加权后剩余字数 */
  function remainingX(text, limit) {
    var a = analyze(text);
    return (limit == null ? 280 : limit) - a.weighted;
  }

  return {
    analyze: analyze,
    countFor: countFor,
    remainingX: remainingX,
    isChineseChar: isChineseChar,
    X_URL_WEIGHT: X_URL_WEIGHT,
    CHINESE_RANGES: CHINESE_RANGES
  };
});
