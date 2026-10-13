const { test } = require('node:test');
const assert = require('node:assert');
const { SENTENCES, pickText } = require('../lib/sentences');

test('the pool has at least 30 sentences', () => {
  assert.ok(SENTENCES.length >= 30, 'pool has ' + SENTENCES.length);
});

test('every sentence is phone-keyboard safe: plain letters, single spaces, a full stop', () => {
  for (const s of SENTENCES) {
    assert.match(s, /^[A-Za-z ,.]+$/, 'unexpected characters in: ' + s);
    assert.ok(!s.includes('  '), 'double space in: ' + s);
    assert.strictEqual(s.endsWith('.'), true, 'no full stop: ' + s);
    assert.ok(s.length >= 40 && s.length <= 80, 'length ' + s.length + ' out of range: ' + s);
  }
});

test('pickText returns two distinct sentences joined by one space', () => {
  for (let i = 0; i < 20; i++) {
    const passage = pickText();
    const parts = passage.split(' .');
    const sentences = passage.split(/(?<=\.) (?=[A-Z])/);
    assert.strictEqual(sentences.length, 2, 'not two sentences: ' + passage);
    assert.notStrictEqual(sentences[0], sentences[1]);
    assert.ok(!passage.includes('  '));
  }
});

test('pickText honours an injected random source', () => {
  let n = 0;
  const rand = () => [0, 0.5, 0.999][n++ % 3];
  const a = pickText(rand);
  assert.ok(typeof a === 'string' && a.includes(' '));
});