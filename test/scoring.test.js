const { test } = require('node:test');
const assert = require('node:assert');
const { wpm, accuracy, placeEntries, settleDue, maxPlausibleProgress, cleanMissedWords } = require('../lib/scoring');

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

const missPassage = 'The little boat. Gulls circled.';

test('cleanMissedWords keeps only words of the passage, normalized', () => {
  assert.deepStrictEqual(
    cleanMissedWords(missPassage, ['The', 'Gulls,', 'zebra', '']),
    ['the', 'gulls']);
  // A word kept no more times than it appears in the passage.
  assert.deepStrictEqual(cleanMissedWords(missPassage, ['the', 'the', 'the']), ['the']);
  assert.deepStrictEqual(
    cleanMissedWords(missPassage, ['the', 'little', 'boat', 'gulls', 'circled', 'the']),
    ['the', 'little', 'boat', 'gulls', 'circled']);
  // Inner dots survive, so a code name stays one whole word; 'price' alone
  // is not a word of the passage, and the name appears only once in it.
  const code = 'For each item in cart, add item.price to the total.';
  assert.deepStrictEqual(
    cleanMissedWords(code, ['item.price', 'ITEM.PRICE.', 'price']),
    ['item.price']);
});

test('cleanMissedWords returns null for a non-array and [] for an empty list', () => {
  assert.strictEqual(cleanMissedWords(missPassage, 'nope'), null);
  assert.strictEqual(cleanMissedWords(missPassage, null), null);
  assert.deepStrictEqual(cleanMissedWords(missPassage, []), []);
});