// Pure scoring and settling helpers, shared by the server routes and the
// unit tests. No database, no clock: time goes in, numbers come out.

// Word normalization lives with the typing matcher, which the page and the
// tests also load directly.
const { normalizeWord } = require('../public/typing');

// Standard typing-test words per minute: five characters per word.
function wpm(chars, ms) {
  if (!(ms > 0) || !(chars > 0)) return 0;
  return Math.round(chars / 5 / (ms / 60000));
}

// Share of keystrokes that were right when typed, as a whole percent.
// 100 when nothing was typed at all.
function accuracy(correct, total) {
  if (!total) return 100;
  return Math.round((correct / total) * 100);
}

// Entries in final place order: finishers first by finishing time, then
// everyone else by how far they got, ties broken by lane.
function placeEntries(entries) {
  const finished = entries
    .filter((e) => e.finished_at != null)
    .sort((a, b) =>
      a.finished_at < b.finished_at ? -1 : a.finished_at > b.finished_at ? 1 : a.lane - b.lane
    );
  const unfinished = entries
    .filter((e) => e.finished_at == null)
    .sort((a, b) => b.progress - a.progress || a.lane - b.lane);
  return finished.concat(unfinished);
}

// Settle conditions for a running race, evaluated against a Date `now`:
// everyone finished, 30 s after the first finish, or 3 minutes after start.
function settleDue(race, entries, now) {
  if (!entries.length) return true;
  const startMs = race.starts_at ? new Date(race.starts_at).getTime() : null;
  if (startMs != null && now.getTime() - startMs >= 180000) return true;
  const unfinished = entries.filter((e) => e.finished_at == null);
  if (!unfinished.length) return true;
  if (race.first_finish_at) {
    if (now.getTime() - new Date(race.first_finish_at).getTime() >= 30000) return true;
  }
  return false;
}

// The most progress any client could honestly report since the race began:
// 25 characters per second is 300 wpm, far past any real typist.
function maxPlausibleProgress(elapsedMs) {
  if (!(elapsedMs > 0)) return 0;
  return Math.ceil((elapsedMs / 1000) * 25);
}

// The viewer's claimed missed words, checked against the race's own passage:
// a forged list cannot inject text that was never on the screen. A word
// counts only when, normalized, it is a word of the passage; it is kept no
// more times than it appears there, and the whole list is capped at the
// passage's word count. A non-array is null, meaning "nothing claimed".
function cleanMissedWords(passage, list) {
  if (!Array.isArray(list)) return null;
  const inPassage = {};
  let wordCount = 0;
  for (const w of String(passage || '').split(' ')) {
    const k = normalizeWord(w);
    if (!k) continue;
    inPassage[k] = (inPassage[k] || 0) + 1;
    wordCount++;
  }
  const kept = {};
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const k = normalizeWord(raw);
    if (!k || !inPassage[k]) continue;
    if ((kept[k] || 0) >= inPassage[k]) continue;
    if (out.length >= wordCount) break;
    kept[k] = (kept[k] || 0) + 1;
    out.push(k);
  }
  return out;
}

module.exports = { wpm, accuracy, placeEntries, settleDue, maxPlausibleProgress, cleanMissedWords };