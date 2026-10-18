const { test } = require('node:test');
const assert = require('node:assert');
const { resumeCommitted } = require('../public/typing');

const passage = 'The little red boat drifted past the lighthouse as the sun went down.';
// Word starts: 'The' at 0, 'little' at 4, 'red' at 11, 'boat' at 15.

test('resume snaps a mid-word position back to the word start', () => {
  assert.strictEqual(resumeCommitted(passage, 13), 11); // mid 'red'
  assert.strictEqual(resumeCommitted(passage, 12), 11);
  assert.strictEqual(resumeCommitted(passage, 16), 15); // mid 'boat'
  assert.strictEqual(resumeCommitted(passage, 14), 11); // 'red' typed, space not yet
});

test('resume keeps a word boundary where it is', () => {
  assert.strictEqual(resumeCommitted(passage, 11), 11); // start of 'red'
  assert.strictEqual(resumeCommitted(passage, 15), 15); // 'red ' typed
});

test('resume with zero, before any space, or past the end', () => {
  assert.strictEqual(resumeCommitted(passage, 0), 0);
  assert.strictEqual(resumeCommitted(passage, 3), 0); // 'The' typed, no space yet
  assert.strictEqual(resumeCommitted(passage, -4), 0);
  // Clamped to the passage: past the end snaps to the last word's start.
  assert.strictEqual(resumeCommitted(passage, 999), 64);
  assert.strictEqual(resumeCommitted(passage, null), 0);
});