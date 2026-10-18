const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { pickText, pickPassage } = require('./lib/sentences');
const { wpm, accuracy, placeEntries, settleDue, maxPlausibleProgress, cleanMissedWords } = require('./lib/scoring');
const { normalizeWord } = require('./public/typing');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// ── Race state ──────────────────────────────────────────────────────────────
//
// Races live in two tables. `races` holds the race itself (its kind, status,
// passage and clock); `race_entries` holds one row per racer, in `lane` order
// (0 to 19). Every query is scoped by `demo_owner`: NULL for the real race
// everyone shares, the viewer's id for the staging demo (which must never
// mix with real rows). All server time decisions use `req.now`, passed to the
// database as a parameter — never SQL NOW().

const MAX_RACERS = 20;
const LOBBY_STALE_MS = 30000; // a lobby entry nobody has refreshed drops after this
const CLOSE_AFTER_WIN_MS = 30000; // race closes 30 s after the first finish
const MAX_RACE_MS = 180000; // and 3 minutes after the start, whichever first

// The staging demo: only on staging, only with ?demo=1, only signed in.
function demoOwner(req) {
  return IS_STAGING && req.query.demo === '1' && req.user ? String(req.user.id) : null;
}

// SQL predicate that scopes every race query to the viewer's world.
function ownerClause(demo, startIndex) {
  return demo == null
    ? { sql: 'demo_owner IS NULL', values: [] }
    : { sql: 'demo_owner = $' + startIndex, values: [demo] };
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS races (
      id bigserial PRIMARY KEY,
      kind text NOT NULL,               -- 'race' or 'practice'
      status text NOT NULL,             -- 'lobby', 'running', 'finished'
      passage text,
      starts_at timestamptz,
      first_finish_at timestamptz,
      finished_at timestamptz,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      demo_owner text,
      demo_key text
    )`);
  // Text choice for a race (the resolved pick, never 'any'); null for races
  // started before the choice existed. Append-only columns, both nullable.
  await pool.query('ALTER TABLE races ADD COLUMN IF NOT EXISTS language text');
  await pool.query('ALTER TABLE races ADD COLUMN IF NOT EXISTS category text');
  // One open lobby for the real app, and one per demo viewer on staging.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS races_one_lobby
    ON races ((COALESCE(demo_owner, ''))) WHERE status = 'lobby'`);
  // Idempotent demo history rows (demo_key 'history-1' …).
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS races_demo_history
    ON races (demo_owner, demo_key) WHERE demo_key IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS race_entries (
      race_id bigint NOT NULL REFERENCES races(id),
      lane smallint NOT NULL,
      user_id text,
      username text NOT NULL,
      joined_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL,
      progress int NOT NULL DEFAULT 0,
      keystrokes int NOT NULL DEFAULT 0,
      correct_keys int NOT NULL DEFAULT 0,
      finished_at timestamptz,
      place smallint,
      wpm int,
      accuracy smallint,
      bot_wpm smallint,
      bot_accuracy smallint,
      PRIMARY KEY (race_id, lane)
    )`);
  // A racer appears once per race; demo bots (null user_id) are exempt.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS race_entries_user
    ON race_entries (race_id, user_id) WHERE user_id IS NOT NULL`);
  // Normalized words a racer mistyped, one item per missed occurrence.
  await pool.query('ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS missed_words text[]');
}

// Deterministic randomness for the demo seed, so a preview reload always
// shows the same made-up passages.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Settling ────────────────────────────────────────────────────────────────
//
// settleRace closes a running race whose deadline has passed (see
// settleDue in lib/scoring.js), assigns places, and computes each racer's
// wpm and accuracy. Every read and write that touches a race runs it first,
// so a race closes on time even if nobody is watching.

