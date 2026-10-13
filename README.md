# Type Racer Battle

Race friends by typing sentences fast and accurately, in a 2–20 player speed
battle. Every race shows a shared race track: each racer's small car advances
as they type, and the first car across the checkered line wins.

## How a race works

- **The lobby** shows the next race as a starting grid, one lane per racer
  with an open lane waiting for you. Tap **Join race** to roll your car onto
  the grid. Up to 20 racers fit.
- **Start race** becomes available to anyone in the race once at least two
  are in. A 5 second countdown runs, then the passage appears at **Go**.
- **Type the passage.** The field always holds the current word and clears
  when the word and its space are right. A wrong letter shows in red and
  your car stops until you fix it, so accuracy matters as much as speed.
- **The race closes** when everyone has finished, 30 seconds after the
  winner, or 3 minutes after the start, whichever comes first.
- **Results** list every racer in place order with their speed (words per
  minute, counted the standard way: five characters per word) and their
  accuracy (the share of keystrokes that were right when typed). Racers who
  ran out of time are placed after the finishers by how far they got.
- **Practice alone** is a solo run on the same track with a 3 second
  countdown. Practice results land in your races but never count as wins.

Races live on the server; each screen checks about once a second for live
progress. The passage ships with the app: two short everyday sentences per
race, kept to plain letters so phone keyboards can always match them.

## Development

- `npm test` — unit tests for the scoring maths, the sentence pool and the
  word-mode typing matcher.
- `npm run build` — compiles `styles/tailwind-input.css` to
  `public/tailwind.css` (the image build does this too).
- `npm start` — run the server locally.

## Staging demo

The staging preview opened with `?demo=1` is fully playable and populated:
four made-up racers already on the grid driving at their own steady speeds,
and eight of your own made-up past races. Nothing in the demo is a real
person, and demo rows never mix with the real lobby.

Built on Homeroom.
