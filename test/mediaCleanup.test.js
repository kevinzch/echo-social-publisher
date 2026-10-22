/**
 * test/mediaCleanup.test.js — 孤儿判定与新图保护期
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findOrphans, referencedIds } = require('../server/mediaCleanup');

const NOW = Date.parse('2026-10-22T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

function fixture() {
  return {
    store: { drafts: { list: () => [] }, posts: { list: () => [] } },
    media: {
      list: () => [
        { id: 'fresh', createdAt: hoursAgo(1) },
        { id: 'day2', createdAt: hoursAgo(48) },
        { id: 'week', createdAt: hoursAgo(24 * 8) }
      ]
    }
  };
}

test('新图保护期：保护期内的图片不会被清理', () => {
  const { store, media } = fixture();
  assert.deepEqual(
    findOrphans({ store, media, days: 0, graceHours: 24, now: NOW }).map((m) => m.id),
    ['day2', 'week'],
    '1 小时前上传的图片应受保护'
  );
});

test('保护期为 0 时退回旧行为', () => {
  const { store, media } = fixture();
  assert.deepEqual(
    findOrphans({ store, media, days: 0, graceHours: 0, now: NOW }).map((m) => m.id),
    ['fresh', 'day2', 'week']
  );
});

test('保留天数比保护期更严格时取更严格的门槛', () => {
  const { store, media } = fixture();
  assert.deepEqual(
    findOrphans({ store, media, days: 3, graceHours: 24, now: NOW }).map((m) => m.id),
    ['week'],
    '保留 3 天时，48 小时的图片也不该被清理'
  );
});

test('草稿与发布记录引用的图片不算孤儿', () => {
  const store = {
    drafts: { list: () => [{ segments: [{ media: ['fresh'] }] }] },
    posts: { list: () => [{ segments: [{ media: ['day2'] }] }] }
  };
  const media = { list: () => [{ id: 'fresh' }, { id: 'day2' }, { id: 'other' }] };
  assert.deepEqual([...referencedIds(store)].sort(), ['day2', 'fresh']);
  assert.deepEqual(
    findOrphans({ store, media, days: 0, graceHours: 0, now: NOW }).map((m) => m.id),
    ['other']
  );
});
