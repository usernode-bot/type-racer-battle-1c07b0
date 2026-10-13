// Type Racer Battle's screen: a state machine over the API.
//   loading → lobby → race (countdown → racing → waiting → results) → lobby
// Polls the API about once a second while visible; all race time decisions
// come from the server's clock (serverNow) offset onto the page's own now.
'use strict';

(function () {
  const app = document.getElementById('app');
  const Typing = window.Typing;

  // ── Small helpers ────────────────────────────────────────────────────────

  function el(tag, className, children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (children) for (const c of children) if (c) node.appendChild(c);
    return node;
  }
  function text(tag, className, value) {
    const node = el(tag, className);
    node.textContent = value;
    return node;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  // The race view is wider than the lobby and the loading screen: whole
  // literals so Tailwind's extractor keeps both.
  function setWide(on) {
    app.classList.toggle('max-w-3xl', on);
    app.classList.toggle('max-w-lg', !on);
  }

  const IS_DEMO = new URLSearchParams(location.search).get('demo') === '1';
  const PAGE_TOKEN = new URLSearchParams(location.search).get('token');
  function apiUrl(path) {
    return IS_DEMO ? path + (path.includes('?') ? '&' : '?') + 'demo=1' : path;
  }

  async function api(path, options) {
    const headers = Object.assign({ Accept: 'application/json' }, options && options.headers);
    // Inside the platform iframe the identity arrives as ?token= on the
    // initial load and the app's own fetches must forward it; at the app's
    // own address the edge adds the header by itself.
    if (PAGE_TOKEN) headers['x-usernode-token'] = PAGE_TOKEN;
    const res = await fetch(apiUrl(path), Object.assign({}, options, { headers }));
    let body = null;
    try { body = await res.json(); } catch (_) { /* non-JSON error */ }
    if (!res.ok) {
      const err = new Error((body && body.error) || 'http_' + res.status);
      err.status = res.status;
      err.code = body && body.error;
      throw err;
    }
    return body;
  }

  function toast(message) {
    try {
      if (window.unNative && window.unNative.toast) window.unNative.toast(message);
    } catch (_) { /* the toast is a nicety, never a failure */ }
  }

  // The SVG car: a side view drawn in its lane's livery (the colour comes
  // from a whole-literal class on the wrapper span, so Tailwind's extractor
  // sees it).
  const CAR_SVG =
    '<svg viewBox="0 0 60 24" aria-hidden="true"><path class="body" d="M3 18v-5l6-2 8-6h20l9 6 9 2v5z"/><path class="glass" d="M19 7h16l6 5H14z"/><circle class="wheel" cx="15" cy="18.5" r="4.5"/><circle class="wheel" cx="46" cy="18.5" r="4.5"/></svg>';
  // Whole literals so the compiler keeps them; chosen by lane % 6.
  const CAR_CLASSES = ['text-car-1', 'text-car-2', 'text-car-3', 'text-car-4', 'text-car-5', 'text-car-6'];

  // The scene backdrop: one static stretch of city — skyline, tree band,
  // grey wall with posts — stretched over the backdrop's box.
  const SCENE_SVG =
    '<svg class="scene-svg" viewBox="0 0 768 132" preserveAspectRatio="none" aria-hidden="true">' +
    '<rect class="bld" x="20" y="40" width="40" height="70"/><rect class="bld" x="70" y="20" width="28" height="90"/><rect class="bld" x="110" y="50" width="50" height="60"/><rect class="bld" x="230" y="28" width="34" height="82"/><rect class="bld" x="280" y="10" width="26" height="100"/><rect class="bld" x="320" y="46" width="60" height="64"/><rect class="bld" x="450" y="24" width="30" height="86"/><rect class="bld" x="490" y="56" width="44" height="54"/><rect class="bld" x="600" y="16" width="32" height="94"/><rect class="bld" x="644" y="40" width="54" height="70"/>' +
    '<ellipse class="tree" cx="40" cy="100" rx="60" ry="16"/><ellipse class="tree-d" cx="170" cy="102" rx="70" ry="14"/><ellipse class="tree" cx="320" cy="100" rx="80" ry="16"/><ellipse class="tree-d" cx="480" cy="102" rx="70" ry="14"/><ellipse class="tree" cx="640" cy="100" rx="90" ry="16"/>' +
    '<rect class="wall" x="0" y="108" width="768" height="24"/><rect class="wall-post" x="0" y="108" width="768" height="4"/><rect class="wall-post" x="60" y="104" width="8" height="28"/><rect class="wall-post" x="220" y="104" width="8" height="28"/><rect class="wall-post" x="380" y="104" width="8" height="28"/><rect class="wall-post" x="540" y="104" width="8" height="28"/><rect class="wall-post" x="700" y="104" width="8" height="28"/>' +
    '</svg>';

  // The speedometer: 0–10 on the dial, read times ten (so 4.6 is 46 wpm),
  // red zone from 8. The needle is drawn pointing up and rotated by an
  // inline transform (dialAngle − 270).
  const GAUGE_SVG =
    '<svg viewBox="0 0 120 120" aria-hidden="true">' +
    '<circle class="dial" cx="60" cy="64" r="56"/>' +
    '<path class="dial-arc" d="M20.2 87 A46 46 0 1 1 99.8 87"/>' +
    '<path class="dial-red" d="M103.7 49.8 A46 46 0 0 1 99.8 87"/>' +
    '<g class="dial-numbers" text-anchor="middle"><text x="30.6" y="84">0</text><text class="dial-min" x="27.7" y="57">2</text><text x="46.2" y="36">4</text><text x="73.8" y="36">6</text><text class="dial-min" x="92.3" y="57">8</text><text x="89.4" y="84">10</text></g>' +
    '<g class="needle-g"><line class="needle" x1="60" y1="64" x2="53.7" y2="26.5" stroke-width="3" stroke-linecap="round"/><circle class="needle-hub" cx="60" cy="64" r="5"/></g>' +
    '<text class="dial-label" x="60" y="106" text-anchor="middle">×10 wpm</text>' +
    '</svg>';

  const STOPWATCH_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7"/><path d="M12 14V10.5M10 3h4M12 3v4"/></svg>';
  const FLAG_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h13l-2 4.5 2 4.5H5"/><path d="M9 4v9M13 4v9M5 8.5h12"/></svg>';

  function carNode(lane, tagText, tagYou) {
    const wrap = el('span', 'car ' + CAR_CLASSES[((lane % 6) + 6) % 6]);
    wrap.appendChild(text('span', 'car-tag' + (tagYou ? ' car-tag-you' : ''), tagText || ''));
    const holder = document.createElement('span');
    holder.innerHTML = CAR_SVG;
    const svg = holder.firstChild;
    svg.setAttribute('class', 'car-svg');
    wrap.appendChild(svg);
    return wrap;
  }

  // The track: one lane per racer plus, in the lobby, one open lane. The car
  // moves by an inline `left`, which the .car component transitions between
  // polls.
  function trackNode(entries, opts) {
    opts = opts || {};
    const track = el('div', 'track road');
    for (const e of entries) {
      const lane = el('div', 'lane' + (opts.thin ? ' lane-thin' : '') + (e.isYou ? ' lane-you' : ''));
      if (opts.withCars) lane.appendChild(carNode(e.lane, '', e.isYou));
      track.appendChild(lane);
    }
    if (opts.openLane) {
      const lane = el('div', 'lane' + (opts.thin ? ' lane-thin' : ''));
      lane.appendChild(text('span', 'car-tag car-tag-open', 'Open lane'));
      track.appendChild(lane);
    }
    return track;
  }

  // progress 0…total → left offset inside the lane, stopping short of the
  // checkered finish (8px) plus a little margin. --car-w comes from the lane.
  function carLeft(progress, total) {
    const frac = total ? Math.max(0, Math.min(1, progress / total)) : 0;
    return 'calc((100% - var(--car-w) - 16px) * ' + frac.toFixed(4) + ' + 6px)';
  }

  // Moves the cars and fills the name tags. tags[i] = { text, aria }.
  function updateCars(track, entries, total, tags) {
    const cars = track.querySelectorAll('.car');
    entries.forEach((e, i) => {
      const car = cars[i];
      if (!car) return;
      const frac = total ? Math.max(0, Math.min(1, e.progress / total)) : 0;
      car.style.left = carLeft(e.progress, total);
      const t = (tags && tags[i]) || {};
      const tag = car.querySelector('.car-tag');
      if (tag) {
        tag.textContent = t.text != null ? t.text : '';
        // Near the start the tag sits in front of the car, where there is
        // room; once the car is well along it flips behind.
        tag.classList.toggle('car-tag-ahead', frac < 0.35);
        if (t.aria) tag.setAttribute('aria-label', t.aria);
      }
    });
  }

  // The scene: the backdrop (and, in a race, the HUD on it), the barrier,
  // the road, the barrier again. The dashboard is added later, by
  // renderTypingArea, under the road.
  function sceneNode(entries, opts) {
    opts = opts || {};
    const scene = el('div', 'scene');
    const backdrop = el('div', 'scene-backdrop' + (opts.low ? ' scene-backdrop-low' : ''));
    backdrop.innerHTML = SCENE_SVG;
    scene.appendChild(backdrop);
    if (opts.hud) scene.appendChild(hudNode());
    scene.appendChild(el('div', 'curb'));
    scene.appendChild(trackNode(entries, opts));
    scene.appendChild(el('div', 'curb'));
    return scene;
  }

  // The HUD on the sky: your speed with the start light, and the clock.
  function hudNode() {
    const hud = el('div', 'hud');
    hud.id = 'hud';
    const wpm = el('div', 'hud-badge');
    wpm.id = 'hud-wpm';
    const figure = el('b', 'hud-figure');
    figure.id = 'hud-wpm-value';
    figure.textContent = '0';
    wpm.appendChild(figure);
    wpm.appendChild(text('span', 'hud-unit', 'wpm'));
    const signal = el('span', 'signal');
    signal.setAttribute('aria-hidden', 'true');
    signal.appendChild(el('i', 'signal-stop'));
    signal.appendChild(el('i', 'signal-go'));
    wpm.appendChild(signal);
    const clock = el('div', 'hud-badge');
    clock.id = 'hud-clock';
    const clockText = el('b', 'hud-figure');
    clockText.id = 'hud-clock-value';
    clock.appendChild(clockText);
    hud.appendChild(wpm);
    hud.appendChild(clock);
    return hud;
  }

  // The dashboard: the gauge and the passage strip.
  function dashNode() {
    const dash = el('div', 'dash');
    dash.id = 'dash';
    const holder = document.createElement('span');
    holder.innerHTML = GAUGE_SVG;
    dash.appendChild(holder.firstChild);
    const strip = el('p', 'strip');
    strip.id = 'strip';
    strip.appendChild(el('span', 'strip-line'));
    dash.appendChild(strip);
    return dash;
  }

  // Name tags for a set of entries: other racers' names, You for yours.
  function lobbyTags(entries) {
    return entries.map((e) => e.isYou
      ? { text: 'You', aria: 'You' }
      : { text: e.username });
  }

  function placeBadge(entry) {
    const badge = el('span', 'badge' + (entry.won ? ' badge-win' : ''));
    if (entry.kind === 'practice') {
      badge.innerHTML = STOPWATCH_SVG;
      badge.querySelector('svg').classList.add('h-5', 'w-5');
      badge.setAttribute('aria-label', 'Practice');
    } else {
      badge.textContent = ordinal(entry.place);
    }
    return badge;
  }

  function ordinal(place) {
    if (place === 1) return '1st';
    if (place === 2) return '2nd';
    if (place === 3) return '3rd';
    return place + 'th';
  }

  function formatWhen(iso, nowMs) {
    const d = new Date(iso);
    const local = localNowMs();
    const dayStart = new Date(local); dayStart.setHours(0, 0, 0, 0);
    const days = Math.floor((dayStart - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days <= 0) return 'Today, ' + time;
    if (days === 1) return 'Yesterday, ' + time;
    return d.toLocaleDateString([], { weekday: 'long' }) + ', ' + time;
  }

  // The server's clock, offset onto the page's own (the bridge's usernode.now
  // when the bridge is around, the local clock otherwise). The bridge hands
  // back a Date, not a number, so coerce it: a Date plus anything else is a
  // string, and every time comparison downstream goes NaN.
  function localNowMs() {
    const now = window.usernode && window.usernode.now ? window.usernode.now() : null;
    const ms = now == null ? NaN : Number(now);
    return isFinite(ms) ? ms : Date.now();
  }
  let serverOffsetMs = 0; // serverNow - localNow
  function nowMs() {
    return localNowMs() + serverOffsetMs;
  }
  function absorbServerNow(iso) {
    if (!iso) return;
    serverOffsetMs = Date.parse(iso) - localNowMs();
  }

  // ── Screens ──────────────────────────────────────────────────────────────

  function demoLine() {
    return text('p', 'rounded-lg bg-raised px-3 py-2.5 text-small text-muted',
      'Staging demo: the other racers here are made up.');
  }

  function headerNode() {
    const mark = el('span', 'flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-fg text-surface [&>svg]:h-[22px] [&>svg]:w-[22px]');
    mark.innerHTML = FLAG_SVG;
    return el('header', 'flex min-h-11 items-center gap-2.5', [
      mark,
      text('h1', 'text-heading', 'Type Racer Battle'),
    ]);
  }

  function renderLoading() {
    clear(app);
    setWide(false);
    app.appendChild(headerNode());
    const card = el('section', 'card flex flex-col gap-3.5');
    card.appendChild(el('div', 'card-head flex items-baseline justify-between', [
      text('h2', 'text-heading', 'Next race'),
      el('span', 'skeleton h-4 w-20'),
    ]));
    // A scene-shaped placeholder: the grid arrives here in a moment.
    card.appendChild(el('div', 'skeleton h-40 w-full rounded-xl'));
    card.appendChild(el('div', 'skeleton h-11 w-full rounded-lg'));
    app.appendChild(card);
    app.appendChild(el('div', 'skeleton h-11 w-full rounded-lg'));
    app.appendChild(el('div', 'skeleton h-20 w-full rounded-xl'));
  }

  function renderError(retry) {
    clear(app);
    setWide(false);
    app.appendChild(headerNode());
    const box = el('section', 'state-error rounded-xl border border-line bg-surface');
    box.appendChild(text('p', 'text-body font-medium', 'Could not load the race lobby.'));
    box.appendChild(text('p', 'text-small text-muted', 'Check your connection and try again.'));
    const btn = el('button', 'btn-primary mt-1 min-w-24');
    btn.textContent = 'Retry';
    btn.addEventListener('click', retry);
    box.appendChild(btn);
    app.appendChild(box);
  }

  // ── Lobby ────────────────────────────────────────────────────────────────

  function renderLobby(home, actions) {
    clear(app);
    const view = el('div', 'flex flex-col gap-5');
    view.id = 'lobby-view';
    app.appendChild(view);
    view.appendChild(headerNode());
    if (home.demo) view.appendChild(demoLine());

    if (home.activeRaceId) {
      const back = el('button', 'btn-secondary min-h-11');
      back.textContent = 'Back to your race';
      back.addEventListener('click', () => actions.openRace(home.activeRaceId));
      view.appendChild(back);
    }

    const lobby = home.lobby;
    const card = el('section', 'card flex flex-col gap-3.5');
    const count = lobby ? lobby.racers.length : 0;
    card.appendChild(el('div', 'flex items-baseline justify-between', [
      text('h2', 'text-heading', 'Next race'),
      text('span', 'text-small text-muted', lobby ? count + ' of ' + lobby.max + ' racers' : ''),
    ]));

    if (lobby && lobby.racers.length) {
      // The lobby's starting grid: the scene with an open lane for the next
      // racer, thin lanes once nine would be on the road. Cars all sit at
      // the start line (total 0).
      const scene = sceneNode(lobby.racers, {
        withCars: true,
        openLane: count < lobby.max,
        thin: lobby.racers.length + 1 >= 9,
        low: true,
      });
      updateCars(scene.querySelector('.track'), lobby.racers, 0, lobbyTags(lobby.racers));
      card.appendChild(scene);
    } else {
      // One full-width open lane, same structure as the populated grid, with
      // the note left-aligned under it on the card's own padding.
      const empty = el('div', 'flex flex-col gap-3');
      empty.appendChild(sceneNode([], { openLane: true, low: true }));
      empty.appendChild(text('p', 'text-small text-muted',
        'No one is waiting yet. Join and the next race opens.'));
      card.appendChild(empty);
    }

    const joined = lobby && lobby.joined;
    const full = lobby && count >= lobby.max;
    const canStart = joined && count >= 2;

    if (!joined) {
      const join = el('button', 'btn-primary w-full');
      join.textContent = 'Join race';
      if (full) {
        join.disabled = true;
        card.appendChild(join);
        card.appendChild(text('p', 'text-center text-small text-muted',
          'This race is full. Join the next one when it starts.'));
      } else {
        join.addEventListener('click', actions.join);
        card.appendChild(join);
        card.appendChild(text('p', 'text-center text-small text-muted',
          'Any racer can start once two are in.'));
      }
    } else {
      const start = el('button', 'btn-primary w-full');
      start.textContent = 'Start race';
      if (!canStart) start.disabled = true;
      start.addEventListener('click', () => actions.start(lobby.id));
      card.appendChild(start);
      const leave = el('button', 'btn-secondary w-full');
      leave.textContent = 'Leave';
      leave.addEventListener('click', () => actions.leave(lobby.id));
      card.appendChild(leave);
      card.appendChild(text('p', 'text-center text-small text-muted',
        'Any racer can start once two are in.'));
    }
    view.appendChild(card);

    const practice = el('button', 'btn-secondary w-full');
    practice.innerHTML = STOPWATCH_SVG;
    practice.querySelector('svg').classList.add('h-5', 'w-5');
    practice.appendChild(document.createTextNode('Practice alone'));
    practice.addEventListener('click', actions.practice);
    view.appendChild(practice);

    // Your stats: best speed, average accuracy, wins. Practice runs land in
    // your races but never in these cells.
    const stats = home.stats;
    const statsWrap = el('section');
    statsWrap.appendChild(text('h2', 'section-label', 'Your stats'));
    const cells = el('div', 'stats');
    // No race yet: '–' for the speed figures (no data, not a failing score);
    // the win count still reads 0 and wins of 0.
    const raced = stats.races > 0;
    cells.appendChild(statCell(raced ? String(stats.bestWpm) : '–', 'best wpm', true, !raced));
    cells.appendChild(statCell(raced ? stats.avgAccuracy + '%' : '–', 'accuracy', true, !raced));
    cells.appendChild(statCell(String(stats.wins), 'wins of ' + stats.races, false));
    statsWrap.appendChild(cells);
    view.appendChild(statsWrap);

    // Your races.
    const listWrap = el('section');
    listWrap.appendChild(text('h2', 'section-label', 'Your races'));
    if (!home.recent.length) {
      const empty = el('div', 'state-empty rounded-xl border border-line bg-surface');
      empty.appendChild(text('p', 'text-body font-medium', 'No races yet.'));
      empty.appendChild(text('p', 'text-small text-muted',
        'Your speed and accuracy land here after your first race.'));
      listWrap.appendChild(empty);
    } else {
      const list = el('ul', 'list');
      for (const r of home.recent) {
        const row = el('li', 'list-row');
        row.appendChild(placeBadge(r));
        const main = el('div', 'min-w-0 flex-1');
        main.appendChild(text('p', 'text-body',
          r.kind === 'practice' ? 'Practice' : ordinal(r.place) + ' of ' + r.fieldSize));
        main.appendChild(text('p', 'text-small text-muted', formatWhen(r.finishedAt)));
        row.appendChild(main);
        const end = el('div', 'text-right');
        const speed = el('p', 'font-mono text-body');
        speed.appendChild(document.createElement('b')).textContent = r.wpm != null ? r.wpm : '–';
        speed.appendChild(document.createTextNode(' wpm'));
        end.appendChild(speed);
        end.appendChild(text('p', 'font-mono text-small text-muted',
          r.accuracy != null ? r.accuracy + '%' : ''));
        row.appendChild(end);
        list.appendChild(row);
      }
      listWrap.appendChild(list);
    }
    view.appendChild(listWrap);
  }

  function statCell(value, label, mono, muted) {
    const cell = el('div', 'stat');
    const b = el('b', mono ? 'font-mono' : '');
    if (muted) b.classList.add('text-muted');
    b.textContent = value;
    cell.appendChild(b);
    cell.appendChild(text('span', 'text-small text-muted', label));
    return cell;
  }

  // ── Race view ────────────────────────────────────────────────────────────

  // Local typing state, kept between polls so the page never waits a second
  // to echo a keystroke.
  const typing = {
    raceId: null,
    kind: 'race',
    passage: '',
    committed: 0,
    keystrokes: 0,
    correctKeys: 0,
    startedAt: null, // ms epoch, from the server clock
    finishedLocally: false,
    lastValue: '',
    lastPostAt: 0,
  };

  let raceTimer = null; // 1 s poll
  let tickTimer = null; // 100 ms HUD tick
  let reconnecting = false;
  let lastWpm = 0; // your speed figure, frozen once you finish
  let lastRace = null; // the last race the server sent, for the ticker
  let lastDemo = null;

  function stopRaceTimers() {
    if (raceTimer) { clearInterval(raceTimer); raceTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function enterRace(raceId, kind) {
    stopRaceTimers();
    Object.assign(typing, {
      raceId, kind,
      passage: '', committed: 0, keystrokes: 0, correctKeys: 0,
      startedAt: null, finishedLocally: false, lastValue: '', lastPostAt: 0,
    });
    lastWpm = 0;
    lastRace = null;
    lastDemo = null;
    pollRace(raceId);
    raceTimer = setInterval(() => pollRace(raceId), 1000);
    tickTimer = setInterval(tickRace, 100);
  }

  async function pollRace(raceId) {
    if (document.hidden) return; // pause polling while the page is hidden
    let data;
    try {
      data = await api('/api/races/' + raceId);
      reconnecting = false;
    } catch (err) {
      if (typing.raceId !== raceId) return;
      if (!reconnecting) {
        reconnecting = true;
        const line = document.getElementById('reconnect');
        if (line) line.hidden = false;
      }
      return; // a failed poll is not fatal; the next one carries on
    }
    if (typing.raceId !== raceId) return; // the viewer moved on
    const line = document.getElementById('reconnect');
    if (line) line.hidden = true;
    absorbServerNow(data.serverNow);
    renderRace(data.race, data.demo);
  }

  function renderRace(race, demo) {
    lastRace = race;
    lastDemo = demo;
    const startMs = race.startsAt ? Date.parse(race.startsAt) : null;
    const t = nowMs();
    const phase = race.status === 'finished' ? 'results'
      : startMs && t < startMs ? 'countdown' : 'racing';
    const isPractice = race.kind === 'practice';

    const existing = document.getElementById('race-view');
    const sameRace = existing && existing.dataset.raceId === String(race.id);

    if (!sameRace) {
      clear(app);
      setWide(true);
      const view = el('div', 'flex flex-col gap-4');
      view.id = 'race-view';
      view.dataset.raceId = race.id;
      if (demo) view.appendChild(demoLine());
      app.appendChild(view);
    }
    const view = document.getElementById('race-view');

    // Head: title and field size. The clock lives on the scene's HUD now.
    const me = race.entries.find((e) => e.isYou);
    const ranked = race.entries.slice().sort((a, b) => b.progress - a.progress || a.lane - b.lane);
    const myPlace = me ? ranked.indexOf(me) + 1 : 0;
    const head = el('div', 'flex min-h-11 items-center justify-between');
    const headMain = el('div');
    headMain.appendChild(text('h2', 'text-heading', isPractice ? 'Practice' : 'Race'));
    headMain.appendChild(text('p', 'text-small text-muted',
      race.entries.length + (race.entries.length === 1 ? ' racer' : ' racers')));
    head.appendChild(headMain);
    const slot = el('div', 'race-head-slot');
    slot.appendChild(head);
    const oldHead = view.querySelector('.race-head-slot');
    if (oldHead) oldHead.replaceWith(slot);
    else {
      const demoP = view.querySelector('p');
      if (demoP) demoP.after(slot); else view.insertBefore(slot, view.firstChild);
    }

    // Reconnecting line, quiet, under the head.
    let recon = document.getElementById('reconnect');
    if (!recon) {
      recon = text('p', 'text-small text-muted', 'Reconnecting…');
      recon.id = 'reconnect';
      recon.hidden = true;
      view.appendChild(recon);
    }

    // The scene: built once per race, only the track replaced when the
    // number of racers changes.
    const total = race.total || 0;
    let scene = document.getElementById('scene');
    if (!scene) {
      scene = sceneNode(race.entries, {
        withCars: true,
        thin: race.entries.length >= 9,
        hud: true,
      });
      scene.id = 'scene';
      view.appendChild(scene);
    }
    let track = scene.querySelector('.track');
    if (track.childElementCount !== race.entries.length) {
      track.replaceWith(trackNode(race.entries, {
        withCars: true, thin: race.entries.length >= 9,
      }));
      track = scene.querySelector('.track');
    }
    if (me) {
      // Your car follows your local typing, which is ahead of the last poll.
      const localProgress = localTypingProgress();
      me.progress = Math.max(me.progress, localProgress);
    }
    // Your tag: You in the lobby and practice, your live place in a race.
    const placeNow = me && (race.status === 'finished' ? me.place : myPlace);
    const tags = race.entries.map((e) => {
      if (!e.isYou) return { text: e.username };
      if (isPractice) return { text: 'You', aria: 'You' };
      return { text: '#' + placeNow, aria: 'You, ' + ordinal(placeNow) };
    });
    updateCars(track, race.entries, total, tags);

    if (phase === 'results') {
      stopRaceTimers();
      renderResults(view, race, isPractice);
      return;
    }

    if (!typing.startedAt && phase === 'racing') typing.startedAt = startMs;

    if (typing.finishedLocally || (me && me.finished)) {
      // You are across the line: a short wait shows the others still racing.
      if (!typing.finishedLocally) finishLocalTyping();
      renderWaiting(view, race, total);
      if (phase === 'racing') {
        typing.passage = typing.passage || race.passage || '';
      }
      tickRace();
      return;
    }

    if (!race.passage) {
      tickRace();
      return; // still waiting for the server's passage
    }
    typing.passage = race.passage;
    renderTypingArea(view, race, phase);
    tickRace();
  }

  // The 100 ms ticker: the HUD clock, the speed figure, the start light and
  // the gauge needle, all between polls. Only writes to elements that exist,
  // so it is safe to keep running while a render is between screens.
  function tickRace() {
    const race = lastRace;
    if (!race) return;
    const clockEl = document.getElementById('hud-clock-value');
    const wpmEl = document.getElementById('hud-wpm-value');
    if (!clockEl && !wpmEl) return;
    const startMs = race.startsAt ? Date.parse(race.startsAt) : null;
    const t = nowMs();
    const go = startMs != null && t >= startMs;

    // The clock: the countdown before Go, then the time left before the
    // server closes the race (a dash until closesAt arrives).
    if (clockEl) {
      if (!go && startMs != null) {
        clockEl.textContent = 'Starting in ' + Math.ceil((startMs - t) / 1000);
      } else if (race.closesAt) {
        clockEl.textContent = Typing.raceClock(Date.parse(race.closesAt) - t);
      } else {
        clockEl.textContent = '–';
      }
    }

    // The speed figure: the usual formula, 0 before Go, frozen once you
    // finish so the needle does not sag to zero while you wait.
    if (go && !typing.finishedLocally && typing.startedAt) {
      const correct = localTypingProgress();
      const elapsed = Math.max(1, t - typing.startedAt);
      lastWpm = Math.round(correct / 5 / (elapsed / 60000));
    }
    const wpm = go ? lastWpm : 0;
    if (wpmEl) wpmEl.textContent = String(wpm);

    // The start light and the needle.
    const stopDot = document.querySelector('#hud-wpm .signal-stop');
    const goDot = document.querySelector('#hud-wpm .signal-go');
    if (stopDot) stopDot.classList.toggle('signal-stop-on', !!startMs && !go);
    if (goDot) goDot.classList.toggle('signal-go-on', go);
    const needle = document.querySelector('#dash .needle-g');
    if (needle) needle.style.transform = 'rotate(' + (Typing.dialAngle(wpm) - 270) + 'deg)';

    // Go arrived while the field was still shut: re-render to open it.
    const field = document.getElementById('type-field');
    if (go && field && field.disabled && !typing.finishedLocally) {
      renderRace(lastRace, lastDemo);
    }
  }

  function localTypingProgress() {
    if (!typing.passage) return 0;
    const st = Typing.typingState(typing.passage, typing.committed, typing.lastValue);
    return Math.min(typing.passage.length, typing.committed + st.correct);
  }

  // The dashboard in the scene (gauge + passage strip) and the typing field
  // under the scene. The field holds the current word: it clears when the
  // word and its space are right, the familiar typing-race way.
  function renderTypingArea(view, race, phase) {
    const go = phase === 'racing';

    // The dashboard goes inside the scene, under the road.
    const scene = document.getElementById('scene');
    let dash = document.getElementById('dash');
    if (!dash && scene) {
      dash = dashNode();
      scene.appendChild(dash);
    }
    renderPassage();

    let fieldWrap = document.getElementById('field-wrap');
    if (!fieldWrap) {
      fieldWrap = el('div');
      fieldWrap.id = 'field-wrap';
      const field = el('input', 'field font-mono text-[20px]');
      field.id = 'type-field';
      field.type = 'text';
      field.enterKeyHint = 'done';
      field.autocapitalize = 'off';
      field.autocomplete = 'off';
      field.autocorrect = 'off';
      field.spellcheck = false;
      field.setAttribute('aria-label', 'Type the passage here');
      field.addEventListener('paste', (e) => e.preventDefault());
      field.addEventListener('drop', (e) => e.preventDefault());
      field.addEventListener('input', onType);
      fieldWrap.appendChild(field);
      const err = text('p', 'mt-1.5 text-small text-danger', 'Fix the red letters to keep moving.');
      err.id = 'field-err';
      err.hidden = true;
      fieldWrap.appendChild(err);
      view.appendChild(fieldWrap);
    }
    const field = document.getElementById('type-field');
    field.disabled = !go;
    if (go && document.activeElement !== field) field.focus();

    // Accuracy under the field; speed lives on the scene's HUD.
    let live = document.getElementById('live');
    if (!live) {
      live = el('p', 'font-mono text-small text-muted');
      live.id = 'live';
      view.appendChild(live);
    }
    updateLive();
  }

  function updateLive() {
    const live = document.getElementById('live');
    if (!live) return;
    live.textContent = '';
    live.appendChild(text('span', null,
      (typing.keystrokes ? Math.round((typing.correctKeys / typing.keystrokes) * 100) : 100) + '% accuracy'));
  }

  function renderPassage() {
    const strip = document.getElementById('strip');
    if (!strip) return;
    const parts = Typing.stripParts(typing.passage, typing.committed, typing.lastValue);
    const st = Typing.typingState(typing.passage, typing.committed, typing.lastValue);
    const line = clear(strip.firstElementChild);
    if (parts.ok) line.appendChild(text('span', 'ch-ok', parts.ok));
    if (parts.bad) line.appendChild(text('span', 'ch-bad', parts.bad));
    line.appendChild(text('span', 'caret', ''));
    line.appendChild(text('span', 'ch-rest', parts.rest));
    // The line slides left so the caret stays in view; --at is in characters.
    line.style.setProperty('--at', String(parts.at));
    const field = document.getElementById('type-field');
    const err = document.getElementById('field-err');
    if (field) field.classList.toggle('field-error', !!st.wrong);
    if (err) err.hidden = !st.wrong;
  }

  function onType() {
    const field = document.getElementById('type-field');
    if (!field || field.disabled) return;
    const value = field.value;
    const prev = typing.lastValue;

    // Count the keystrokes that appeared (deletions are not new strokes).
    if (value.length > prev.length && value.startsWith(prev)) {
      const added = value.slice(prev.length);
      for (let i = 0; i < added.length; i++) {
        const at = typing.committed + prev.length + i;
        typing.keystrokes++;
        if (added[i] === typing.passage[at]) typing.correctKeys++;
      }
    }
    typing.lastValue = value;

    const st = Typing.typingState(typing.passage, typing.committed, value);
    if (st.wordComplete) {
      typing.committed += value.length;
      field.value = '';
      typing.lastValue = '';
      if (st.done) {
        renderPassage();
        finishLocalTyping();
        postProgress(true);
        return;
      }
    }
    renderPassage();
    renderTypingArea(document.getElementById('race-view'), null, 'racing');
    updateLive();
    postProgress(false);
  }

  function finishLocalTyping() {
    typing.finishedLocally = true;
    typing.committed = typing.passage.length;
    const field = document.getElementById('type-field');
    if (field) { field.disabled = true; field.value = ''; field.blur(); }
  }

  // Progress goes to the server as you type: on every word and at most about
  // once a second otherwise. A failed post is not queued; the next one
  // carries the latest totals.
  async function postProgress(force) {
    const raceId = typing.raceId;
    if (!raceId || typing.finishedLocally && !force) return;
    const now = Date.now();
    if (!force && now - typing.lastPostAt < 1000) return;
    typing.lastPostAt = now;
    const progress = Math.min(typing.passage.length, localTypingProgress());
    try {
      const body = await api('/api/races/' + raceId + '/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progress: typing.finishedLocally ? typing.passage.length : progress,
          keystrokes: typing.keystrokes,
          correctKeys: typing.correctKeys,
        }),
      });
      if (body && body.race && typing.raceId === raceId) {
        absorbServerNow(body.serverNow);
        renderRace(body.race, IS_DEMO);
      }
    } catch (_) { /* dropped; the next poll or post carries the state */ }
  }

  function renderWaiting(view, race, total) {
    const dash = document.getElementById('dash');
    if (dash) dash.remove(); // the gauge and strip go; the HUD and cars stay
    const fieldWrap = document.getElementById('field-wrap');
    if (fieldWrap) fieldWrap.remove();
    let wait = document.getElementById('waiting');
    if (!wait) {
      wait = el('div', 'card flex flex-col items-center gap-1.5 py-6 text-center');
      wait.id = 'waiting';
      const mark = el('span', 'badge badge-win h-12 w-12');
      mark.innerHTML = FLAG_SVG;
      mark.querySelector('svg').classList.add('h-6', 'w-6');
      wait.appendChild(mark);
      wait.appendChild(text('p', 'text-body font-medium', 'You crossed the line.'));
      wait.appendChild(text('p', 'text-small text-muted', 'The others are still racing.'));
      view.appendChild(wait);
    }
    const live = document.getElementById('live');
    if (live) live.remove();
    const closeMs = race.closesAt ? Date.parse(race.closesAt) - nowMs() : null;
    const note = wait.lastElementChild;
    if (note && closeMs != null && closeMs > 0) {
      note.textContent = 'The others are still racing, results in ' + Math.ceil(closeMs / 1000) + ' s.';
    }
  }

  // ── Results ──────────────────────────────────────────────────────────────

  function renderResults(view, race, isPractice) {
    document.getElementById('waiting') && document.getElementById('waiting').remove();
    let results = document.getElementById('results');
    if (results && results.dataset.raceId === String(race.id)) return;
    if (results) results.remove();

    const card = document.getElementById('passage-card');
    if (card) card.remove();
    const fieldWrap = document.getElementById('field-wrap');
    if (fieldWrap) fieldWrap.remove();
    const dash = document.getElementById('dash');
    if (dash) dash.remove();
    // The clock and speed figure are over: the HUD fades out of the sky.
    const hud = document.getElementById('hud');
    if (hud) hud.hidden = true;
    const live = document.getElementById('live');
    if (live) live.remove();
    const recon = document.getElementById('reconnect');
    if (recon) recon.remove();

    results = el('section', 'flex flex-col gap-3');
    results.id = 'results';
    results.dataset.raceId = race.id;

    const listWrap = el('div');
    listWrap.appendChild(text('h2', 'section-label', 'Results'));
    const list = el('ul', 'list');
    const ordered = race.entries.slice().sort((a, b) => (a.place || 99) - (b.place || 99) || a.lane - b.lane);
    for (const e of ordered) {
      const row = el('li', 'list-row');
      const badge = el('span', 'badge' + (e.place === 1 ? ' badge-win' : ''));
      if (e.place === 1) {
        badge.textContent = '1st';
        const flag = text('span', 'sr-only', 'Winner');
        row.appendChild(badge);
        row.appendChild(flag);
      } else {
        badge.textContent = e.outOfTime ? '–' : ordinal(e.place);
        row.appendChild(badge);
      }
      const main = el('div', 'min-w-0 flex-1');
      main.appendChild(text('p', 'truncate text-body', e.isYou ? 'You' : e.username));
      main.appendChild(text('p', 'text-small text-muted',
        e.outOfTime ? 'Out of time, ' + Math.round((e.progress / Math.max(1, race.total)) * 100) + '% typed'
          : e.place === 1 ? 'Winner' : ''));
      row.appendChild(main);
      const end = el('div', 'text-right');
      if (e.outOfTime) {
        end.appendChild(text('p', 'text-small text-muted', 'Out of time'));
      } else {
        const speed = el('p', 'font-mono text-body');
        speed.appendChild(document.createElement('b')).textContent = e.wpm != null ? e.wpm : '–';
        speed.appendChild(document.createTextNode(' wpm'));
        end.appendChild(speed);
        end.appendChild(text('p', 'font-mono text-small text-muted',
          e.accuracy != null ? e.accuracy + '%' : ''));
      }
      row.appendChild(end);
      list.appendChild(row);
    }
    listWrap.appendChild(list);
    results.appendChild(listWrap);

    const again = el('button', 'btn-primary w-full');
    again.textContent = isPractice ? 'Practice again' : 'Race again';
    again.addEventListener('click', () => actions.practiceAgain(isPractice));
    results.appendChild(again);
    const back = el('button', 'btn-secondary w-full');
    back.textContent = 'Back to lobby';
    back.addEventListener('click', actions.backToLobby);
    results.appendChild(back);

    view.appendChild(results);
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  let homeTimer = null;
  let home = null;
  let lastHomeShape = '';

  function stopHomeTimer() {
    if (homeTimer) { clearInterval(homeTimer); homeTimer = null; }
  }

  async function pollHome() {
    if (document.hidden) return;
    let data;
    try {
      data = await api('/api/home');
    } catch (err) {
      if (!home) renderError(pollHome);
      return;
    }
    absorbServerNow(data.serverNow);
    const first = !home;
    // Ignore the ticking serverNow when deciding whether anything changed,
    // so the lobby DOM is only rebuilt when its data actually moved.
    const shape = JSON.stringify(Object.assign({}, data, { serverNow: 0 }));
    const changed = shape !== lastHomeShape;
    lastHomeShape = shape;
    home = data;
    // Somebody (you or another racer) started your race: switch to it.
    if (data.activeRaceId && (!typing.raceId || typing.finishedLocally)) {
      stopHomeTimer();
      enterRace(data.activeRaceId, 'race');
      return;
    }
    if (typing.raceId && !typing.finishedLocally) return; // racing: stay put
    if (first || changed || !document.getElementById('lobby-view')) {
      renderLobby(data, actions);
    }
  }

  function showLobby() {
    stopRaceTimers();
    typing.raceId = null;
    typing.finishedLocally = false;
    if (home) renderLobby(home, actions);
    stopHomeTimer();
    pollHome();
    homeTimer = setInterval(pollHome, 1000);
  }

  const actions = {
    async join() {
      try {
        const r = await api('/api/lobby/join', { method: 'POST' });
        home = null;
        await pollHome();
        if (r && r.raceId) { /* stay in the lobby; the grid now shows you */ }
      } catch (err) {
        toastJoinError(err);
      }
    },
    async leave(raceId) {
      try {
        await api('/api/races/' + raceId + '/leave', { method: 'POST' });
        home = null;
        await pollHome();
      } catch (err) {
        toast('Could not leave the race. Try again.');
      }
    },
    async start(raceId) {
      try {
        const r = await api('/api/races/' + raceId + '/start', { method: 'POST' });
        stopHomeTimer();
        enterRace(raceId, 'race');
      } catch (err) {
        if (err.code === 'need_two') toast('One racer is not enough. Wait for another to join.');
        else if (err.code === 'already_started') enterRace(raceId, 'race');
        else toast('Could not start the race. Try again.');
      }
    },
    async practice() {
      try {
        const r = await api('/api/practice', { method: 'POST' });
        stopHomeTimer();
        enterRace(r.raceId, 'practice');
      } catch (err) {
        toast('Could not start practice. Try again.');
      }
    },
    async practiceAgain(isPractice) {
      if (isPractice) { this.practice(); return; }
      this.join();
      // Joining the next grid returns you to the lobby view; the race
      // starts from there like any other.
      showLobby();
    },
    async openRace(raceId) {
      stopHomeTimer();
      enterRace(raceId, 'race');
    },
    backToLobby() {
      showLobby();
    },
  };

  function toastJoinError(err) {
    if (err.status === 401) toast('Make an account to join the race.');
    else if (err.code === 'race_full') toast('This race is full. Join the next one when it starts.');
    else if (err.code === 'in_race') toast('You are already racing.');
    else toast('Could not join the race. Try again.');
  }

  // Resume polling the moment the page is visible again.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (typing.raceId && !typing.finishedLocally) pollRace(typing.raceId);
      else pollHome();
    }
  });

  renderLoading();
  pollHome();
  homeTimer = setInterval(pollHome, 1000);
})();