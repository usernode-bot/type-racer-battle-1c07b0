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

  // A stable tag for this browser, sent with every progress post so the
  // server can tell a resend of this device from an update of another.
  // Saved in localStorage and reused across races; when storage is
  // unavailable (some private modes) the id lives only for this page visit.
  let memoryClientId = null;
  function clientId() {
    const generate = () => {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    };
    try {
      let id = localStorage.getItem('trb.clientId');
      if (!id) {
        id = generate();
        localStorage.setItem('trb.clientId', id);
      }
      return id;
    } catch (_) {
      if (!memoryClientId) memoryClientId = generate();
      return memoryClientId;
    }
  }

  // The running number for the current race: starts at 1 with the race, +1
  // per post, saved in localStorage so a reload mid-race continues above the
  // server's watermark instead of looking stale and being dropped. Only the
  // current race's counter is kept. With storage unavailable, the in-memory
  // counter that enterRace resets stands in.
  let memorySeq = 0;
  function nextSeq(raceId) {
    try {
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem('trb.seq') || 'null'); } catch (_) { /* corrupt value: start over */ }
      const seq = (stored && stored.raceId === raceId && Number.isInteger(stored.seq) ? stored.seq : 0) + 1;
      localStorage.setItem('trb.seq', JSON.stringify({ raceId, seq }));
      return seq;
    } catch (_) {
      return ++memorySeq;
    }
  }

  // The SVG car, drawn once in its lane's livery (the colour comes from a
  // whole-literal class on the svg, so Tailwind's extractor sees it).
  const CAR_SVG =
    '<svg viewBox="0 0 30 24" aria-hidden="true"><path class="body" d="M2 17v-4l4-1.5L10 7h8l5 4.5 4 1V17z"/><path class="glass" d="M11 9h6l3 3H9z"/><circle class="wheel" cx="8" cy="17.5" r="2.5"/><circle class="wheel" cx="22" cy="17.5" r="2.5"/></svg>';
  // Whole literals so the compiler keeps them; chosen by lane % 6.
  const CAR_CLASSES = ['text-car-1', 'text-car-2', 'text-car-3', 'text-car-4', 'text-car-5', 'text-car-6'];

  const STOPWATCH_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7"/><path d="M12 14V10.5M10 3h4M12 3v4"/></svg>';
  const FLAG_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h13l-2 4.5 2 4.5H5"/><path d="M9 4v9M13 4v9M5 8.5h12"/></svg>';

  function carNode(lane) {
    const wrap = document.createElement('span');
    wrap.innerHTML = CAR_SVG;
    const svg = wrap.firstChild;
    svg.setAttribute('class', 'car ' + CAR_CLASSES[((lane % 6) + 6) % 6]);
    return svg;
  }

  // The track: one lane per racer plus, in the lobby, one open lane. The car
  // moves by an inline `left`, which the .car component transitions between
  // polls.
  function trackNode(entries, opts) {
    opts = opts || {};
    const track = el('div', 'track');
    for (const e of entries) {
      const thin = opts.thin;
      const lane = el('div', 'lane' + (thin ? ' lane-thin' : '') + (e.isYou ? ' lane-you' : ''));
      lane.appendChild(text('span', 'lane-label', e.isYou ? 'You' : e.username));
      const run = el('div', 'lane-run');
      if (opts.withCars) {
        const car = carNode(e.lane);
        car.style.left = carLeft(e.progress, opts.total);
        run.appendChild(car);
      }
      lane.appendChild(run);
      track.appendChild(lane);
    }
    if (opts.openLane) {
      const lane = el('div', 'lane' + (opts.thin ? ' lane-thin' : ''));
      lane.appendChild(text('span', 'lane-label', 'Open lane'));
      lane.appendChild(el('div', 'lane-run'));
      track.appendChild(lane);
    }
    return track;
  }

  // progress 0…total → left offset inside the lane, stopping short of the
  // checkered finish (8px) plus a little margin.
  function carLeft(progress, total) {
    const frac = total ? Math.max(0, Math.min(1, progress / total)) : 0;
    return 'calc((100% - 46px) * ' + frac.toFixed(4) + ' + 4px)';
  }

  function updateCars(track, entries, total) {
    const cars = track.querySelectorAll('.car');
    entries.forEach((e, i) => {
      if (cars[i]) cars[i].style.left = carLeft(e.progress, total);
    });
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
    const local = (window.usernode && window.usernode.now ? window.usernode.now() : Date.now());
    const dayStart = new Date(local); dayStart.setHours(0, 0, 0, 0);
    const days = Math.floor((dayStart - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days <= 0) return 'Today, ' + time;
    if (days === 1) return 'Yesterday, ' + time;
    return d.toLocaleDateString([], { weekday: 'long' }) + ', ' + time;
  }

  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // The server's clock, offset onto the page's own (the bridge's usernode.now
  // when the bridge is around, the local clock otherwise).
  let serverOffsetMs = 0; // serverNow - localNow
  function nowMs() {
    return (window.usernode && window.usernode.now ? window.usernode.now() : Date.now()) + serverOffsetMs;
  }
  function absorbServerNow(iso) {
    if (!iso) return;
    const local = window.usernode && window.usernode.now ? window.usernode.now() : Date.now();
    serverOffsetMs = Date.parse(iso) - local;
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
    app.appendChild(headerNode());
    const card = el('section', 'card flex flex-col gap-3.5');
    card.appendChild(el('div', 'card-head flex items-baseline justify-between', [
      text('h2', 'text-heading', 'Next race'),
      el('span', 'skeleton h-4 w-20'),
    ]));
    for (let i = 0; i < 3; i++) card.appendChild(el('div', 'skeleton h-9 w-full'));
    card.appendChild(el('div', 'skeleton h-11 w-full rounded-lg'));
    app.appendChild(card);
    app.appendChild(el('div', 'skeleton h-11 w-full rounded-lg'));
    app.appendChild(el('div', 'skeleton h-20 w-full rounded-xl'));
  }

  function renderError(retry) {
    clear(app);
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
      card.appendChild(trackNode(lobby.racers, {
        withCars: true,
        openLane: count < lobby.max,
        thin: lobby.racers.length + 1 >= 9,
        total: 0,
      }));
    } else {
      // One full-width open lane, same structure as the populated grid, with
      // the note left-aligned under it on the card's own padding.
      const empty = el('div', 'flex flex-col gap-3');
      empty.appendChild(trackNode([], { openLane: true }));
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
  let tickTimer = null; // 250 ms clock
  let reconnecting = false;

  function stopRaceTimers() {
    if (raceTimer) { clearInterval(raceTimer); raceTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function enterRace(raceId, kind) {
    stopRaceTimers();
    memorySeq = 0; // storageless fallback counter starts over with the race
    Object.assign(typing, {
      raceId, kind,
      passage: '', committed: 0, keystrokes: 0, correctKeys: 0,
      startedAt: null, finishedLocally: false, lastValue: '', lastPostAt: 0,
    });
    pollRace(raceId);
    raceTimer = setInterval(() => pollRace(raceId), 1000);
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
    const startMs = race.startsAt ? Date.parse(race.startsAt) : null;
    const t = nowMs();
    const phase = race.status === 'finished' ? 'results'
      : startMs && t < startMs ? 'countdown' : 'racing';
    const isPractice = race.kind === 'practice';

    const existing = document.getElementById('race-view');
    const sameRace = existing && existing.dataset.raceId === String(race.id);

    if (!sameRace) {
      clear(app);
      const view = el('div', 'flex flex-col gap-4');
      view.id = 'race-view';
      view.dataset.raceId = race.id;
      if (demo) view.appendChild(demoLine());
      app.appendChild(view);
    }
    const view = document.getElementById('race-view');

    // Head: title, field size and your running place, clock on the right.
    const me = race.entries.find((e) => e.isYou);
    const ranked = race.entries.slice().sort((a, b) => b.progress - a.progress || a.lane - b.lane);
    const myPlace = me ? ranked.indexOf(me) + 1 : 0;
    const head = el('div', 'flex min-h-11 items-center justify-between');
    const headMain = el('div');
    headMain.appendChild(text('h2', 'text-heading', isPractice ? 'Practice' : 'Race'));
    headMain.appendChild(text('p', 'text-small text-muted',
      race.entries.length + (race.entries.length === 1 ? ' racer' : ' racers') +
      (me && race.entries.length > 1 ? ' · you are ' + ordinal(myPlace).toLowerCase() : '')));
    head.appendChild(headMain);
    const clockEl = el('p', 'font-mono text-[28px] font-bold leading-9');
    clockEl.id = 'race-clock';
    head.appendChild(clockEl);
    const slot = el('div', 'race-head-slot');
    slot.appendChild(head);
    const oldHead = view.querySelector('.race-head-slot');
    if (oldHead) oldHead.replaceWith(slot);
    else {
      const demo = view.querySelector('p');
      if (demo) demo.after(slot); else view.insertBefore(slot, view.firstChild);
    }

    // Reconnecting line, quiet, under the head.
    let recon = document.getElementById('reconnect');
    if (!recon) {
      recon = text('p', 'text-small text-muted', 'Reconnecting…');
      recon.id = 'reconnect';
      recon.hidden = true;
      view.appendChild(recon);
    }

    // The track, every car on it.
    const total = race.total || 0;
    let track = view.querySelector('.track');
    if (!track || track.childElementCount !== race.entries.length) {
      if (track) track.replaceWith(trackNode(race.entries, { withCars: true, thin: race.entries.length >= 9, total }));
      else view.appendChild(trackNode(race.entries, { withCars: true, thin: race.entries.length >= 9, total }));
      track = view.querySelector('.track');
    }
    if (me) {
      // Your car follows your local typing, which is ahead of the last poll.
      const localProgress = localTypingProgress();
      me.progress = Math.max(me.progress, localProgress);
    }
    updateCars(track, race.entries, total);

    if (phase === 'results') {
      stopRaceTimers();
      renderResults(view, race, isPractice);
      return;
    }

    // Clock text: the countdown before Go, then the race time.
    if (phase === 'countdown') {
      clockEl.textContent = 'Starting in ' + Math.ceil((startMs - t) / 1000);
    } else {
      clockEl.textContent = clock(t - startMs);
      if (!typing.startedAt) typing.startedAt = startMs;
    }

    if (typing.finishedLocally || (me && me.finished)) {
      // You are across the line: a short wait shows the others still racing.
      if (!typing.finishedLocally) finishLocalTyping();
      renderWaiting(view, race, total);
      if (phase === 'racing') {
        typing.passage = typing.passage || race.passage || '';
      }
      return;
    }

    if (!race.passage) return; // still waiting for the server's passage
    typing.passage = race.passage;
    renderTypingArea(view, race, phase);
  }

  function localTypingProgress() {
    if (!typing.passage) return 0;
    const st = Typing.typingState(typing.passage, typing.committed, typing.lastValue);
    return Math.min(typing.passage.length, typing.committed + st.correct);
  }

  // The passage card and the typing field. The field holds the current word:
  // it clears when the word and its space are right, the familiar
  // typing-race way.
  function renderTypingArea(view, race, phase) {
    const total = race.total || typing.passage.length;
    const go = phase === 'racing';

    let card = document.getElementById('passage-card');
    if (!card) {
      card = el('div', 'card');
      card.id = 'passage-card';
      const passage = el('p', 'passage');
      passage.id = 'passage';
      card.appendChild(passage);
      view.appendChild(card);
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

    // Live figures under the field.
    let live = document.getElementById('live');
    if (!live) {
      live = el('p', 'flex justify-between font-mono text-small text-muted');
      live.id = 'live';
      view.appendChild(live);
    }
    const st = Typing.typingState(typing.passage, typing.committed, typing.lastValue);
    const correct = typing.committed + st.correct;
    const elapsed = typing.startedAt ? Math.max(1, nowMs() - typing.startedAt) : 1;
    live.textContent = '';
    // Two spans, not bare text nodes: a flex box wraps adjacent text into one
    // anonymous item, which would leave justify-between nothing to space out.
    live.appendChild(text('span', null,
      Math.round(correct / 5 / (elapsed / 60000)) + ' wpm'));
    live.appendChild(text('span', null,
      (typing.keystrokes ? Math.round((typing.correctKeys / typing.keystrokes) * 100) : 100) + '% accuracy'));
  }

  function renderPassage() {
    const passage = document.getElementById('passage');
    if (!passage) return;
    const st = Typing.typingState(typing.passage, typing.committed, typing.lastValue);
    const okEnd = typing.committed + st.correct;
    clear(passage);
    if (okEnd > 0) passage.appendChild(text('span', 'ch-ok', typing.passage.slice(0, okEnd)));
    if (st.wrong) {
      passage.appendChild(text('span', 'ch-bad',
        typing.passage.slice(okEnd + st.wrong.start, okEnd + st.wrong.end)));
    }
    passage.appendChild(text('span', 'ch-rest caret', typing.passage.slice(okEnd)));
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
    renderTypingArea(document.getElementById('race-view'), { total: typing.passage.length }, 'racing');
    const liveEl = document.getElementById('live');
    if (liveEl) {
      const correct = localTypingProgress();
      const elapsed = typing.startedAt ? Math.max(1, nowMs() - typing.startedAt) : 1;
      liveEl.textContent = '';
      liveEl.appendChild(text('span', null,
        Math.round(correct / 5 / (elapsed / 60000)) + ' wpm'));
      liveEl.appendChild(text('span', null,
        (typing.keystrokes ? Math.round((typing.correctKeys / typing.keystrokes) * 100) : 100) + '% accuracy'));
    }
    postProgress(false);
  }

  function finishLocalTyping() {
    typing.finishedLocally = true;
    typing.committed = typing.passage.length;
    const field = document.getElementById('type-field');
    if (field) { field.disabled = true; field.value = ''; field.blur(); }
  }

  // Progress goes to the server as you type: on every word and at most about
  // once a second otherwise. Each post is stamped with a running number and
  // this browser's id; the server applies each stamp once and ignores a
  // repeat or one that arrives after a newer one, so a resent or delayed
  // post can never move the car. A failed post is not queued; the next one
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
          seq: nextSeq(raceId),
          clientId: clientId(),
        }),
      });
      if (body && body.race && typing.raceId === raceId) {
        absorbServerNow(body.serverNow);
        renderRace(body.race, IS_DEMO);
      }
    } catch (_) { /* dropped; the next poll or post carries the state */ }
  }

  function renderWaiting(view, race, total) {
    const card = document.getElementById('passage-card');
    if (card) card.remove();
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