const { test } = require('node:test');
const assert = require('node:assert');
const { typingState, wordAt, normalizeWord } = require('../public/typing');

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

test('wordAt returns the word that contains the index', () => {
  const p = 'The little boat. Gulls circled.';
  assert.strictEqual(wordAt(p, 0), 'The');
  assert.strictEqual(wordAt(p, 3), 'The'); // the space itself closes the word
  assert.strictEqual(wordAt(p, 5), 'little');
  assert.strictEqual(wordAt(p, 9), 'little');
  assert.strictEqual(wordAt(p, 13), 'boat.');
  assert.strictEqual(wordAt(p, 18), 'Gulls');
  assert.strictEqual(wordAt(p, 24), 'circled.');
  assert.strictEqual(wordAt(p, 30), 'circled.');
  assert.strictEqual(wordAt(p, 31), '');
  assert.strictEqual(wordAt(p, -1), '');
  assert.strictEqual(wordAt('For each item in cart, add item.price to the total.', 31), 'item.price');
});

test('normalizeWord lowercases and strips trailing punctuation, not inner dots', () => {
  assert.strictEqual(normalizeWord('The'), 'the');
  assert.strictEqual(normalizeWord('cart,'), 'cart');
  assert.strictEqual(normalizeWord('total.'), 'total');
  assert.strictEqual(normalizeWord('GULLS,.'), 'gulls');
  assert.strictEqual(normalizeWord('item.price'), 'item.price');
  assert.strictEqual(normalizeWord(''), '');
});