// Word-mode typing matcher, shared by the page (public/app.js) and the
// tests. Pure: given the passage, how much of it is already committed and
// the current contents of the field, it says what is right, what is wrong,
// and whether the current word is finished.
//
// The typing field always holds the current word: the car advances through
// the passage word by word, and the field clears when a word and its space
// are typed correctly (the last word needs no space). Exposed as
// window.Typing in the browser and module.exports under Node.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Typing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function typingState(passage, committed, input) {
    const rest = String(passage).slice(committed);
    const typed = String(input == null ? '' : input);

    let correct = 0;
    const max = Math.min(typed.length, rest.length);
    while (correct < max && typed[correct] === rest[correct]) correct++;

    // Everything from the first mismatch on is wrong, including extra
    // characters typed past the end of the remaining passage.
    const wrongStart = correct;
    const wrongEnd = typed.length;
    const wrong = wrongStart < wrongEnd ? { start: wrongStart, end: wrongEnd } : null;

    // The word is complete when everything typed so far is correct and it
    // ends at a committed boundary: the word plus its space, or the whole
    // last word with the passage exactly used up.
    const endsAtBoundary =
      (typed.length > 0 && typed[typed.length - 1] === ' ') ||
      committed + typed.length === passage.length;
    const wordComplete = wrong === null && typed.length > 0 && endsAtBoundary;

    const done = wrong === null && committed + typed.length === passage.length;

    return { correct, wrong, wordComplete, done };
  }

  // The passage word that contains character `index` (words split on
  // spaces): the word the racer is typing right now, used to record which
  // words get mistyped.
  function wordAt(passage, index) {
    const s = String(passage);
    if (!(index >= 0) || index >= s.length) return '';
    let start = index;
    while (start > 0 && s[start - 1] !== ' ') start--;
    let end = index;
    while (end < s.length && s[end] !== ' ') end++;
    return s.slice(start, end);
  }

  // A word as it is counted in the missed-words stats: lowercased, with
  // trailing commas and full stops stripped. Inner dots survive, so a code
  // name like item.price stays one whole word.
  function normalizeWord(w) {
    return String(w == null ? '' : w).toLowerCase().replace(/[,.]+$/, '');
  }

  return { typingState, wordAt, normalizeWord };
});