async function settleRace(race, now) {
  const { rows: entries } = await pool.query(
    'SELECT * FROM race_entries WHERE race_id = $1', [race.id]);
  if (race.status !== 'running' || !settleDue(race, entries, now)) return false;

  const startMs = race.starts_at ? new Date(race.starts_at).getTime() : null;
  const len = race.passage ? race.passage.length : 0;
  const ordered = placeEntries(entries);
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    let speed;
    if (e.finished_at != null && startMs != null) {
      speed = wpm(len, new Date(e.finished_at).getTime() - startMs);
    } else {
      // Out of time: speed over however long the race actually stayed open.
      let closeMs = now.getTime();
      if (race.first_finish_at) {
        closeMs = Math.min(closeMs, new Date(race.first_finish_at).getTime() + CLOSE_AFTER_WIN_MS);
      }
      if (startMs != null) closeMs = Math.min(closeMs, startMs + MAX_RACE_MS);
      speed = wpm(e.progress, Math.max(1, closeMs - (startMs || now.getTime())));
    }
    const acc = e.bot_accuracy != null ? e.bot_accuracy : accuracy(e.correct_keys, e.keystrokes);
    await pool.query(
      'UPDATE race_entries SET place = $1, wpm = $2, accuracy = $3 WHERE race_id = $4 AND lane = $5',
      [i + 1, speed, acc, race.id, e.lane]);
  }
  await pool.query(
    "UPDATE races SET status = 'finished', finished_at = COALESCE(finished_at, $1) WHERE id = $2 AND status = 'running'",
    [now, race.id]);
  return true;
}

// Advance the made-up racers of a demo race on each read. Their progress is
// their steady wpm over the time since the start; a bot that reaches the
// end gets a finished_at at the exact moment its speed implies.
async function updateBots(race, now) {
  if (race.status !== 'running' || !race.starts_at || !race.passage) return;
  const startMs = new Date(race.starts_at).getTime();
  const elapsedMs = now.getTime() - startMs;
  if (elapsedMs <= 0) return;
  const len = race.passage.length;
  const { rows: bots } = await pool.query(
    'SELECT lane, bot_wpm, bot_accuracy, finished_at FROM race_entries WHERE race_id = $1 AND user_id IS NULL AND bot_wpm IS NOT NULL',
    [race.id]);
  for (const b of bots) {
    if (b.finished_at) continue;
    const charsPerMs = (b.bot_wpm * 5) / 60000;
    const progress = Math.min(len, Math.floor(charsPerMs * elapsedMs));
    const finishMs = len / charsPerMs;
    const finishedAt = progress >= len
      ? new Date(Math.min(startMs + finishMs, now.getTime()))
      : null;
    await pool.query(
      `UPDATE race_entries SET progress = $1, finished_at = $2,
         keystrokes = GREATEST(keystrokes, $3), correct_keys = GREATEST(correct_keys, $4)
       WHERE race_id = $5 AND lane = $6`,
      [progress, finishedAt,
        Math.ceil(progress * 100 / Math.max(1, b.bot_accuracy)),
        progress, race.id, b.lane]);
    if (finishedAt) {
      await pool.query(
        'UPDATE races SET first_finish_at = COALESCE(first_finish_at, $1) WHERE id = $2',
        [finishedAt, race.id]);
    }
  }
}

// Drop lobby entries the racer has stopped refreshing. Made-up demo racers
// (null user_id) never go stale.
async function pruneStaleLobbyEntries(demo, now) {
  await pool.query(
    `DELETE FROM race_entries e USING races r
     WHERE e.race_id = r.id AND r.status = 'lobby' AND e.user_id IS NOT NULL
       AND e.last_seen_at < $1 AND ${demo == null ? 'r.demo_owner IS NULL' : 'r.demo_owner = $2'}`,
    demo == null ? [new Date(now.getTime() - LOBBY_STALE_MS)] : [new Date(now.getTime() - LOBBY_STALE_MS), demo]);
}

// ── Race responses ──────────────────────────────────────────────────────────

function closesAt(race) {
  if (race.status !== 'running' || !race.starts_at) return null;
  let close = new Date(race.starts_at).getTime() + MAX_RACE_MS;
  if (race.first_finish_at) {
    close = Math.min(close, new Date(race.first_finish_at).getTime() + CLOSE_AFTER_WIN_MS);
  }
  return new Date(close).toISOString();
}

function entryView(e, viewerId, race, settled) {
  const startMs = race.starts_at ? new Date(race.starts_at).getTime() : null;
  return {
    username: e.username,
    lane: e.lane,
    isYou: viewerId != null && e.user_id === String(viewerId),
    progress: e.progress,
    finished: e.finished_at != null,
    finishedMs: e.finished_at && startMs != null ? new Date(e.finished_at).getTime() - startMs : null,
    place: settled || e.place != null ? e.place : null,
    wpm: e.wpm,
    accuracy: e.accuracy,
    outOfTime: settled ? e.finished_at == null : null,
  };
}

