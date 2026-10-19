// Tailwind config for this app's precompiled stylesheet.
//
// npm run build (Docker or Paketo) runs the Tailwind CLI over the globs below
// and writes public/tailwind.css, which public/index.html links as
// /tailwind.css. Nothing is committed — every image build regenerates it.
//
// To build it locally (optional; the image build does this for you):
//   npm ci --include=dev
//   npm run build

// A colour token: a CSS variable holding "R G B", set for the light and the
// dark look in styles/tailwind-input.css. <alpha-value> keeps opacity
// modifiers working (bg-accent/10).
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  // Every file that can contain a class name. Tailwind's extractor is a
  // regex over source text, so it finds class names written as whole
  // literals — including ones inside JS strings in these files.
  content: [
    './public/**/*.html',
    './public/**/*.js',
  ],

  // Classes this app builds dynamically (if it ever does) go here, since the
  // extractor cannot see them. Prefer whole literals in the markup instead.
  safelist: [],

  // dark: variants key off a "dark" class on <html>, which public/index.html
  // sets from the viewer's Homeroom theme (the platform bridge reports it),
  // rather than off the OS colour-scheme preference: inside the platform's
  // frame that media query sees only the operating system.
  darkMode: 'class',

  // Stops hover: styles sticking after a tap on touch screens. Required by
  // the usernode-native UI kit and harmless without it.
  future: { hoverOnlyWhenSupported: true },

  // This app's design kit, added to Tailwind's defaults: the stock palettes
  // and sizes still exist, but the screen uses these names. The colours are
  // semantic, so each is right in both looks with no dark: variant. To
  // re-theme the app, change the token VALUES in styles/tailwind-input.css
  // and keep these names.
  theme: {
    extend: {
      colors: {
        ground: token('ground'), // the page
        surface: token('surface'), // lists, cards, fields
        raised: token('raised'), // hovers, badges
        fg: token('fg'), // text
        muted: token('muted'), // secondary text
        line: token('line'), // borders, dividers, skeletons
        accent: token('accent'), // the one accent: the primary action
        'on-accent': token('on-accent'), // text on the accent
        danger: token('danger'),
        'on-danger': token('on-danger'),
        focus: token('focus'), // the keyboard focus ring
        track: token('track'), // the asphalt of the race scene
        'lane-mark': token('lane-mark'), // the dashed lines between lanes
        sky: token('sky'), // the race scene's fixed palette
        'sky-low': token('sky-low'),
        skyline: token('skyline'),
        tree: token('tree'),
        'tree-dark': token('tree-dark'),
        wall: token('wall'),
        'wall-post': token('wall-post'),
        curb: token('curb'),
        hud: token('hud'), // badges, name tags, dashboard
        'on-hud': token('on-hud'),
        'hud-muted': token('hud-muted'),
        go: token('go'), // green light, your tag, your lane tint
        'on-go': token('on-go'),
        stop: token('stop'), // red light, gauge red zone
        bad: token('bad'), // wrong letters in the strip
        needle: token('needle'), // gauge needle
        'car-1': token('car-1'), // racing liveries, handed out by lane
        'car-2': token('car-2'),
        'car-3': token('car-3'),
        'car-4': token('car-4'),
        'car-5': token('car-5'),
        'car-6': token('car-6'),
      },
      // The passage, the clock and every speed and accuracy figure are set
      // in the monospace face, the typing test's own vernacular; everything
      // else is the system sans.
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      // The type scale: four sizes, and nothing in between.
      fontSize: {
        small: ['0.875rem', { lineHeight: '1.25rem' }],
        body: ['1rem', { lineHeight: '1.5rem' }],
        heading: ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        title: ['1.75rem', { lineHeight: '2.25rem', fontWeight: '700' }],
      },
    },
  },
  plugins: [],
};
