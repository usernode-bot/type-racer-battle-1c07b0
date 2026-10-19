# Type Racer Battle — notes for Claude Code

This app runs on **Homeroom**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Homeroom's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom's dev-chat
the platform fixes the base commit, and none of this applies.

## Starter template

The screen this app currently ships — the "Starter template" hero with
the app's thumbnail tile and the plain-English note on how the app gets
built (by asking Homeroom bot) — is placeholder content from the
Homeroom starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- rewrite `README.md` to describe the actual app.

Keep the `usernode-dev-console@1` forwarder `<script>` when rewriting the
HTML — that block is platform infrastructure, not template content. So is
the bridge `<script>`. The design kit is not placeholder either: build the
real app with it, and fill in "## Design" below.

The screen has a light and a dark look and follows the viewer's Homeroom
theme, switching live when they change it: the theme `<script>` right after
the bridge tag sets a `dark` class on `<html>`. Keep that script, and give
everything you build both looks (the design kit's colour tokens carry both), unless one
fixed look is the point of this app, like a game's own scene; then say so
under "## Design" below. Unless a request asks for one, add
no theme picker: the viewer's Homeroom setting is the control. "The
platform's light/dark theme inside the app frame" in the platform
conventions has the details.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Type Racer Battle

Race friends by typing sentences fast and accurately in a 2–20 player speed
battle. One screen's job: get into a race and finish it. Races live on the
server in the `races` / `race_entries` tables; clients poll about once a
second, no websocket. Passages ship with the app in `lib/sentences.js`, two
short everyday sentences per race, so no passage or custom-text feature
should ever grow outside that pool without a reason.

## Design

This app's look. The first real version set it; every later change follows
it, and updates it when a request changes the look on purpose.

- **Palette:** the page around the scene follows the viewer's theme with
  cool tarmac greys (ground, surface, raised, text, muted, line), one action
  colour, start-light green (`--accent`), used only for the primary button
  and the winner badge, and red (`--danger`) only for the typing field's
  mistake ring and hint. The scene itself is a **fixed illustrated palette**
  declared once in `:root` and deliberately NOT overridden in `.dark` (see
  the "race scene" block in `styles/tailwind-input.css`): sky blue, skyline
  blue, tree greens, a grey wall with posts, a red-and-white barrier
  (`--curb` alternating with `--lane-mark`), grey tarmac with dashed lane
  lines, a dark HUD (badges, name tags, the dashboard, the checkered
  finish), a green start light, a red stop light, a light-blue needle, and
  six racing liveries (`--car-1` red … `--car-6` pink) handed out by lane
  and repeating from lane 7. Green stays out of the liveries so "go" keeps
  meaning go.
- **Signature element:** the illustrated city highway scene — a blue sky
  gradient with a skyline and a band of trees, a grey wall with posts, a
  red-and-white barrier, the multi-lane highway with a white start line on
  the left and a checkered finish on the right, a side-view car with a name
  tag in each racer's livery. The same scene is the lobby's starting grid
  (an "Open lane" tag where the next racer goes) and the race's live view,
  so joining literally puts your car on the line. The car's `left` position
  is exactly how far the racer has typed correctly.
- **HUD and dashboard:** on the sky, a dark speed badge (a big monospace
  wpm figure, a two-dot start light — red before Go, green from Go) and a
  dark clock badge (the countdown, then the time left). Under the road, a
  dark dashboard: a speedometer gauge (0–10 read ×10 wpm, red zone from 8,
  needle at exactly the wpm figure) beside the passage strip — one large
  monospace line that slides left as you type, typed-right letters muted,
  mistakes red on red, a green caret where you are. The race view is wider
  (`max-w-3xl`) than the lobby (`max-w-lg`).
- **Name tags:** every car wears one — other racers' names, yours green. In
  a race your green tag reads `#N`, your live place; near the start the tag
  sits in front of the car and once the car is well along it flips behind
  (`car-tag-ahead`).
- **Type:** system sans for everything except the typing vernacular — the
  passage strip, the clock, every speed figure and the gauge numbers are
  monospace (`font-mono`), so each letter has its own slot and the figures
  line up. Scale: `text-title`, `text-heading`, `text-body`, `text-small`.
- **Both looks:** everything around the scene carries a light and a dark
  value in `styles/tailwind-input.css` and follows the viewer's Homeroom
  theme; the scene is the one fixed-look exception and is identical in both.

Components beyond the starter kit, all in the kit file: `scene`,
`scene-backdrop` (+ `-low`, holding the scene SVG), `curb`, `track`,
`lane`, `lane-you`, `lane-thin` (28 px lanes from nine racers), `car`,
`car-svg`, `car-tag` (+ `-you`, `-ahead`, `-open`), `hud` / `hud-badge` /
`hud-figure` / `hud-unit`, `signal`, `dash`, `gauge` (dial, needle) and
`strip` with `ch-ok` / `ch-bad` / `ch-rest` / `caret`, plus `badge` /
`badge-win`, `stats` / `stat`, and `field-error`.

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and a few components
(`btn-primary`, `btn-secondary`, `field`, `list` and `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. 5.0"), never a bare value that could pass for one
  already entered.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry.
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions).
- No cards in cards, no uppercase eyebrows, no emoji as icons.

## App-specific conventions

- Demo rows (the staging `?demo=1` world) carry the viewer's id in
  `races.demo_owner`. Real queries must always filter `demo_owner IS NULL`;
  the demo's own queries filter `demo_owner = <viewer>`. Nothing else reads
  `demo_owner`.
- Passage characters stay within `[A-Za-z ,.]` — single spaces, a full stop
  at the end, no quotes or apostrophes that phone keyboards would curl.
- All race time decisions use `req.now`, written to the database as query
  parameters, never SQL `NOW()`.
- One open lobby at a time, enforced by the `races_one_lobby` partial unique
  index on `COALESCE(demo_owner, '') WHERE status = 'lobby'`; "join" reuses
  it or races to create it. Any racer in it can start it once two are in.
- The typing field is word by word (`public/typing.js`): the field holds the
  current word, clears when the word and its space are right, and the car's
  position is exactly how far the racer has typed correctly.