async function raceResponse(req, raceId, demo) {
  const owner = ownerClause(demo, 2);
  const { rows } = await pool.query(
    `SELECT * FROM races WHERE id = $1 AND ${owner.sql}`, [raceId, ...owner.values]);
  const race = rows[0];
  if (!race) return null;
  const viewerId = req.user ? req.user.id : null;

  if (race.status === 'lobby') {
    // Keep the viewer's presence fresh while they wait in the lobby.
    if (viewerId != null) {
      await pool.query(
        `UPDATE race_entries SET last_seen_at = $1
         WHERE race_id = $2 AND user_id = $3 AND (SELECT status FROM races WHERE id = $2) = 'lobby'`,
        [req.now, race.id, String(viewerId)]);
    }
  } else if (demo != null) {
    await updateBots(race, req.now);
    const { rows: fresh } = await pool.query('SELECT * FROM races WHERE id = $1', [race.id]);
    Object.assign(race, fresh[0]);
    await settleRace(race, req.now);
  } else {
    await settleRace(race, req.now);
  }

  const settled = race.status === 'finished';
  const { rows: entries } = await pool.query(
    'SELECT * FROM race_entries WHERE race_id = $1 ORDER BY lane', [race.id]);
  const sharePassage = race.status !== 'lobby';
  return {
    id: race.id,
    kind: race.kind,
    status: race.status,
    startsAt: race.starts_at ? new Date(race.starts_at).toISOString() : null,
    closesAt: closesAt(race),
    language: race.language,
    category: race.category,
    total: sharePassage && race.passage ? race.passage.length : null,
    passage: sharePassage ? race.passage : null,
    entries: entries.map((e) => entryView(e, viewerId, race, settled)),
  };
}

// ── The staging demo ────────────────────────────────────────────────────────
//
// On staging, with ?demo=1, the viewer's own world is seeded on first view:
// eight finished races of their own (a mix of wins, middling places and
// practice runs) and an open demo lobby with four made-up racers already on
// the grid. Demo rows carry this viewer's id in `demo_owner`, so they never
// reach the real lobby, real stats or anyone else's preview.

const DEMO_BOTS = [
  { name: 'demo-kestrel', wpm: 70, acc: 98 },
  { name: 'demo-otter', wpm: 55, acc: 96 },
  { name: 'demo-fennec', wpm: 48, acc: 94 },
  { name: 'demo-lynx', wpm: 38, acc: 93 },
];

// The viewer's eight made-up past races: place, field size, kind, speed,
// accuracy and how long ago it finished (hours before now).
const DEMO_HISTORY = [
  { place: 1, size: 5, kind: 'race', wpm: 84, acc: 98, hoursAgo: 2 },
  { place: null, size: 1, kind: 'practice', wpm: 79, acc: 96, hoursAgo: 3 },
  { place: 2, size: 6, kind: 'race', wpm: 76, acc: 95, hoursAgo: 30 },
  { place: 1, size: 3, kind: 'race', wpm: 81, acc: 97, hoursAgo: 31 },
  { place: 4, size: 8, kind: 'race', wpm: 68, acc: 92, hoursAgo: 124 },
  { place: null, size: 1, kind: 'practice', wpm: 72, acc: 94, hoursAgo: 125 },
  { place: 3, size: 4, kind: 'race', wpm: 70, acc: 96, hoursAgo: 145 },
  { place: 1, size: 2, kind: 'race', wpm: 74, acc: 99, hoursAgo: 146 },
];

// One or two of a passage's own words, as the demo viewer's missed words.
function demoMissedWords(passage, rand) {
  const words = String(passage || '').split(' ').map(normalizeWord).filter(Boolean);
  if (!words.length) return [];
  const n = 1 + Math.floor(rand() * 2);
  const out = [];
  for (let i = 0; i < n; i++) out.push(words[Math.floor(rand() * words.length)]);
  return out;
}

