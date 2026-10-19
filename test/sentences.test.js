const { test } = require('node:test');
const assert = require('node:assert');
const { SENTENCES, pickText, POOLS, LANGUAGES, CATEGORIES, pickPassage } = require('../lib/sentences');

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

test('every pool has at least 12 phone-keyboard-safe sentences', () => {
  for (const language of LANGUAGES) {
    for (const category of CATEGORIES) {
      const pool = POOLS[language][category];
      assert.ok(pool.length >= 12, language + '/' + category + ' has ' + pool.length);
      for (const s of pool) {
        assert.match(s, /^[A-Za-z ,.]+$/, 'unexpected characters in: ' + s);
        assert.ok(!s.includes('  '), 'double space in: ' + s);
        assert.strictEqual(s.endsWith('.'), true, 'no full stop: ' + s);
        assert.match(s, /^[A-Z]/, 'no capital start: ' + s);
        assert.ok(s.length >= 40 && s.length <= 80, 'length ' + s.length + ' out of range: ' + s);
        // Inner dots sit between letters only (item.price), so the
        // two-sentence split keeps working.
        const body = s.slice(0, -1);
        assert.ok(!/[^A-Za-z]\./.test(body) && !/\.[^A-Za-z]/.test(body), 'stray inner dot in: ' + s);
      }
    }
  }
});

test('pickPassage returns two distinct sentences of the chosen pool', () => {
  let n = 0;
  const rand = () => [0, 0.2][n++ % 2];
  for (const language of LANGUAGES) {
    for (const category of CATEGORIES) {
      const picked = pickPassage({ language, category }, rand);
      assert.strictEqual(picked.language, language);
      assert.strictEqual(picked.category, category);
      const sentences = picked.passage.split(/(?<=\.) (?=[A-Z])/);
      assert.strictEqual(sentences.length, 2, 'not two sentences: ' + picked.passage);
      assert.notStrictEqual(sentences[0], sentences[1]);
      const pool = POOLS[language][category];
      assert.ok(pool.includes(sentences[0]) && pool.includes(sentences[1]));
      assert.ok(!picked.passage.includes('  '));
    }
  }
});

test("'any', unknown and missing choices resolve to a valid pool", () => {
  let n = 0;
  const rand = () => [0, 0.5][n++ % 2];
  for (const choice of [{ language: 'any', category: 'any' }, { language: 'xx', category: 'zz' }, {}]) {
    const picked = pickPassage(choice, rand);
    assert.ok(LANGUAGES.includes(picked.language), JSON.stringify(picked));
    assert.ok(CATEGORIES.includes(picked.category));
    assert.ok(typeof picked.passage === 'string' && picked.passage.includes(' '));
  }
});