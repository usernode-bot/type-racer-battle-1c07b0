const { test } = require('node:test');
const assert = require('node:assert');
const { wpm, accuracy, placeEntries, settleDue, maxPlausibleProgress, progressStamp } = require('../lib/scoring');

test('wpm counts five characters per word, rounded', () => {
  // 300 chars in 60 s = 60 words = 60 wpm.
  assert.strictEqual(wpm(300, 60000), 60);
  // 110 chars in 30 s = 22 words / 0.5 min = 44 wpm.
  assert.strictEqual(wpm(110, 30000), 44);
  // Rounds to nearest: 105 chars in 60 s = 21 wpm.
  assert.strictEqual(wpm(105, 60000), 21);
  assert.strictEqual(wpm(104, 60000), 21);
});

test('wpm is zero without time or characters', () => {
  assert.strictEqual(wpm(0, 60000), 0);
  assert.strictEqual(wpm(100, 0), 0);
});

test('accuracy is a whole percent, 100 when nothing was typed', () => {
  assert.strictEqual(accuracy(98, 100), 98);
  assert.strictEqual(accuracy(1, 3), 33);
  assert.strictEqual(accuracy(0, 0), 100);
});

test('placeEntries puts finishers first by time, then others by progress', () => {
  const t0 = 1000;
  const entries = [
    { lane: 2, progress: 50, finished_at: new Date(t0 + 3000) }, // slow finisher
    { lane: 0, progress: 40, finished_at: null },                // stuck racer
    { lane: 1, progress: 90, finished_at: new Date(t0 + 1000) }, // winner
    { lane: 3, progress: 70, finished_at: null },
  ];
  const order = placeEntries(entries).map((e) => e.lane);
  assert.deepStrictEqual(order, [1, 2, 3, 0]);
});

test('placeEntries breaks ties by lane', () => {
  const t0 = 1000;
  const a = { lane: 4, progress: 50, finished_at: new Date(t0) };
  const b = { lane: 2, progress: 50, finished_at: new Date(t0) };
  assert.deepStrictEqual(placeEntries([a, b]).map((e) => e.lane), [2, 4]);
  const c = { lane: 4, progress: 50, finished_at: null };
  const d = { lane: 2, progress: 50, finished_at: null };
  assert.deepStrictEqual(placeEntries([c, d]).map((e) => e.lane), [2, 4]);
});

const baseRace = {
  starts_at: new Date(0),
  first_finish_at: null,
  passage: 'x'.repeat(100),
};

test('settleDue fires when everyone has finished', () => {
  const entries = [
    { finished_at: new Date(5000), progress: 100 },
    { finished_at: new Date(8000), progress: 100 },
  ];
  assert.strictEqual(settleDue(baseRace, entries, new Date(9000)), true);
});

test('settleDue fires 30 s after the first finish', () => {
  const race = { ...baseRace, first_finish_at: new Date(20000) };
  const entries = [{ finished_at: new Date(20000), progress: 100 }, { finished_at: null, progress: 10 }];
  assert.strictEqual(settleDue(race, entries, new Date(49999)), false);
  assert.strictEqual(settleDue(race, entries, new Date(50000)), true);
});

test('settleDue fires 3 minutes after the start', () => {
  const entries = [{ finished_at: null, progress: 10 }];
  assert.strictEqual(settleDue(baseRace, entries, new Date(179999)), false);
  assert.strictEqual(settleDue(baseRace, entries, new Date(180000)), true);
});

test('settleDue does not fire early on an empty race body', () => {
  assert.strictEqual(settleDue(baseRace, [], new Date(1000)), true); // nothing to wait for
});

test('maxPlausibleProgress caps at 25 characters per second', () => {
  assert.strictEqual(maxPlausibleProgress(1000), 25);
  assert.strictEqual(maxPlausibleProgress(10000), 250);
  assert.strictEqual(maxPlausibleProgress(0), 0);
  assert.strictEqual(maxPlausibleProgress(-5), 0);
  // 30 s in: 750 chars, far past any real passage.
  assert.strictEqual(maxPlausibleProgress(30000), 750);
});

test('progressStamp keeps a valid seq and clientId', () => {
  assert.deepStrictEqual(progressStamp({ seq: 3, clientId: 'abc-123' }), { seq: 3, clientId: 'abc-123' });
  // A numeric string seq is accepted and normalised to a number.
  assert.deepStrictEqual(progressStamp({ seq: '7', clientId: 'a' }), { seq: 7, clientId: 'a' });
  // Boundary: 1 and the int ceiling pass, a 64-char id passes.
  assert.deepStrictEqual(progressStamp({ seq: 1, clientId: 'x'.repeat(64) }), { seq: 1, clientId: 'x'.repeat(64) });
  assert.deepStrictEqual(progressStamp({ seq: 2147483647, clientId: 'x' }), { seq: 2147483647, clientId: 'x' });
});

test('progressStamp nulls an out-of-range or malformed seq', () => {
  for (const bad of [0, -1, 2.5, 2147483648, 'garbage', null, true, {}, []]) {
    assert.strictEqual(progressStamp({ seq: bad, clientId: 'a' }).seq, null, 'seq: ' + String(bad));
  }
});

test('progressStamp nulls a malformed clientId', () => {
  for (const bad of ['', 'a'.repeat(65), 42, null, 'has space', 'has_under', 'héllo']) {
    assert.strictEqual(progressStamp({ seq: 5, clientId: bad }).clientId, null, 'clientId: ' + String(bad));
  }
});

test('progressStamp answers all null for a missing or empty body', () => {
  assert.deepStrictEqual(progressStamp(undefined), { seq: null, clientId: null });
  assert.deepStrictEqual(progressStamp({}), { seq: null, clientId: null });
});