// Fill a finished demo race with the viewer and enough made-up racers to
// make up the field, each placed behind the viewer's mock place.
async function seedDemoHistory(req, demo) {
  const rand = mulberry32(42);
  for (let i = 0; i < DEMO_HISTORY.length; i++) {
    const h = DEMO_HISTORY[i];
    const key = 'history-' + (i + 1);
    const finishedAt = new Date(req.now.getTime() - h.hoursAgo * 3600000);
    const startsAt = new Date(finishedAt.getTime() - Math.round(25000 + rand() * 20000));
    const choice = pickPassage(rand() < 0.5 ? { language: 'id' } : {}, rand);
    const passage = choice.passage;
    const ins = await pool.query(
      `INSERT INTO races (kind, status, passage, starts_at, first_finish_at, finished_at, created_at, created_by, demo_owner, demo_key, language, category)
       VALUES ($1, 'finished', $2, $3, $4, $5, $3, $6, $7, $8, $9, $10)
       ON CONFLICT (demo_owner, demo_key) WHERE demo_key IS NOT NULL DO NOTHING RETURNING id`,
      [h.kind, passage, startsAt, h.kind === 'race' ? finishedAt : null, finishedAt,
        req.user.username, demo, key, choice.language, choice.category]);
    if (!ins.rows.length) {
      // A row seeded by an earlier build of the app: backfill its viewer
      // entry's missed words where the column is still NULL.
      const old = await pool.query(
        'SELECT id, passage FROM races WHERE demo_owner = $1 AND demo_key = $2', [demo, key]);
      if (old.rows.length) {
        await pool.query(
          `UPDATE race_entries e SET missed_words = $1
           FROM races r
           WHERE e.race_id = r.id AND r.id = $2 AND e.user_id = $3 AND e.missed_words IS NULL`,
          [demoMissedWords(old.rows[0].passage, rand), old.rows[0].id, String(req.user.id)]);
      }
      continue;
    }
    const raceId = ins.rows[0].id;

    // The viewer's own entry, already settled with the mock figures.
    const others = [];
    const fieldNames = DEMO_BOTS.map((b) => b.name).concat(['demo-heron', 'demo-badger', 'demo-moth', 'demo-ibex']);
    let nextPlace = 2;
    for (let lane = 1; lane < h.size && others.length < h.size - 1; lane++) {
      const aroundViewer = h.place == null ? lane : (lane < h.place ? lane : lane + 1);
      if (h.place != null && aroundViewer > h.size) break;
      const wpmVal = h.place != null && aroundViewer < h.place
        ? h.wpm + Math.round(2 + rand() * 6)
        : Math.max(20, h.wpm - Math.round(2 + rand() * 12));
      others.push({ lane, name: fieldNames[lane % fieldNames.length], place: aroundViewer, wpm: wpmVal });
    }
    const viewerLane = 0;
    await pool.query(
      `INSERT INTO race_entries (race_id, lane, user_id, username, joined_at, last_seen_at, progress, keystrokes, correct_keys, finished_at, place, wpm, accuracy, bot_wpm, bot_accuracy, missed_words)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12, NULL, NULL, $13)
       ON CONFLICT DO NOTHING`,
      [raceId, viewerLane, String(req.user.id), req.user.username, startsAt, passage.length,
        Math.round(passage.length * 100 / h.acc), passage.length, finishedAt,
        h.place, h.wpm, h.acc, demoMissedWords(passage, rand)]);
    for (const o of others) {
      await pool.query(
        `INSERT INTO race_entries (race_id, lane, user_id, username, joined_at, last_seen_at, progress, keystrokes, correct_keys, finished_at, place, wpm, accuracy, bot_wpm, bot_accuracy)
         VALUES ($1, $2, NULL, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT DO NOTHING`,
        [raceId, o.lane, o.name, startsAt, passage.length,
          Math.round(passage.length * 100 / Math.min(99, o.wpm > 0 ? 96 : 96)), passage.length,
          finishedAt, o.place, o.wpm, Math.round(90 + rand() * 9), o.wpm, 96]);
    }
  }
}

