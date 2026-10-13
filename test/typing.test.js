const { test } = require('node:test');
const assert = require('node:assert');
const { typingState, stripParts, dialAngle, raceClock } = require('../public/typing');

const passage = 'The little boat. Gulls circled.';

test('a correct prefix reads as correct', () => {
  const st = typingState(passage, 0, 'The litt');
  assert.strictEqual(st.correct, 8);
  assert.strictEqual(st.wrong, null);
  assert.strictEqual(st.wordComplete, false);
  assert.strictEqual(st.done, false);
});

test('a typo after a correct prefix marks the rest wrong', () => {
  const st = typingState(passage, 0, 'The littel');
  assert.strictEqual(st.correct, 8); // 'The litt' is right, 'el' is not
  assert.deepStrictEqual(st.wrong, { start: 8, end: 10 });
  assert.strictEqual(st.wordComplete, false);
});

test('the word completes on its space and the field can clear', () => {
  const st = typingState(passage, 0, 'The ');
  assert.strictEqual(st.correct, 4);
  assert.strictEqual(st.wordComplete, true);
  assert.strictEqual(st.done, false);
});

test('a word without its trailing space is not complete', () => {
  const st = typingState(passage, 0, 'The');
  assert.strictEqual(st.correct, 3);
  assert.strictEqual(st.wordComplete, false);
});

test('the last word completes with no space', () => {
  const committed = passage.indexOf('circled'); // start of the last word
  const st = typingState(passage, committed, 'circled.');
  assert.strictEqual(st.correct, 8);
  assert.strictEqual(st.wordComplete, true);
  assert.strictEqual(st.done, true);
});

test('backspacing out of an error clears it', () => {
  const bad = typingState(passage, 0, 'The littel');
  assert.notStrictEqual(bad.wrong, null);
  const fixed = typingState(passage, 0, 'The litt');
  assert.strictEqual(fixed.wrong, null);
});

test('characters past the end of the passage are wrong', () => {
  const committed = passage.indexOf('circled');
  const st = typingState(passage, committed, 'circled.x');
  assert.deepStrictEqual(st.wrong, { start: 8, end: 9 });
  assert.strictEqual(st.done, false);
});

test('empty input is neither right nor wrong', () => {
  const st = typingState(passage, 0, '');
  assert.strictEqual(st.correct, 0);
  assert.strictEqual(st.wrong, null);
  assert.strictEqual(st.wordComplete, false);
});

// ── stripParts ────────────────────────────────────────────────────────────

test('stripParts with no mistake leaves bad empty', () => {
  const parts = stripParts(passage, 0, 'The litt');
  assert.strictEqual(parts.ok, 'The litt');
  assert.strictEqual(parts.bad, '');
  assert.strictEqual(parts.rest, 'le boat. Gulls circled.');
  assert.strictEqual(parts.at, 8);
  assert.strictEqual(parts.ok + parts.bad + parts.rest, passage);
});

test('stripParts with a typo marks just the wrong slice once', () => {
  const parts = stripParts(passage, 0, 'The littel');
  assert.strictEqual(parts.ok, 'The litt');
  assert.strictEqual(parts.bad, 'le');
  assert.strictEqual(parts.rest, ' boat. Gulls circled.');
  assert.strictEqual(parts.at, 8);
  assert.strictEqual(parts.ok + parts.bad + parts.rest, passage);
});

test('stripParts counts committed words toward at', () => {
  const committed = passage.indexOf('Gulls');
  const parts = stripParts(passage, committed, 'Gull');
  assert.strictEqual(parts.ok, 'The little boat. Gull');
  assert.strictEqual(parts.bad, '');
  assert.strictEqual(parts.rest, 's circled.');
  assert.strictEqual(parts.at, committed + 4);
});

test('stripParts clips extra characters past the end of the passage', () => {
  const committed = passage.indexOf('circled');
  const parts = stripParts(passage, committed, 'circled.xyz');
  assert.strictEqual(parts.ok, passage);
  assert.strictEqual(parts.bad, '');
  assert.strictEqual(parts.rest, '');
  assert.strictEqual(parts.at, passage.length);
});

// ── dialAngle ─────────────────────────────────────────────────────────────

test('dialAngle maps 0 wpm to 150 degrees', () => {
  assert.strictEqual(dialAngle(0), 150);
});

test('dialAngle maps 50 wpm to 270 degrees', () => {
  assert.strictEqual(dialAngle(50), 270);
});

test('dialAngle maps 100 wpm to 390 degrees', () => {
  assert.strictEqual(dialAngle(100), 390);
});

test('dialAngle stops at 390 above 100 wpm', () => {
  assert.strictEqual(dialAngle(150), 390);
});

test('dialAngle treats negative and non-numeric speeds as 0', () => {
  assert.strictEqual(dialAngle(-10), 150);
  assert.strictEqual(dialAngle(NaN), 150);
});

// ── raceClock ─────────────────────────────────────────────────────────────

test('raceClock formats a time to the tenth', () => {
  assert.strictEqual(raceClock(10200), '0:10.2');
});

test('raceClock floors and carries minutes and seconds', () => {
  assert.strictEqual(raceClock(179999), '2:59.9');
  assert.strictEqual(raceClock(60000), '1:00.0');
});

test('raceClock never reads a negative time', () => {
  assert.strictEqual(raceClock(-5), '0:00.0');
});