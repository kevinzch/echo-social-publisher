/**
 * server/mediaCleanup.js — 孤儿图片清理
 *
 * 孤儿 = 不被任何草稿、任何发布记录引用的图片。
 * 已发布的图片只要记录还在就永远不算孤儿（记录不会自动删除）。
 */
'use strict';

/** 收集草稿与发布记录里引用到的 mediaId */
function referencedIds(store) {
  const ids = new Set();
  const collect = (segments) => {
    (segments || []).forEach((s) => (s.media || []).forEach((id) => ids.add(id)));
  };
  store.drafts.list().forEach((d) => collect(d.segments));
  store.posts.list().forEach((p) => collect(p.segments));
  return ids;
}

/**
 * @param {{store:object, media:object, days:number, graceHours?:number, now?:number}} opts
 * days=0 表示不按"保留天数"过滤；graceHours 是"新图保护期"，
 * 刚上传的图片在保护期内一律不删（避免刚粘贴就被清理）。
 * 实际门槛取两者中更严格的一个。
 */
function findOrphans({ store, media, days, graceHours, now }) {
  const used = referencedIds(store);
  const base = now == null ? Date.now() : now;
  const minAgeMs = Math.max(
    Math.max(0, days || 0) * 24 * 3600 * 1000,
    Math.max(0, graceHours || 0) * 3600 * 1000
  );
  const cutoff = base - minAgeMs;
  return media.list().filter((m) => {
    if (used.has(m.id)) return false;
    const created = m.createdAt ? new Date(m.createdAt).getTime() : 0;
    return created <= cutoff;
  });
}

async function cleanupOrphans({ store, media, days, graceHours, now }) {
  const list = findOrphans({ store, media, days, graceHours, now });
  let freedBytes = 0;
  let removed = 0;
  for (const m of list) {
    freedBytes += m.size || 0;
    try {
      if (await media.remove(m.id)) removed++;
    } catch { /* 单个失败不影响其余 */ }
  }
  if (removed > 0) {
    await store.log('info', 'media', `清理孤儿图片 ${removed} 张，释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB`);
  }
  return { removed, freedBytes, ids: list.map((m) => m.id) };
}

module.exports = { referencedIds, findOrphans, cleanupOrphans };