async function ensureDemoLobby(req, demo) {
  const owner = ownerClause(demo, 1);
  let found = await pool.query(
    `SELECT id FROM races WHERE status = 'lobby' AND ${owner.sql} ORDER BY id LIMIT 1`, owner.values);
  if (!found.rows.length) {
    await pool.query(
      `INSERT INTO races (kind, status, passage, starts_at, first_finish_at, finished_at, created_at, created_by, demo_owner, demo_key)
       VALUES ('race', 'lobby', NULL, NULL, NULL, NULL, $1, $2, $3, 'lobby')
       ON CONFLICT DO NOTHING`,
      [req.now, req.user.username, demo]);
    found = await pool.query(
      `SELECT id FROM races WHERE status = 'lobby' AND ${owner.sql} ORDER BY id LIMIT 1`, owner.values);
  }
  if (!found.rows.length) return; // a concurrent request owns the lobby
  // Idempotent: a lobby created by a concurrent read still gets its racers.
  const raceId = found.rows[0].id;
  for (let i = 0; i < DEMO_BOTS.length; i++) {
    const b = DEMO_BOTS[i];
    await pool.query(
      `INSERT INTO race_entries (race_id, lane, user_id, username, joined_at, last_seen_at, progress, bot_wpm, bot_accuracy)
       VALUES ($1, $2, NULL, $3, $4, $4, 0, $5, $6)
       ON CONFLICT DO NOTHING`,
      [raceId, i, b.name, req.now, b.wpm, b.acc]);
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

// Wrap async handlers so a rejected promise reaches express's error path.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// The lobby's data: the next race's grid, the viewer's running race, their
// stats and recent races. Guest-readable.
app.get('/api/home', h(async (req, res) => {
  const demo = demoOwner(req);
  const viewerId = req.user ? String(req.user.id) : null;

  await pruneStaleLobbyEntries(demo, req.now);

  // Settle any running race that is due to close, so results are ready
  // whenever someone looks.
  const owner = ownerClause(demo, 1);
  const due = await pool.query(
    `SELECT * FROM races WHERE status = 'running' AND starts_at IS NOT NULL AND ${owner.sql}`,
    owner.values);
  for (const race of due.rows) {
    if (demo != null) { await updateBots(race, req.now); const f = await pool.query('SELECT * FROM races WHERE id = $1', [race.id]); Object.assign(race, f.rows[0]); }
    await settleRace(race, req.now);
  }

  if (demo != null && viewerId != null) {
    await seedDemoHistory(req, demo);
    await ensureDemoLobby(req, demo);
  }

  // Refresh the viewer's own lobby presence.
  if (viewerId != null) {
    await pool.query(
      `UPDATE race_entries e SET last_seen_at = $1
       FROM races r WHERE e.race_id = r.id AND r.status = 'lobby'
         AND e.user_id = $2 AND ${demo == null ? 'r.demo_owner IS NULL' : 'r.demo_owner = $3'}`,
      demo == null ? [req.now, viewerId] : [req.now, viewerId, demo]);
  }

  // The next race, with its grid.
  const lobbyRow = await pool.query(
    `SELECT r.id FROM races r WHERE r.status = 'lobby' AND ${owner.sql} ORDER BY r.id LIMIT 1`,
    owner.values);
  let lobby = null;
  if (lobbyRow.rows.length) {
    const lobbyId = lobbyRow.rows[0].id;
    const entries = await pool.query(
      'SELECT lane, user_id, username FROM race_entries WHERE race_id = $1 ORDER BY lane', [lobbyId]);
    lobby = {
      id: lobbyId,
      max: MAX_RACERS,
      joined: viewerId != null && entries.rows.some((e) => e.user_id === viewerId),
      racers: entries.rows.map((e) => ({
        username: e.username,
        lane: e.lane,
        isYou: viewerId != null && e.user_id === viewerId,
      })),
    };
  }

  // The viewer's running race, if any.
  let activeRaceId = null;
  if (viewerId != null) {
    const active = await pool.query(
      `SELECT r.id FROM race_entries e JOIN races r ON r.id = e.race_id
       WHERE e.user_id = $1 AND r.status = 'running' AND ${ownerClause(demo, 2).sql}
       ORDER BY r.id DESC LIMIT 1`,
      [viewerId, ...ownerClause(demo, 2).values]);
    if (active.rows.length) activeRaceId = active.rows[0].id;
  }

  // Stats and recent races. Practice runs land in the list but never in the
  // stats: no best speed, no accuracy average, no wins.
  const stats = { bestWpm: 0, avgAccuracy: 0, wins: 0, races: 0 };
  let recent = [];
  let week = [];
  let missedWords = [];
  if (viewerId != null) {
    const agg = await pool.query(
      `SELECT e.wpm, e.accuracy, e.place FROM race_entries e
       JOIN races r ON r.id = e.race_id
       WHERE e.user_id = $1 AND r.status = 'finished' AND r.kind = 'race' AND ${ownerClause(demo, 2).sql}
       ORDER BY r.finished_at DESC NULLS LAST LIMIT 20`,
      [viewerId, ...ownerClause(demo, 2).values]);
    const rows = agg.rows.filter((r) => r.wpm != null);
    if (rows.length) {
      stats.bestWpm = Math.max(...rows.map((r) => r.wpm));
      stats.avgAccuracy = Math.round(rows.reduce((s, r) => s + (r.accuracy || 0), 0) / rows.length);
      stats.wins = rows.filter((r) => r.place === 1).length;
      stats.races = rows.length;
    }
    const list = await pool.query(
      `SELECT e.place, e.wpm, e.accuracy, r.kind, r.finished_at,
              (SELECT COUNT(*) FROM race_entries WHERE race_id = r.id)::int AS field_size
       FROM race_entries e JOIN races r ON r.id = e.race_id
       WHERE e.user_id = $1 AND r.status = 'finished' AND ${ownerClause(demo, 2).sql}
       ORDER BY r.finished_at DESC NULLS LAST LIMIT 10`,
      [viewerId, ...ownerClause(demo, 2).values]);
    recent = list.rows.map((r) => ({
      kind: r.kind,
      place: r.place,
      fieldSize: r.field_size,
      wpm: r.wpm,
      accuracy: r.accuracy,
      won: r.kind === 'race' && r.place === 1,
      finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    }));

    // Speed per day for the Last 7 days chart: races and practice runs
    // alike, finished in the last eight days (the extra day lets the client
    // cover the viewer's local midnight).
    const owner3 = ownerClause(demo, 3);
    const weekQ = await pool.query(
      `SELECT e.wpm, r.finished_at FROM race_entries e
       JOIN races r ON r.id = e.race_id
       WHERE e.user_id = $1 AND r.status = 'finished' AND e.wpm IS NOT NULL
         AND r.finished_at >= $2 AND ${owner3.sql}
       ORDER BY r.finished_at DESC NULLS LAST LIMIT 500`,
      [viewerId, new Date(req.now.getTime() - 8 * 86400000), ...owner3.values]);
    week = weekQ.rows.map((r) => ({
      finishedAt: new Date(r.finished_at).toISOString(),
      wpm: r.wpm,
    }));

    // The words mistyped most often in the viewer's last 20 finished runs.
    const owner2 = ownerClause(demo, 2);
    const missQ = await pool.query(
      `WITH last20 AS (
         SELECT e.missed_words FROM race_entries e
         JOIN races r ON r.id = e.race_id
         WHERE e.user_id = $1 AND r.status = 'finished' AND ${owner2.sql}
         ORDER BY r.finished_at DESC NULLS LAST LIMIT 20
       )
       SELECT word, COUNT(*)::int AS count
       FROM last20, unnest(missed_words) AS word
       GROUP BY word ORDER BY count DESC, word LIMIT 5`,
      [viewerId, ...owner2.values]);
    missedWords = missQ.rows.map((r) => ({ word: r.word, count: r.count }));
  }

  res.json({
    demo: demo != null,
    serverNow: req.now.toISOString(),
    lobby,
    activeRaceId,
    stats,
    recent,
    week,
    missedWords,
  });
}));

// Join the next race: reuse the open lobby or create one, and take the
// lowest free lane. Two people tapping at once end up in the same lobby via
// the partial unique index and the reselect below.
app.post('/api/lobby/join', h(async (req, res) => {
  const demo = demoOwner(req);
  const viewerId = String(req.user.id);
  const now = req.now;

  // Already mid-race? Joining again would fork their presence.
  const owner2 = ownerClause(demo, 2);
  const active = await pool.query(
    `SELECT r.id FROM race_entries e JOIN races r ON r.id = e.race_id
     WHERE e.user_id = $1 AND r.status = 'running' AND ${owner2.sql} LIMIT 1`,
    [viewerId, ...owner2.values]);
  if (active.rows.length) return res.status(409).json({ error: 'in_race' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owner = ownerClause(demo, 1); // this query's only parameters
    let lobby = await client.query(
      `SELECT id FROM races WHERE status = 'lobby' AND ${owner.sql} ORDER BY id LIMIT 1 FOR UPDATE`,
      owner.values);
    if (!lobby.rows.length) {
      await client.query(
        `INSERT INTO races (kind, status, passage, starts_at, first_finish_at, finished_at, created_at, created_by, demo_owner, demo_key)
         VALUES ('race', 'lobby', NULL, NULL, NULL, NULL, $1, $2, $3, NULL)
         ON CONFLICT DO NOTHING`,
        [now, req.user.username, demo]);
      lobby = await client.query(
        `SELECT id FROM races WHERE status = 'lobby' AND ${owner.sql} ORDER BY id LIMIT 1`,
        owner.values);
    }
    const raceId = lobby.rows[0].id;

    const filled = await client.query(
      'SELECT lane, user_id FROM race_entries WHERE race_id = $1 ORDER BY lane', [raceId]);
    if (filled.rows.length >= MAX_RACERS) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'race_full' });
    }
    if (filled.rows.some((e) => e.user_id === viewerId)) {
      await client.query('COMMIT');
      return res.json({ ok: true, raceId });
    }
    const taken = new Set(filled.rows.map((e) => e.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    await client.query(
      `INSERT INTO race_entries (race_id, lane, user_id, username, joined_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (race_id, user_id) WHERE user_id IS NOT NULL DO NOTHING`,
      [raceId, lane, viewerId, req.user.username, now, now]);
    await client.query('COMMIT');
    return res.json({ ok: true, raceId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// Free your lane before the race starts.
app.post('/api/races/:id/leave', h(async (req, res) => {
  const demo = demoOwner(req);
  const owner = ownerClause(demo, 2);
  const race = await pool.query(
    `SELECT id, status FROM races WHERE id = $1 AND ${owner.sql}`, [req.params.id, ...owner.values]);
  if (!race.rows.length) return res.status(404).json({ error: 'not_found' });
  if (race.rows[0].status !== 'lobby') return res.status(409).json({ error: 'already_started' });
  await pool.query(
    'DELETE FROM race_entries WHERE race_id = $1 AND user_id = $2',
    [race.rows[0].id, String(req.user.id)]);
  res.json({ ok: true });
}));

// Start the race you are waiting in. Any racer in the lobby can start it once
// at least two are in; the status guard makes a double tap start it once.
app.post('/api/races/:id/start', h(async (req, res) => {
  const demo = demoOwner(req);
  const owner = ownerClause(demo, 2);
  const now = req.now;
  const race = await pool.query(
    `SELECT * FROM races WHERE id = $1 AND ${owner.sql}`, [req.params.id, ...owner.values]);
  if (!race.rows.length) return res.status(404).json({ error: 'not_found' });
  if (race.rows[0].status !== 'lobby') return res.status(409).json({ error: 'already_started' });
  const raceId = race.rows[0].id;

  await pruneStaleLobbyEntries(demo, now);
  const live = await pool.query('SELECT COUNT(*)::int AS n FROM race_entries WHERE race_id = $1', [raceId]);
  if (live.rows[0].n < 2) return res.status(409).json({ error: 'need_two' });

  // The racer who presses Start picks the text for everyone: their body's
  // language and category (missing, 'any' or unknown mean a random pick).
  const choice = pickPassage({
    language: req.body && req.body.language,
    category: req.body && req.body.category,
  });
  const started = await pool.query(
    `UPDATE races SET status = 'running', passage = $1, starts_at = $2, language = $4, category = $5
     WHERE id = $3 AND status = 'lobby' RETURNING id`,
    [choice.passage, new Date(now.getTime() + 5000), raceId, choice.language, choice.category]);
  if (!started.rows.length) return res.status(409).json({ error: 'already_started' });
  res.json({ ok: true, raceId });
}));

// A solo run on the same track: one racer, a fresh passage, a 3 s countdown.
app.post('/api/practice', h(async (req, res) => {
  const demo = demoOwner(req);
  const now = req.now;
  const startsAt = new Date(now.getTime() + 3000);
  const choice = pickPassage({
    language: req.body && req.body.language,
    category: req.body && req.body.category,
  });
  const ins = await pool.query(
    `INSERT INTO races (kind, status, passage, starts_at, first_finish_at, finished_at, created_at, created_by, demo_owner, demo_key, language, category)
     VALUES ('practice', 'running', $1, $2, NULL, NULL, $3, $4, $5, NULL, $6, $7) RETURNING id`,
    [choice.passage, startsAt, now, req.user.username, demo, choice.language, choice.category]);
  await pool.query(
    `INSERT INTO race_entries (race_id, lane, user_id, username, joined_at, last_seen_at)
     VALUES ($1, 0, $2, $3, $4, $4)`,
    [ins.rows[0].id, String(req.user.id), req.user.username, now]);
  res.json({ ok: true, raceId: ins.rows[0].id });
}));

// A race, live. Guest-readable; the passage only appears once it is running.
app.get('/api/races/:id', h(async (req, res) => {
  const demo = demoOwner(req);
  const state = await raceResponse(req, req.params.id, demo);
  if (!state) return res.status(404).json({ error: 'not_found' });
  res.json({ demo: demo != null, serverNow: req.now.toISOString(), race: state });
}));

// Typing progress for the viewer's own entry. Rejected before the start and
// after the race has settled; clamped so a tampered client cannot win by
// claiming more progress than the time since the start allows.
app.post('/api/races/:id/progress', h(async (req, res) => {
  const demo = demoOwner(req);
  const owner = ownerClause(demo, 2);
  const now = req.now;
  const race = await pool.query(
    `SELECT * FROM races WHERE id = $1 AND ${owner.sql}`, [req.params.id, ...owner.values]);
  if (!race.rows.length) return res.status(404).json({ error: 'not_found' });
  const r = race.rows[0];
  if (r.status !== 'running' || !r.starts_at || !r.passage) {
    return res.status(409).json({ error: 'not_running' });
  }
  const startMs = new Date(r.starts_at).getTime();
  if (now.getTime() < startMs) return res.status(409).json({ error: 'not_started' });
  await updateBots(r, now);
  const settled = await settleRace(r, now);
  if (settled) return res.status(409).json({ error: 'already_closed' });

  const entry = await pool.query(
    'SELECT * FROM race_entries WHERE race_id = $1 AND user_id = $2',
    [r.id, String(req.user.id)]);
  if (!entry.rows.length) return res.status(404).json({ error: 'not_in_race' });

  const len = r.passage.length;
  const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(Number(v) || 0)));
  const progress = clampInt(req.body.progress, 0, len);
  const keystrokes = clampInt(req.body.keystrokes, 0, 100000);
  const correctKeys = clampInt(req.body.correctKeys, 0, keystrokes);
  const cap = maxPlausibleProgress(now.getTime() - startMs);
  const newProgress = Math.min(progress, cap, len);

  const finished = newProgress >= len;
  // Missed words come with the progress posts, so a racer who runs out of
  // time still has theirs counted. The list is capped to the race's own
  // passage words, and a post only overwrites a longer one: a late, older
  // post never shrinks the list.
  const missed = cleanMissedWords(r.passage, req.body && req.body.missedWords);
  let updateSql = `UPDATE race_entries SET
       progress = GREATEST(progress, $1),
       keystrokes = GREATEST(keystrokes, $2),
       correct_keys = GREATEST(correct_keys, $3),
       finished_at = CASE WHEN $4 AND finished_at IS NULL THEN $5 ELSE finished_at END`;
  const params = [newProgress, keystrokes, correctKeys, finished, now];
  if (missed != null) {
    updateSql += `,
       missed_words = CASE WHEN cardinality($8::text[]) >= COALESCE(cardinality(missed_words), 0)
                           THEN $8::text[] ELSE missed_words END`;
  }
  updateSql += ` WHERE race_id = $6 AND user_id = $7`;
  params.push(r.id, String(req.user.id));
  if (missed != null) params.push(missed);
  await pool.query(updateSql, params);
  if (finished) {
    await pool.query(
      'UPDATE races SET first_finish_at = COALESCE(first_finish_at, $1) WHERE id = $2',
      [now, r.id]);
  }

  const fresh = await pool.query('SELECT * FROM races WHERE id = $1', [r.id]);
  await settleRace(fresh.rows[0], now);
  const state = await raceResponse(req, r.id, demo);
  res.json({ ok: true, serverNow: now.toISOString(), race: state });
}));

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/type-racer-battle-1c07b0/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/type-racer-battle-1c07b0/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Boot ────────────────────────────────────────────────────────────────────

async function start() {
  await ensureSchema();
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  // Stop accepting, let live requests drain, close the pool, exit.
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, shutting down`);
    server.close(() => { });
    await new Promise((r) => setTimeout(r, 3000));
    await pool.end().catch(() => { });
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => { console.error(err); process.exit(1); });