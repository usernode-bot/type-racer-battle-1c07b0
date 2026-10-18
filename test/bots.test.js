const test = require('node:test');
const assert = require('node:assert');
const { BOT_LEVELS, BOT_NAMES, pickBots, ghostTimeline, ghostProgress } = require('../lib/bots');

test('BOT_LEVELS: three levels, labels in order, speed rising', () => {
  const keys = Object.keys(BOT_LEVELS);
  assert.deepStrictEqual(keys, ['santai', 'sedang', 'ngebut']);
  assert.deepStrictEqual(keys.map((k) => BOT_LEVELS[k].label), ['Santai', 'Sedang', 'Ngebut']);
  const avgs = keys.map((k) => BOT_LEVELS[k].wpms.reduce((s, w) => s + w, 0) / 3);
  assert.ok(avgs[0] < avgs[1] && avgs[1] < avgs[2], 'average speed must rise');
});

test('pickBots: three distinct named bots at the level speeds', () => {
  // rand() = 0 always picks the first name left, so the names march through
  // BOT_NAMES in order and prove the splicing keeps them distinct.
  const bots = pickBots('sedang', () => 0);
  assert.strictEqual(bots.length, 3);
  assert.deepStrictEqual(bots.map((b) => b.name), BOT_NAMES.slice(0, 3));
  assert.deepStrictEqual(bots.map((b) => b.wpm), BOT_LEVELS.sedang.wpms);
  assert.deepStrictEqual(bots.map((b) => b.acc), BOT_LEVELS.sedang.accs);
  // Every name comes from the pool and no name repeats, whatever rand does.
  const wild = pickBots('ngebut', Math.random);
  for (const b of wild) assert.ok(BOT_NAMES.includes(b.name));
  assert.strictEqual(new Set(wild.map((b) => b.name)).size, 3);
});

test('ghostProgress: interpolates between samples', () => {
  const pts = [[0, 0], [1000, 50], [2000, 100]];
  // Before the first sample: 0.
  assert.strictEqual(ghostProgress([[500, 10], [1500, 60]], 100, 100).progress, 0);
  // Midpoint between two samples.
  assert.strictEqual(ghostProgress(pts, 1500, 100).progress, 75);
  // Clamped at len.
  assert.strictEqual(ghostProgress(pts, 5000, 100).progress, 100);
  // finishMs is the first sample at len, null before the run reaches it.
  assert.strictEqual(ghostProgress(pts, 1500, 100).finishMs, 2000);
  assert.strictEqual(ghostProgress([[0, 0], [1000, 50]], 500, 100).finishMs, null);
});

test('ghostTimeline: drops backwards points, appends the finish, null when empty', () => {
  // 400→40 goes back in time, so it is dropped; the finish point is appended.
  const kept = ghostTimeline([[0, 0], [500, 30], [400, 40], [900, 60]], 1000, 80);
  assert.deepStrictEqual(kept, [[0, 0], [500, 30], [900, 60], [1000, 80]]);
  // Progress is clamped to len.
  assert.deepStrictEqual(ghostTimeline([[0, 0], [100, 200]], 150, 50), [[0, 0], [100, 50]]);
  // Empty or invalid input gives null (the steady fallback).
  assert.strictEqual(ghostTimeline(null, 1000, 80), null);
  assert.strictEqual(ghostTimeline([], 1000, 80), null);
  assert.strictEqual(ghostTimeline([['x', 'y']], 1000, 80), null);
  // A source that never finished gets no appended finish point.
  assert.deepStrictEqual(ghostTimeline([[0, 0], [500, 30]], null, 80), [[0, 0], [500, 30]]);
});