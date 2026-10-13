// The built-in passage pool. Characters are limited to [A-Za-z ,.] on
// purpose: phone keyboards swap in curly quotes and apostrophes that can
// never be matched against the passage, so the pool simply avoids them.
//
// pickText(rand) returns the race's passage: two distinct sentences joined
// by one space. `rand` is injectable so tests are deterministic.

const SENTENCES = [
  'The little red boat drifted past the lighthouse as the sun went down.',
  'Gulls circled slowly over the quiet harbor before the storm arrived.',
  'A cold wind carried the smell of rain across the open field.',
  'We packed bread, cheese and two apples for the long walk home.',
  'The train left the station on time and rolled into the green valley.',
  'Snow fell softly on the rooftops and no one went outside all morning.',
  'She read the map twice and still turned left at the old bridge.',
  'Fresh bread from the corner bakery sells out before nine each day.',
  'The river bends around the hill and slows near the willow trees.',
  'Our tent held through the night though the wind never really stopped.',
  'The market opens early and the best fruit goes within the first hour.',
  'He fixed the fence with three nails and a piece of wire.',
  'Clouds gathered over the mountains and the air turned cool and still.',
  'We watched the tide come in until the first stars appeared.',
  'The old clock on the wall ticks louder when the house is silent.',
  'A single lamp lit the room and the pages of the open book.',
  'They walked the coastal path and counted boats in the bay below.',
  'The soup needs salt, a little pepper and ten more minutes.',
  'Morning fog lay low over the fields until the sun burned it away.',
  'The dog slept under the table while the rain tapped on the window.',
  'We took the long road home to see the orchards in full bloom.',
  'A kite climbed above the hill and hung there in the steady wind.',
  'The cafe was full, so we drank our coffee standing at the bar.',
  'Autumn came early this year and the leaves turned almost overnight.',
  'She wrote the letter by hand and posted it on the way to work.',
  'The garden path ends at a wooden gate and a view of the lake.',
  'Thunder rolled in the distance but the storm never reached the town.',
  'He carried the boxes up the stairs and stopped to catch his breath.',
  'The ferry to the island leaves twice a day, once at dawn.',
  'Wildflowers covered the meadow in every colour the summer could offer.',
  'We shared the last of the cake and promised to bake another soon.',
  'The museum was quiet on Tuesday and we had the rooms to ourselves.',
  'A fox crossed the road, paused, and vanished into the hedgerow.',
  'The forecast promised sun, so we left our coats at the hotel.',
  'Grandmother kept jars of honey on the shelf above the sink.',
  'The bus was late, the rain was heavy, and the day got better anyway.',
  'Birds gathered on the wire above the yard as evening came on.',
  'We found a table by the window and watched the street fill with light.',
  'The mountain path was steep but the view at the top repaid every step.',
  'Winter apples keep well in the cellar until the first warm week.',
];

module.exports = { SENTENCES };

// `rand` defaults to Math.random; the server passes its own generator so
// preview replays (`?un-now=`) and tests stay deterministic.
function pickText(rand = Math.random) {
  const a = SENTENCES[Math.floor(rand() * SENTENCES.length)];
  let b = a;
  while (b === a) b = SENTENCES[Math.floor(rand() * SENTENCES.length)];
  return a + ' ' + b;
}

module.exports.pickText = pickText;