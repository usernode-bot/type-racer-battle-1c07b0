const { test } = require('node:test');
const assert = require('node:assert');
const { wpm, accuracy, placeEntries, settleDue, maxPlausibleProgress, foldEvents } = require('../lib/scoring');

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

const foldEntries = [
  { lane: 0, user_id: 'u1', progress: 0, finished_at: null },
  { lane: 1, user_id: 'u2', progress: 0, finished_at: null },
  { lane: 2, user_id: null, progress: 33, finished_at: new Date(1000) }, // a demo bot
];

test('foldEvents takes the furthest progress, even out of order', () => {
  const events = [
    { racer_id: 'u1', seq: 4, chars_typed: 40, ts: new Date(4000) },
    { racer_id: 'u1', seq: 1, chars_typed: 10, ts: new Date(1000) },
    { racer_id: 'u1', seq: 3, chars_typed: 25, ts: new Date(3000) },
    { racer_id: 'u1', seq: 2, chars_typed: 25, ts: new Date(2500) },
  ];
  const folded = foldEvents(foldEntries, events, 100);
  assert.strictEqual(folded[0].progress, 40);
  // The stored entry is never mutated.
  assert.strictEqual(foldEntries[0].progress, 0);
});

test('foldEvents marks the finish at the first full-length event', () => {
  const events = [
    { racer_id: 'u2', seq: 1, chars_typed: 60, ts: new Date(1000) },
    { racer_id: 'u2', seq: 2, chars_typed: 90, ts: new Date(2000) },
    { racer_id: 'u2', seq: 3, chars_typed: 100, ts: new Date(3000) },
  ];
  const folded = foldEvents(foldEntries, events, 100);
  assert.strictEqual(folded[1].progress, 100);
  assert.strictEqual(folded[1].finished_at.getTime(), 3000); // lowest seq reaching total
  assert.strictEqual(folded[2].finished_at.getTime(), 1000); // untouched
});

test('foldEvents keeps entries without events, as stored', () => {
  const events = [{ racer_id: 'u1', seq: 1, chars_typed: 10, ts: new Date(1000) }];
  const folded = foldEvents(foldEntries, events, 100);
  assert.strictEqual(folded[2].progress, 33);
  assert.strictEqual(folded[2].finished_at.getTime(), 1000);
  // A racer who appears in entries but not in events also keeps its values.
  assert.strictEqual(folded[1].progress, 0);
  assert.strictEqual(folded[1].finished_at, null);
});

test('folded entries place like the stored rows when the log agrees', () => {
  // A log consistent with the stored rows: u2 finishes at 3000 with 100,
  // u1 is at 40 with no finish. Folding must not reorder the field.
  const stored = [
    { lane: 0, user_id: 'u1', progress: 40, finished_at: null },
    { lane: 1, user_id: 'u2', progress: 100, finished_at: new Date(3000) },
  ];
  const events = [
    { racer_id: 'u1', seq: 1, chars_typed: 20, ts: new Date(1000) },
    { racer_id: 'u1', seq: 2, chars_typed: 40, ts: new Date(2000) },
    { racer_id: 'u2', seq: 1, chars_typed: 100, ts: new Date(3000) },
  ];
  const byLog = placeEntries(foldEvents(stored, events, 100)).map((e) => e.lane);
  const byRows = placeEntries(stored).map((e) => e.lane);
  assert.deepStrictEqual(byLog, byRows);
  assert.deepStrictEqual(byLog, [1, 0]); // finisher first
});

test('settleDue agrees on folded and stored entries', () => {
  const events = [
    { racer_id: 'u1', seq: 1, chars_typed: 40, ts: new Date(2000) },
    { racer_id: 'u2', seq: 1, chars_typed: 100, ts: new Date(3000) },
  ];
  const stored = [
    { lane: 0, user_id: 'u1', progress: 40, finished_at: null },
    { lane: 1, user_id: 'u2', progress: 100, finished_at: new Date(3000) },
  ];
  const folded = foldEvents(stored, events, 100);
  const firstFinish = { ...baseRace, first_finish_at: new Date(3000) };
  for (const at of [2000, 25000, 32000, 33000, 180000]) {
    assert.strictEqual(
      settleDue(firstFinish, folded, new Date(at)),
      settleDue(firstFinish, stored, new Date(at)),
      'settleDue diverged at ' + at);
  }
  // And the folded entries are what actually settle the race: one unfinished
  // racer holds it open until 30 s after the first finish.
  assert.strictEqual(settleDue(firstFinish, folded, new Date(32000)), false);
  assert.strictEqual(settleDue(firstFinish, folded, new Date(33000)), true);
});