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

// Rebuild each racer's position from the append-only race_events log, so a
// reconnecting client (or a replay) sees positions that do not depend on the
// last POST that happened to land. `entries` are race_entries rows, `events`
// rows shaped like { racer_id, seq, chars_typed, ts }, `total` the passage
// length. For each entry whose user_id has events, progress is the maximum
// chars_typed and finished_at the ts of the lowest-seq event that reached
// total; entries with no events (demo bots, seeded history) keep their stored
// values. Never mutates the inputs.
function foldEvents(entries, events, total) {
  const byRacer = new Map();
  for (const ev of events || []) {
    const list = byRacer.get(ev.racer_id);
    if (list) list.push(ev);
    else byRacer.set(ev.racer_id, [ev]);
  }
  for (const list of byRacer.values()) list.sort((a, b) => a.seq - b.seq);
  return entries.map((e) => {
    const evs = e.user_id != null ? byRacer.get(e.user_id) : null;
    if (!evs || !evs.length) return e;
    let progress = 0;
    let finished_at = null;
    for (const ev of evs) {
      if (ev.chars_typed > progress) progress = ev.chars_typed;
      if (finished_at == null && total != null && ev.chars_typed >= total) finished_at = ev.ts;
    }
    return Object.assign({}, e, { progress, finished_at });
  });
}

// The most progress any client could honestly report since the race began:
// 25 characters per second is 300 wpm, far past any real typist.
function maxPlausibleProgress(elapsedMs) {
  if (!(elapsedMs > 0)) return 0;
  return Math.ceil((elapsedMs / 1000) * 25);
}

module.exports = { wpm, accuracy, placeEntries, settleDue, maxPlausibleProgress, foldEvents };