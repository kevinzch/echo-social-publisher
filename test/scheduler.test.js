/**
 * test/scheduler.test.js — 定时调度（注入时钟与假 executor）
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler } = require('../server/scheduler');
const { Store } = require('../server/store');
const { tmpDir } = require('./helpers');

async function makeStore() {
  return new Store(tmpDir('echo-sched-'));
}

async function seedPost(store, { id, scheduledAt, status = 'pending', attempts = 0, nextAttemptAt = null }) {
  await store.posts.insert({
    id,
    draftId: 'draft_1',
    platform: 'x',
    accountId: 'x:1',
    segments: [{ text: 'hello', media: [] }],
    scheduledAt,
    status,
    attempts,
    nextAttemptAt,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

test('到期任务被执行', async () => {
  const store = await makeStore();
  let now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const executed = [];
  const sched = new Scheduler({
    store,
    executor: async (p) => { executed.push(p.id); },
    intervalMs: 1000,
    nowFn: () => now
  });
  await seedPost(store, { id: 'p1', scheduledAt: now - 5000 });
  await seedPost(store, { id: 'p2', scheduledAt: now + 60_000 });
  await sched.tick();
  assert.deepEqual(executed, ['p1']);
});

test('ISO 时间字符串的到期判断', async () => {
  const store = await makeStore();
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const executed = [];
  const sched = new Scheduler({ store, executor: async (p) => { executed.push(p.id); }, nowFn: () => now });
  await seedPost(store, { id: 'p1', scheduledAt: new Date(now - 1000).toISOString() });
  await seedPost(store, { id: 'p2', scheduledAt: 'not-a-date' });
  await sched.tick();
  assert.deepEqual(executed, ['p1']);
});

test('失败后指数退避并最终标记失败', async () => {
  const store = await makeStore();
  let now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const events = [];
  const sched = new Scheduler({
    store,
    executor: async () => { throw new Error('模拟失败'); },
    intervalMs: 1000,
    maxAttempts: 3,
    backoffMinutes: [5, 15, 60],
    nowFn: () => now
  });
  sched.onEvent = (type, data) => events.push([type, data]);
  await seedPost(store, { id: 'p1', scheduledAt: now });

  // 第 1 次失败 → 5 分钟后重试
  await sched.tick();
  let post = store.posts.get('p1');
  assert.equal(post.attempts, 1);
  assert.equal(post.status, 'pending');
  assert.equal(post.nextAttemptAt, now + 5 * 60_000);

  // 重试窗口未到 → 不执行
  now += 4 * 60_000;
  await sched.tick();
  assert.equal(store.posts.get('p1').attempts, 1);

  // 第 2 次失败 → 15 分钟后
  now += 1 * 60_000; // 到达 nextAttemptAt
  await sched.tick();
  post = store.posts.get('p1');
  assert.equal(post.attempts, 2);
  assert.equal(post.nextAttemptAt, now + 15 * 60_000);

  // 第 3 次失败 → 达到最大次数 → failed
  now += 15 * 60_000;
  await sched.tick();
  post = store.posts.get('p1');
  assert.equal(post.attempts, 3);
  assert.equal(post.status, 'failed');
  assert.equal(post.error, '模拟失败');

  assert.deepEqual(events.map((e) => e[0]), ['due', 'retry', 'due', 'retry', 'due', 'failed']);
  const warnLogs = store.logs.filter((l) => l.scope === 'scheduler' && l.level === 'warn');
  assert.equal(warnLogs.length, 2);
  assert.ok(warnLogs[0].message.includes('5 分钟后'));
});

test('start() 立即补投到期任务，stop() 停止', async () => {
  const store = await makeStore();
  const now = Date.now();
  const executed = [];
  const sched = new Scheduler({
    store,
    executor: async (p) => { executed.push(p.id); },
    intervalMs: 60_000
  });
  await seedPost(store, { id: 'p1', scheduledAt: now - 10_000 });
  sched.start();
  await new Promise((r) => setTimeout(r, 50));
  sched.stop();
  assert.deepEqual(executed, ['p1']);
});

test('并发 tick 不重复执行', async () => {
  const store = await makeStore();
  const now = Date.now();
  let running = 0, maxRunning = 0;
  const sched = new Scheduler({
    store,
    executor: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
    },
    intervalMs: 10,
    nowFn: () => now
  });
  await seedPost(store, { id: 'p1', scheduledAt: now });
  await Promise.all([sched.tick(), sched.tick(), sched.tick()]);
  assert.equal(maxRunning, 1);
});

test('孤儿清理钩子：每 24 小时最多触发一次', async () => {
  const store = await makeStore();
  let calls = 0;
  let clock = 1_700_000_000_000;
  const scheduler = new Scheduler({
    store,
    executor: async () => {},
    intervalMs: 1000,
    nowFn: () => clock,
    mediaCleanup: async () => { calls++; }
  });

  await scheduler.tick();
  assert.equal(calls, 1, '启动首次 tick 应触发一次');

  clock += 3600 * 1000;
  await scheduler.tick();
  assert.equal(calls, 1, '1 小时后不应重复清理');

  clock += 24 * 3600 * 1000;
  await scheduler.tick();
  assert.equal(calls, 2, '超过 24 小时应再次触发');
});

test('孤儿清理钩子异常不影响调度', async () => {
  const store = await makeStore();
  const scheduler = new Scheduler({
    store,
    executor: async () => {},
    intervalMs: 1000,
    nowFn: () => 1_700_000_000_000,
    mediaCleanup: async () => { throw new Error('boom'); }
  });
  await scheduler.tick();
  assert.ok(true, '不应抛出');
});
