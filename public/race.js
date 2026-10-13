/*
 * Race driver and view for the play screen's street scene.
 *
 * The scene renders from one small race state (the data contract: per-racer
 * progress and lane, viewer rank, live WPM, time remaining, sentence and
 * typed count, race phase). A future multiplayer engine can replace
 * startRace/input handling with the same contract; the view functions would
 * not change.
 *
 * On this branch the race is solo against in-page demo racers: there is no
 * backend yet, so opponents are simulated locally. Car positions move by
 * transform only; the typing bar's spans are the only per-keystroke work.
 */
(function () {
  'use strict';

  var scene = document.querySelector('[data-race-scene]');
  if (!scene) return;

  var carsEl = scene.querySelector('[data-cars]');
  var wpmEl = scene.querySelector('[data-wpm]');
  var timerEl = scene.querySelector('[data-timer]');
  var needle = scene.querySelector('[data-needle]');
  var typebar = scene.querySelector('[data-typebar]');
  var textEl = scene.querySelector('[data-typebar-text]');
  var typedEl = scene.querySelector('[data-typed]');
  var caretEl = scene.querySelector('[data-caret]');
  var todoEl = scene.querySelector('[data-todo]');
  var input = scene.querySelector('[data-race-input]');
  var hint = scene.querySelector('[data-start-hint]');
  var countEl = scene.querySelector('[data-count]');
  var resultEl = scene.querySelector('[data-result]');
  var resultTitle = scene.querySelector('[data-result-title]');
  var resultSub = scene.querySelector('[data-result-sub]');
  var againBtn = scene.querySelector('[data-race-again]');
  var srEl = document.querySelector('[data-sr]');

  var SENTENCES = [
    'Steady hands win races, so keep your eyes on the sentence and your fingers moving.',
    'The quick brown fox jumps over the lazy dog while the race roars past the stands.',
    'Type every word cleanly: one wrong key costs more time than one slow key ever will.',
    'Racing is won in the middle, where the road is long and the fingers start to tire.',
    'Green lights, grey asphalt and a long sentence ahead: this is how a battle begins.',
    'Practice makes permanent, so type the sentence exactly as it is written on screen.'
  ];

  // In-page demo racers. Live multiplayer replaces these with real opponents
  // once the race engine and server land; they are not database rows. Each
  // has a lane and a rolling-start position so the rest state is readable:
  // nothing overlapping, and clear of the dial in the road's bottom-left.
  var BOTS = [
    { name: 'TurboOtter995', wpm: 88, lane: 0, start: 0.12 },
    { name: 'NightHeron', wpm: 71, lane: 1, start: 0.18 },
    { name: 'QuietKoala', wpm: 37, lane: 3, start: 0.34 },
    { name: 'MothMobile', wpm: 23, lane: 0, start: 0.38 }
  ];

  var LANE_TOPS = [1, 19, 37, 55]; // % of the road band; the typing bar owns the bottom third
  var BUBBLE_FLIP = 0.14; // flip labels to the car's right below this progress
  var RACE_SECONDS = 25;
  var WPM_MAX = 120;
  var COUNT_BEATS = ['3', '2', '1', 'GO'];
  var COUNT_BEAT_MS = 420;
  var ANCHOR = 0.3; // caret rests at 30% of the bar's width once text scrolls

  var state = null;
  var lastFrame = 0;

  function viewerName() {
    // The platform injects the signed-in user's token into the iframe URL;
    // its payload (readable, not verified here — display only) has the name.
    try {
      var m = location.search.match(/[?&]token=([^&]+)/);
      if (!m) return 'You';
      var b64 = m[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var json = decodeURIComponent(atob(b64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json).username || 'You';
    } catch (e) {
      return 'You';
    }
  }

  function formatTime(seconds) {
    var s = Math.max(0, seconds);
    var sec = Math.floor(s);
    var tenth = Math.floor((s - sec) * 10);
    return '0:' + String(sec).padStart(2, '0') + '.' + tenth;
  }

  function buildCar(racer) {
    var car = document.createElement('div');
    car.className = 'scene-car';
    car.dataset.colour = racer.colour;
    car.style.top = LANE_TOPS[racer.lane] + '%';

    var bubble = document.createElement('span');
    bubble.className = 'scene-bubble';
    bubble.textContent = racer.name;
    car.appendChild(bubble);
    racer.bubbleEl = bubble;

    var body = document.createElement('i');
    body.className = 'car-body';
    car.appendChild(body);

    var cabin = document.createElement('i');
    cabin.className = 'car-cabin';
    car.appendChild(cabin);

    var wheelF = document.createElement('i');
    wheelF.className = 'car-wheel car-wheel-f';
    car.appendChild(wheelF);

    var wheelR = document.createElement('i');
    wheelR.className = 'car-wheel car-wheel-r';
    car.appendChild(wheelR);

    if (racer.you) {
      var rank = document.createElement('span');
      rank.className = 'scene-rank';
      rank.textContent = '#1';
      car.appendChild(rank);
      racer.rankEl = rank;
    }
    racer.el = car;
    carsEl.appendChild(car);
  }

  function positionCars() {
    var trackWidth = carsEl.clientWidth;
    state.racers.forEach(function (racer) {
      var carWidth = racer.el.offsetWidth || 96;
      var x = Math.min(1, Math.max(0, racer.progress)) * (trackWidth - carWidth);
      racer.el.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
      // Keep the label inside the scene: flip to the car's right side while
      // the car is near the left edge.
      var flip = racer.progress < BUBBLE_FLIP;
      racer.bubbleEl.classList.toggle('scene-bubble-right', flip);
      if (racer.rankEl) racer.rankEl.classList.toggle('scene-rank-right', flip);
    });
  }

  function renderTypingBar() {
    typedEl.textContent = state.sentence.slice(0, state.correct);
    todoEl.textContent = state.sentence.slice(state.correct);
    var anchor = typebar.clientWidth * ANCHOR;
    var caretX = caretEl.offsetLeft;
    textEl.style.transform = 'translateX(' + Math.min(0, anchor - caretX).toFixed(1) + 'px)';
  }

  function setWpm(wpm) {
    // The dial reads 0–120; the pill matches it (a faster typist pins the
    // needle at the top, as a real speedometer does).
    var shown = Math.min(WPM_MAX, wpm);
    state.wpm = wpm;
    wpmEl.textContent = String(Math.round(shown));
    var angle = -130 + (shown / WPM_MAX) * 180;
    needle.style.transform = 'translateX(-50%) rotate(' + angle.toFixed(1) + 'deg)';
  }

  function setRank() {
    var sorted = state.racers.slice().sort(function (a, b) { return b.progress - a.progress; });
    var you = state.racers.filter(function (r) { return r.you; })[0];
    var rank = sorted.indexOf(you) + 1;
    if (you.rankEl) you.rankEl.textContent = '#' + rank;
    state.viewerRank = rank;
  }

  function finish(message) {
    state.phase = 'finished';
    scene.dataset.state = 'finished';
    hint.hidden = true;
    countEl.hidden = true;
    setRank();
    resultTitle.textContent = (message ? message + ' ' : '') + 'You finished #' + state.viewerRank + '.';
    resultSub.textContent = Math.round(state.wpm) + ' WPM · ' + state.sentence.split(' ').length + ' words';
    resultEl.hidden = false;
    if (srEl) srEl.textContent = 'Race finished. You placed #' + state.viewerRank + ' at ' + Math.round(state.wpm) + ' WPM.';
    input.blur();
  }

  function startCountIn(buffered) {
    state.phase = 'counting';
    state.buffer = buffered || '';
    scene.dataset.state = 'counting';
    hint.hidden = true;
    countEl.hidden = false;
    var beat = 0;
    countEl.textContent = COUNT_BEATS[beat];
    var timer = setInterval(function () {
      beat += 1;
      if (beat < COUNT_BEATS.length) {
        countEl.textContent = COUNT_BEATS[beat];
        return;
      }
      clearInterval(timer);
      go();
    }, COUNT_BEAT_MS);
  }

  function go() {
    state.phase = 'running';
    state.startedAt = performance.now();
    scene.dataset.state = 'running';
    countEl.hidden = true;
    // Characters typed during the count-in still count.
    if (state.buffer) applyChars(state.buffer);
    state.buffer = '';
  }

  function applyChars(chars) {
    for (var i = 0; i < chars.length; i++) {
      if (state.correct >= state.sentence.length) break;
      if (chars[i] === state.sentence[state.correct]) {
        state.correct += 1;
      } else {
        // A wrong key does not advance; flash the bar and drop the char.
        typebar.classList.remove('typebar-wrong');
        void typebar.offsetWidth;
        typebar.classList.add('typebar-wrong');
      }
    }
    renderTypingBar();
    caretEl.classList.remove('typebar-caret-idle');
    if (state.correct >= state.sentence.length) {
      finish('');
    }
  }

  input.addEventListener('input', function (e) {
    var added = e.data || input.value;
    input.value = '';
    if (!added) return;
    if (state.phase === 'ready') startCountIn(added);
    else if (state.phase === 'counting') state.buffer += added;
    else if (state.phase === 'running') applyChars(added);
  });

  // "Press any key": a bare keydown (Enter, arrows) also starts the race.
  // A printable key is NOT prevented: the input event carries it into the
  // count-in buffer, so the first character is never lost.
  input.addEventListener('keydown', function (e) {
    if (state.phase !== 'ready' || e.key === 'Tab') return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return;
    e.preventDefault();
    startCountIn('');
  });

  typebar.addEventListener('mousedown', function (e) { e.preventDefault(); });
  scene.addEventListener('click', function () { focusInput(); });
  againBtn.addEventListener('click', function () { newRace(); });

  function focusInput() {
    if (state.phase !== 'finished') input.focus({ preventScroll: true });
  }

  function newRace() {
    var sentence = SENTENCES[Math.floor(Math.random() * SENTENCES.length)];
    state = {
      sentence: sentence,
      correct: 0,
      buffer: '',
      phase: 'ready',
      startedAt: 0,
      wpm: 0,
      viewerRank: 1,
      racers: []
    };
    // The viewer first; demo racers follow, spread along the road like a
    // rolling start so nothing overlaps the dial or the typing bar at rest.
    // A narrow track (phones) starts everyone further along so the cars
    // clear the dial, which is proportionally larger there.
    var bump = carsEl.clientWidth < 520 ? 0.2 : 0;
    state.racers.push({ you: true, name: viewerName(), progress: 0.06, lane: 2, colour: 1 });
    BOTS.forEach(function (bot, i) {
      state.racers.push({
        you: false,
        name: bot.name,
        baseWpm: bot.wpm,
        wobble: Math.random() * 6,
        progress: bot.start + bump,
        lane: bot.lane,
        colour: (i + 1) % 6 + 1
      });
    });
    carsEl.textContent = '';
    state.racers.forEach(buildCar);
    typedEl.textContent = '';
    todoEl.textContent = sentence;
    textEl.style.transform = 'translateX(0)';
    caretEl.classList.add('typebar-caret-idle');
    setWpm(0);
    timerEl.textContent = formatTime(RACE_SECONDS);
    scene.dataset.state = 'ready';
    hint.hidden = false;
    countEl.hidden = true;
    resultEl.hidden = true;
    input.value = '';
    positionCars();
    setRank();
    focusInput();
  }

  function tick(now) {
    if (state && state.phase === 'running') {
      var elapsed = (now - state.startedAt) / 1000;
      var dt = Math.min(0.1, (now - lastFrame) / 1000);
      state.racers.forEach(function (racer) {
        if (racer.you) {
          // A small visual head start keeps your car clear of the dial;
          // finishing still lands exactly at the scene's right edge.
          racer.progress = 0.04 + 0.96 * (state.correct / state.sentence.length);
        } else {
          // Demo racers advance at their target speed with a gentle wobble.
          // wpm → chars per second is wpm × 5 / 60; progress is chars typed
          // over the sentence length.
          var speed = racer.baseWpm * 5 / 60 / state.sentence.length * (0.85 + 0.15 * Math.sin(elapsed * 0.9 + racer.wobble));
          racer.progress = Math.min(1, racer.progress + speed * dt);
        }
      });
      var minutes = Math.max(elapsed, 1.5) / 60; // brief ramp after GO
      var wpm = (state.correct / 5) / minutes;
      // Smooth so the pill and needle read calmly.
      setWpm(state.wpm === 0 ? wpm : state.wpm * 0.7 + wpm * 0.3);
      var remaining = RACE_SECONDS - elapsed;
      timerEl.textContent = formatTime(remaining);
      positionCars();
      setRank();
      if (remaining <= 0) finish('Time!');
    }
    lastFrame = now;
    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', function () {
    if (state) { positionCars(); renderTypingBar(); }
  });

  newRace();
  requestAnimationFrame(tick);
})();
