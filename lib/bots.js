// Pure helpers for Lawan Bot racers and ghosts: the three speed levels, the
// made-up animal names, and the timeline maths a ghost replays. No database,
// no clock: numbers in, numbers out.

// The three Lawan Bot levels. wpms/accs give the three bots' steady speeds
// (a little apart) and their accuracies, fastest bot first.
const BOT_LEVELS = {
  santai: { label: 'Santai', aboutWpm: 30, wpms: [26, 30, 34], accs: [92, 93, 95] },
  sedang: { label: 'Sedang', aboutWpm: 50, wpms: [45, 50, 55], accs: [94, 95, 96] },
  ngebut: { label: 'Ngebut', aboutWpm: 80, wpms: [72, 80, 88], accs: [96, 97, 98] },
};

// Made-up racers, the demo's animals without the demo- prefix.
const BOT_NAMES = ['Kestrel', 'Otter', 'Fennec', 'Lynx', 'Heron', 'Badger', 'Moth', 'Ibex'];

// Three bots for a race: distinct names, the level's speeds and accuracies.
function pickBots(level, rand = Math.random) {
  const lvl = BOT_LEVELS[level];
  if (!lvl) return [];
  const names = BOT_NAMES.slice();
  const bots = [];
  for (let i = 0; i < 3; i++) {
    const idx = Math.min(names.length - 1, Math.floor(rand() * names.length));
    bots.push({ name: names.splice(idx, 1)[0], wpm: lvl.wpms[i], acc: lvl.accs[i] });
  }
  return bots;
}

// Clean a recorded timeline ([elapsedMs, progress] pairs) for replay: only
// points that rise in both time and progress, progress clamped to the
// passage length, and a final [finishMs, len] point when the source run
// finished short of a sample at the end. null when nothing usable is left,
// which becomes the steady-wpm fallback.
function ghostTimeline(points, finishMs, len) {
  if (!Array.isArray(points) || !(len > 0)) return null;
  const kept = [];
  let lastMs = -Infinity;
  let lastProg = -Infinity;
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const ms = Number(p[0]);
    const prog = Number(p[1]);
    if (!Number.isFinite(ms) || !Number.isFinite(prog)) continue;
    if (ms < 0 || prog < 0 || ms <= lastMs || prog <= lastProg) continue;
    kept.push([Math.round(ms), Math.min(len, Math.round(prog))]);
    lastMs = ms;
    lastProg = prog;
  }
  if (!kept.length) return null;
  const last = kept[kept.length - 1];
  if (finishMs != null && Number.isFinite(finishMs) && last[1] < len && finishMs > last[0]) {
    kept.push([Math.round(finishMs), len]);
  }
  return kept;
}

// Where a ghost replaying `points` is after `elapsedMs` of a passage of
// `len` characters: linear interpolation between samples, 0 before the
// first one, floored and clamped to len. finishMs is the elapsed time of the
// first sample at len, or null while the ghost has no sample there.
function ghostProgress(points, elapsedMs, len) {
  if (!Array.isArray(points) || !points.length) return null;
  const pts = points.filter((p) => Array.isArray(p) && p.length >= 2
    && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
  if (!pts.length) return null;
  let finishMs = null;
  for (const p of pts) {
    if (Number(p[1]) >= len) { finishMs = Number(p[0]); break; }
  }
  const first = pts[0];
  if (elapsedMs <= Number(first[0])) return { progress: 0, finishMs };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = Number(pts[i][0]);
    const b = Number(pts[i + 1][0]);
    if (elapsedMs <= b) {
      const t = (elapsedMs - a) / (b - a);
      const prog = Math.floor(Number(pts[i][1]) + t * (Number(pts[i + 1][1]) - Number(pts[i][1])));
      return { progress: Math.min(len, Math.max(0, prog)), finishMs };
    }
  }
  const last = pts[pts.length - 1];
  return { progress: Math.min(len, Math.max(0, Math.floor(Number(last[1])))), finishMs };
}

module.exports = { BOT_LEVELS, BOT_NAMES, pickBots, ghostTimeline, ghostProgress };