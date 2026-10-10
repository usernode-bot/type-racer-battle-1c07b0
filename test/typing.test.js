const { test } = require('node:test');
const assert = require('node:assert');
const { typingState } = require('../public/typing');

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