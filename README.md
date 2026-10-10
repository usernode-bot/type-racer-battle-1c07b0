# Type Racer Battle

Race by typing: a sentence appears in the bar at the bottom of the race
scene, and the faster and more accurately you type it, the faster your car
goes down a four-lane street scene — past a city skyline, under a traffic
light, with a speedometer dial and a live WPM pill. Today the race is solo
against in-page demo racers; live 2–20 player racing is the next step.

## How it works

- `public/index.html` — the play screen: the race scene (sky, skyline,
  treeline, barrier, road, HUD pills, speedometer, typing bar), all drawn
  with CSS.
- `public/race.js` — the race driver and view: typing input, WPM, countdown,
  car positions and ranks. It renders from one small race state, so a
  multiplayer engine can feed the same contract later.
- `styles/tailwind-input.css` — the design kit (buttons, fields, lists,
  cards, states) plus the race scene's fixed-look palette and components.
- `server.js` — the platform plumbing: auth, static files, hosted assets.

## Styling

Tailwind is precompiled by `npm run build` during the image build
(`styles/tailwind-input.css` → `public/tailwind.css`). The race scene keeps
its daytime look in both light and dark themes; everything outside the
scene follows the viewer's Homeroom theme.
