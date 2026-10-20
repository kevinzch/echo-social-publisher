/**
 * shared/preflight.js — 发布前本地校验（前后端共用）
 *
 * 在发出任何请求之前，逐段 × 逐平台检查：字数、图片数量、单图大小、图片格式。
 * 目的：避免"部分平台发出去、部分平台因超限被跳过"，导致贴文缺段。
 *
 * analyze(segments, platforms, mediaById) → issues[]
 *   segments:  [{ text, media: [mediaId], exclude: [platformId] }]
 *   platforms: [{ id, name, limits }]
 *   mediaById: (id) => { name, size, mime } | null
 *   issue:     { segNo, platform, platformName, kind, message }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./chars'));
  } else {
    root.EchoPreflight = factory(root.EchoChars);
  }
})(typeof self !== 'undefined' ? self : this, function (Chars) {
  'use strict';

  function formatBytes(n) {
    if (!n && n !== 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function charCount(text, weighted) {
    if (weighted && Chars && Chars.analyze) return Chars.analyze(text).weighted;
    return Array.from(String(text || '')).length;
  }

  function analyze(segments, platforms, mediaById) {
    const issues = [];
    const getMedia = typeof mediaById === 'function' ? mediaById : () => null;

    (segments || []).forEach((seg, idx) => {
      const text = String(seg.text || '');
      const mediaIds = Array.isArray(seg.media) ? seg.media : [];
      const hasContent = text.trim() || mediaIds.length;
      if (!hasContent) return;

      const excluded = Array.isArray(seg.exclude) ? seg.exclude : [];

      for (const p of platforms || []) {
        if (!p || !p.limits) continue;
        if (excluded.indexOf(p.id) !== -1) continue; // 该段不发给此平台，不校验

        const lim = p.limits;
        const count = charCount(text, lim.weighted);
        if (lim.maxChars && count > lim.maxChars) {
          issues.push({
            segNo: idx + 1, platform: p.id, platformName: p.name, kind: 'chars',
            message: `${p.name}：字数 ${count}/${lim.maxChars}`
          });
        }

        if (mediaIds.length > lim.maxImages) {
          issues.push({
            segNo: idx + 1, platform: p.id, platformName: p.name, kind: 'count',
            message: `${p.name}：图片 ${mediaIds.length} 张，上限 ${lim.maxImages} 张`
          });
        }

        mediaIds.forEach((id, mi) => {
          const m = getMedia(id);
          if (!m) return; // 文件缺失由发布器另行报错
          const ordinal = mi + 1;
          const label = `第 ${ordinal} 张图片（${m.name || m.id}）`;
          if (lim.imageMimes && lim.imageMimes.length && lim.imageMimes.indexOf(m.mime) === -1) {
            issues.push({
              segNo: idx + 1, platform: p.id, platformName: p.name, kind: 'mime',
              mediaId: id, mediaIndex: ordinal, mediaName: m.name || id,
              message: `${p.name}：${label}格式 ${m.mime} 不支持`
            });
            return;
          }
          if (lim.maxImageBytes && m.size > lim.maxImageBytes) {
            issues.push({
              segNo: idx + 1, platform: p.id, platformName: p.name, kind: 'size',
              mediaId: id, mediaIndex: ordinal, mediaName: m.name || id,
              message: `${p.name}：${label}${formatBytes(m.size)}，上限 ${formatBytes(lim.maxImageBytes)}`
            });
          }
        });
      }
    });

    return issues;
  }

  /** 摘要：取前 N 条 + 总数，用于 toast / 错误信息 */
  function summary(issues, max) {
    const n = max || 3;
    const head = issues.slice(0, n).map((x) => x.message).join('；');
    return issues.length > n ? `${head}（共 ${issues.length} 项）` : head;
  }

  return { analyze, summary, formatBytes };
});
