// Pure scoring and settling helpers, shared by the server routes and the
// unit tests. No database, no clock: time goes in, numbers come out.

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

// The stamp a client puts on a progress post: the running `seq` for the race
// and the stable `clientId` of the device that sent it. Anything malformed
// is nulled, which the server treats as an unstamped post and applies as
// today. A seq fits an int column and starts at 1; a clientId is short
// hex-ish text.
const CLIENT_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function progressStamp(body) {
  const b = body || {};
  const n = typeof b.seq === 'string' && /^-?\d+$/.test(b.seq) ? Number(b.seq) : b.seq;
  const seq = Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
  const clientId = typeof b.clientId === 'string' && CLIENT_ID_RE.test(b.clientId)
    ? b.clientId
    : null;
  return { seq, clientId };
}

module.exports = { wpm, accuracy, placeEntries, settleDue, maxPlausibleProgress, progressStamp };