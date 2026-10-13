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

  // The passage strip's three pieces, each passage character appearing
  // exactly once: the typed-right prefix, the wrong slice (empty with no
  // mistake) and the remainder. `at` is how far into the passage you are,
  // counting committed words plus the correct part of the current word.
  function stripParts(passage, committed, input) {
    const st = typingState(passage, committed, input);
    const len = String(passage).length;
    const at = Math.min(len, committed + st.correct);
    const ok = String(passage).slice(0, at);
    const bad = st.wrong
      ? String(passage).slice(at, Math.min(len, at + (st.wrong.end - st.wrong.start)))
      : '';
    const rest = String(passage).slice(at + bad.length);
    return { ok, bad, rest, at };
  }

  // The speedometer needle's angle, SVG clockwise from +x: 150° at 0, 270°
  // at 50, 390° at 100 wpm and above. The dial reads 0 to 10, times ten.
  function dialAngle(wpm) {
    const n = Number(wpm);
    if (!isFinite(n)) return 150;
    return 150 + 24 * Math.max(0, Math.min(10, n / 10));
  }

  // A race clock: "m:ss.t", floored to tenths, never negative.
  function raceClock(ms) {
    const n = isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
    const tenths = Math.floor(n / 100);
    const s = Math.floor(tenths / 10);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + '.' + (tenths % 10);
  }

  return { typingState, stripParts, dialAngle, raceClock };
});