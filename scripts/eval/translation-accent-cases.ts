/**
 * Fixtures for scripts/eval-translation-accents.ts.
 *
 * Each case is an English sentence as it would sit in the `en` curriculum,
 * with per-accent mechanical expectations for the British (`en_gb`) and
 * Australian (`en_au`) rewrites. The rewrite is meant to be light: only what
 * marks the accent may change. Kinds:
 *
 * - spelling / vocabulary / grammar: one Americanism that must be adapted,
 *   with the same answer in both accents.
 * - divergent: the two accents should differ (pavement / footpath).
 * - frozen: American content (units, currency, place names, dates) that must
 *   survive untouched even though a localiser might be tempted.
 * - control: neutral catalogue sentences that must come back byte-identical.
 *   These catch slang injection and over-editing.
 *
 * Editing `text` changes the case's cache key (the harness hashes it), so a
 * stale result is never reused. Editing `expect` does not; expectations are
 * evaluated at report time against the cached text.
 */

export type Accent = 'en_gb' | 'en_au';

export type AccentKind =
  | 'spelling'
  | 'vocabulary'
  | 'grammar'
  | 'divergent'
  | 'frozen'
  | 'control';

export type Expectation = {
  /** Every pattern must match the output. */
  must?: RegExp[];
  /** No pattern may match the output. */
  mustNot?: RegExp[];
  /** The output must equal the source byte for byte. */
  unchanged?: true;
};

export type AccentCase = {
  id: string;
  kind: AccentKind;
  /** English source, as it would sit in a curriculum collection. */
  text: string;
  /** Per-accent checks. An empty object means anything passes mechanically. */
  expect: Record<Accent, Expectation>;
};

/** The same expectation for both accents. */
function both(e: Expectation): Record<Accent, Expectation> {
  return { en_gb: e, en_au: e };
}

const UNCHANGED = both({ unchanged: true });

export const CASES: AccentCase[] = [
  // ── spelling ──────────────────────────────────────────────────────────
  {
    id: 'sp-color',
    kind: 'spelling',
    text: 'What is your favorite color?',
    expect: both({
      must: [/favourite colour/],
      mustNot: [/\bcolor\b/, /\bfavorite\b/],
    }),
  },
  {
    id: 'sp-center',
    kind: 'spelling',
    text: 'The shopping center opens at nine.',
    expect: both({ must: [/centre/], mustNot: [/\bcenter\b/] }),
  },
  {
    id: 'sp-organize',
    kind: 'spelling',
    text: 'We need to organize the meeting.',
    expect: both({ must: [/organise/], mustNot: [/organize/] }),
  },
  {
    id: 'sp-traveling',
    kind: 'spelling',
    text: 'She is traveling to Japan next month.',
    expect: both({ must: [/travelling/], mustNot: [/\btraveling\b/] }),
  },
  {
    id: 'sp-gray',
    kind: 'spelling',
    text: 'He wore a gray jacket.',
    expect: both({ must: [/\bgrey\b/], mustNot: [/\bgray\b/] }),
  },
  {
    id: 'sp-tire',
    kind: 'spelling',
    text: 'The car has a flat tire.',
    expect: both({ must: [/\btyre\b/], mustNot: [/\btire\b/] }),
  },
  {
    id: 'sp-catalog',
    kind: 'spelling',
    text: 'Please send me the new catalog.',
    expect: both({ must: [/catalogue/] }),
  },
  {
    id: 'sp-check',
    kind: 'spelling',
    text: 'I paid the bill by check.',
    expect: both({ must: [/\bcheque\b/], mustNot: [/\bcheck\b/] }),
  },
  {
    id: 'sp-program-tv',
    kind: 'spelling',
    text: 'There is a good program on TV tonight.',
    expect: both({ must: [/programme/] }),
  },
  {
    id: 'sp-program-computer',
    kind: 'spelling',
    text: 'I wrote a small computer program.',
    expect: both({ must: [/\bprogram\b/], mustNot: [/programme/] }),
  },
  {
    id: 'sp-neighbor',
    kind: 'spelling',
    text: 'My neighbor has two dogs.',
    expect: both({ must: [/neighbour/], mustNot: [/\bneighbor\b/] }),
  },
  {
    id: 'sp-toward',
    kind: 'spelling',
    text: 'She walked toward the door.',
    expect: both({ must: [/towards/] }),
  },

  // ── vocabulary (same answer in both accents) ──────────────────────────
  {
    id: 'vo-elevator',
    kind: 'vocabulary',
    text: 'The elevator is out of order.',
    expect: both({ must: [/\blift\b/], mustNot: [/elevator/] }),
  },
  {
    id: 'vo-apartment',
    kind: 'vocabulary',
    text: 'They live in a small apartment.',
    expect: both({ must: [/\bflat\b|\bunit\b/], mustNot: [/apartment/] }),
  },
  {
    id: 'vo-vacation',
    kind: 'vocabulary',
    text: 'We are going on vacation in July.',
    expect: both({ must: [/holiday/], mustNot: [/vacation/] }),
  },
  {
    id: 'vo-line',
    kind: 'vocabulary',
    text: 'We waited in line for an hour.',
    // The replacement must stay grammatical. "in queue" is not English.
    expect: both({
      must: [/in a queue|queued/],
      mustNot: [/in line|in queue\b/],
    }),
  },
  {
    id: 'vo-gas-station',
    kind: 'vocabulary',
    text: 'I need to stop at the gas station.',
    expect: both({
      must: [/petrol station/],
      mustNot: [/gas station/, /servo/],
    }),
  },
  {
    id: 'vo-cookie',
    kind: 'vocabulary',
    text: 'Would you like a cookie?',
    expect: both({ must: [/biscuit/], mustNot: [/cookie/] }),
  },
  {
    id: 'vo-fries',
    kind: 'vocabulary',
    text: 'I ordered a burger and fries.',
    expect: both({ must: [/\bchips\b/], mustNot: [/fries/] }),
  },
  {
    id: 'vo-trash',
    kind: 'vocabulary',
    text: 'Please take out the trash.',
    expect: both({ must: [/rubbish|\bbins?\b/], mustNot: [/trash/] }),
  },
  {
    id: 'vo-sweater',
    kind: 'vocabulary',
    text: "It's cold, put on a sweater.",
    expect: both({ must: [/jumper/], mustNot: [/sweater/] }),
  },
  {
    id: 'vo-pants',
    kind: 'vocabulary',
    text: 'These pants are too long.',
    // "pants" is everyday Australian; only British insists on "trousers".
    expect: {
      en_gb: { must: [/trousers/], mustNot: [/\bpants\b/] },
      en_au: { must: [/trousers|\bpants\b/] },
    },
  },
  {
    id: 'vo-cell-phone',
    kind: 'vocabulary',
    text: 'I forgot my cell phone at home.',
    expect: both({ must: [/\bmobile\b/], mustNot: [/cell phone/] }),
  },
  {
    id: 'vo-parking-lot',
    kind: 'vocabulary',
    text: 'The parking lot is full.',
    expect: both({ must: [/car park/], mustNot: [/parking lot/] }),
  },
  {
    id: 'vo-movie-theater',
    kind: 'vocabulary',
    text: "Let's go to the movie theater.",
    expect: both({ must: [/cinema|\bmovies\b/], mustNot: [/movie theater/] }),
  },
  {
    id: 'vo-fall',
    kind: 'vocabulary',
    text: 'The leaves turn red in the fall.',
    expect: both({ must: [/autumn/], mustNot: [/\bfall\b/] }),
  },
  {
    id: 'vo-restroom',
    kind: 'vocabulary',
    text: 'Where is the restroom?',
    expect: both({ must: [/toilet|\bloo\b|bathroom/], mustNot: [/restroom/] }),
  },
  {
    id: 'vo-zip-code',
    kind: 'vocabulary',
    text: 'What is your zip code?',
    expect: both({ must: [/postcode/], mustNot: [/zip code/] }),
  },
  {
    id: 'vo-resume',
    kind: 'vocabulary',
    text: 'Please send us your resume.',
    // Australians use "résumé" and "CV" interchangeably.
    expect: {
      en_gb: { must: [/\bCV\b/], mustNot: [/resume|résumé/] },
      en_au: { must: [/\bCV\b|résumé/] },
    },
  },

  // ── grammar / usage ───────────────────────────────────────────────────
  {
    id: 'gr-gotten',
    kind: 'grammar',
    text: 'It has gotten colder lately.',
    expect: both({ mustNot: [/gotten/] }),
  },
  {
    id: 'gr-weekend',
    kind: 'grammar',
    text: 'What are you doing on the weekend?',
    // Australians say "on the weekend" as often as "at the weekend".
    expect: {
      en_gb: { must: [/at the weekend/], mustNot: [/on the weekend/] },
      en_au: {},
    },
  },
  {
    id: 'gr-hospital',
    kind: 'grammar',
    text: 'My grandmother is in the hospital.',
    expect: both({ must: [/in hospital/], mustNot: [/in the hospital/] }),
  },
  {
    id: 'gr-through',
    kind: 'grammar',
    text: 'The shop is open Monday through Friday.',
    expect: both({ must: [/Monday to Friday/], mustNot: [/through/] }),
  },
  {
    id: 'gr-just-ate',
    kind: 'grammar',
    text: 'I just ate lunch.',
    expect: both({ must: [/just (eaten|had)/], mustNot: [/just ate/] }),
  },
  {
    id: 'gr-write-me',
    kind: 'grammar',
    text: 'Write me when you get there.',
    expect: both({ must: [/write to me/i], mustNot: [/write me\b/i] }),
  },
  {
    id: 'gr-different-than',
    kind: 'grammar',
    text: 'This is different than what I expected.',
    expect: both({
      must: [/different (from|to)/],
      mustNot: [/different than/],
    }),
  },
  {
    id: 'gr-half-hour',
    kind: 'grammar',
    text: 'The bus leaves in a half hour.',
    expect: both({ must: [/half an hour/], mustNot: [/a half hour/] }),
  },

  // ── divergent (British and Australian differ) ─────────────────────────
  {
    id: 'dv-sidewalk',
    kind: 'divergent',
    text: "Don't ride your bike on the sidewalk.",
    expect: {
      en_gb: { must: [/pavement/], mustNot: [/sidewalk/, /footpath/] },
      en_au: { must: [/footpath/], mustNot: [/sidewalk/, /pavement/] },
    },
  },
  {
    id: 'dv-truck',
    kind: 'divergent',
    text: 'A truck was blocking the road.',
    expect: {
      en_gb: { must: [/\blorry\b/], mustNot: [/\btruck\b/] },
      en_au: { must: [/\btruck\b/], mustNot: [/\blorry\b/] },
    },
  },
  {
    id: 'dv-eggplant',
    kind: 'divergent',
    text: "I don't like eggplant.",
    expect: {
      en_gb: { must: [/aubergine/], mustNot: [/eggplant/] },
      en_au: { must: [/eggplant/], mustNot: [/aubergine/] },
    },
  },
  {
    id: 'dv-zucchini',
    kind: 'divergent',
    text: 'Add the zucchini to the pan.',
    expect: {
      en_gb: { must: [/courgette/], mustNot: [/zucchini/] },
      en_au: { must: [/zucchini/], mustNot: [/courgette/] },
    },
  },
  {
    id: 'dv-bell-pepper',
    kind: 'divergent',
    text: 'Cut the bell pepper into strips.',
    expect: {
      en_gb: { must: [/\bpepper\b/], mustNot: [/bell pepper/, /capsicum/] },
      en_au: { must: [/capsicum/], mustNot: [/bell pepper/] },
    },
  },
  {
    id: 'dv-candy',
    kind: 'divergent',
    text: 'The children got candy at the party.',
    expect: {
      en_gb: { must: [/sweets/], mustNot: [/candy/, /lollies/] },
      en_au: { must: [/lollies/], mustNot: [/candy/] },
    },
  },
  {
    id: 'dv-swimsuit',
    kind: 'divergent',
    text: "Don't forget your swimsuit.",
    expect: {
      en_gb: { must: [/swimming costume|swimsuit|swimming things/] },
      en_au: { must: [/swimmers|bathers|togs|swimsuit/] },
    },
  },
  {
    id: 'dv-cooler',
    kind: 'divergent',
    text: 'Put the drinks in the cooler.',
    expect: {
      en_gb: { must: [/cool ?box|cooler/], mustNot: [/esky/i] },
      en_au: { must: [/esky|cooler/i] },
    },
  },
  {
    id: 'dv-flip-flops',
    kind: 'divergent',
    text: 'I wore flip-flops to the beach.',
    expect: {
      en_gb: { must: [/flip-flops/], mustNot: [/thongs/] },
      en_au: { must: [/thongs|flip-flops/] },
    },
  },
  {
    id: 'dv-how-doing',
    kind: 'divergent',
    text: 'How are you doing?',
    expect: {
      en_gb: { unchanged: true },
      en_au: { must: [/^How are you (doing|going)\?$/], mustNot: [/mate/] },
    },
  },
  {
    id: 'dv-stroller',
    kind: 'divergent',
    text: 'She pushed the stroller through the park.',
    expect: {
      en_gb: { must: [/pushchair|buggy|pram/], mustNot: [/stroller/] },
      en_au: { must: [/pram|stroller/], mustNot: [/pushchair|buggy/] },
    },
  },
  {
    id: 'dv-freeway',
    kind: 'divergent',
    text: 'Take the freeway to the airport.',
    expect: {
      en_gb: { must: [/motorway/], mustNot: [/freeway/] },
      en_au: { must: [/freeway|motorway|highway/] },
    },
  },

  // ── frozen content ────────────────────────────────────────────────────
  {
    id: 'fr-fahrenheit',
    kind: 'frozen',
    text: "It's 90 degrees Fahrenheit today.",
    expect: both({ must: [/90 degrees Fahrenheit/], mustNot: [/Celsius|°C/] }),
  },
  {
    id: 'fr-dollars',
    kind: 'frozen',
    text: 'The ticket cost twenty dollars.',
    expect: both({ must: [/twenty dollars/], mustNot: [/pounds|quid/] }),
  },
  {
    id: 'fr-miles',
    kind: 'frozen',
    // "mall" may become "shopping centre"; the distance must not convert.
    text: 'We drove five miles to the mall.',
    expect: both({ must: [/five miles/], mustNot: [/kilomet/] }),
  },
  {
    id: 'fr-central-park',
    kind: 'frozen',
    text: 'Central Park is beautiful in the fall.',
    expect: both({ must: [/Central Park/, /autumn/], mustNot: [/\bfall\b/] }),
  },
  {
    id: 'fr-thanksgiving',
    kind: 'frozen',
    text: 'Thanksgiving is in November.',
    expect: UNCHANGED,
  },
  {
    id: 'fr-quote',
    kind: 'frozen',
    text: 'He said, "See you tomorrow."',
    expect: UNCHANGED,
  },
  {
    id: 'fr-tom-boston',
    kind: 'frozen',
    text: 'Tom lives in Boston with his mom.',
    expect: both({
      must: [/\bTom\b/, /\bBoston\b/, /\bmum\b/],
      mustNot: [/\bmom\b/],
    }),
  },
  {
    id: 'fr-date',
    kind: 'frozen',
    text: 'The meeting is on March 3, 2026.',
    expect: both({ must: [/March 3, 2026/] }),
  },
  {
    id: 'fr-ny-subway',
    kind: 'frozen',
    text: 'The New York subway runs all night.',
    expect: both({ must: [/New York subway/], mustNot: [/underground|tube/i] }),
  },
  {
    id: 'fr-walmart',
    kind: 'frozen',
    text: 'I bought it at Walmart.',
    expect: UNCHANGED,
  },
  {
    id: 'fr-first-floor',
    kind: 'frozen',
    // Floor numbering differs, but renumbering changes the meaning.
    text: 'Her office is on the first floor.',
    expect: both({ must: [/first floor/], mustNot: [/ground floor/] }),
  },

  // ── controls (must come back unchanged) ───────────────────────────────
  // "just" in the present tense means "simply". The past-simple rule,
  // "I just ate" -> "I've just eaten", must not touch these. Luna turned
  // "I just feel tired" into "I've just felt tired" in production (2026-09-05).
  {
    id: 'ct-just-feel',
    kind: 'control',
    text: 'I just feel tired.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-just-want',
    kind: 'control',
    text: 'I just want to go home.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-just-looks',
    kind: 'control',
    text: 'She just looks tired today.',
    expect: UNCHANGED,
  },
  // Over-edits from the 2026-09-05 500-sentence review: proofreading,
  // register flattening and a hyphen. None of these is an accent marker.
  {
    id: 'ct-social',
    kind: 'control',
    text: 'Sami is a social person.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-work-out',
    kind: 'control',
    text: 'How often do you work out?',
    expect: UNCHANGED,
  },
  {
    id: 'ct-tip',
    kind: 'control',
    text: 'He blew on the tip of his fingers.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-not-here-too',
    kind: 'control',
    text: 'The girl is not here too.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-doing-video',
    kind: 'control',
    text: 'Sami is doing a new video.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-deep-sea',
    kind: 'control',
    text: 'She trained for deep sea diving.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-way-taller',
    kind: 'control',
    text: "Mary is way taller than me, isn't she?",
    expect: UNCHANGED,
  },
  {
    id: 'ct-phone-charging',
    kind: 'control',
    text: "My phone's charging.",
    expect: UNCHANGED,
  },
  {
    id: 'ct-right-away',
    kind: 'control',
    text: 'Make sure you clean up any spills right away.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-to-the-hospital',
    kind: 'control',
    text: 'It is no less than ten miles to the hospital.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-vice-president',
    kind: 'control',
    text: 'He would leave the job to his vice president.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-openings',
    kind: 'control',
    text: 'There are some openings at our company.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-house',
    kind: 'control',
    text: 'How is your house?',
    expect: UNCHANGED,
  },
  {
    id: 'ct-give',
    kind: 'control',
    text: 'We are what we give.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-afternoon',
    kind: 'control',
    text: 'Good afternoon.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-pen',
    kind: 'control',
    text: 'Do you have a pen?',
    expect: UNCHANGED,
  },
  {
    id: 'ct-thanks',
    kind: 'control',
    text: 'Thank you very much for your help.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-rain',
    kind: 'control',
    text: "It's going to rain tomorrow.",
    expect: UNCHANGED,
  },
  {
    id: 'ct-tired',
    kind: 'control',
    text: "I'm really tired today.",
    expect: UNCHANGED,
  },
  {
    id: 'ct-dinner',
    kind: 'control',
    text: 'What do you want for dinner?',
    expect: UNCHANGED,
  },
  {
    id: 'ct-late',
    kind: 'control',
    text: "Sorry I'm late.",
    expect: UNCHANGED,
  },
  {
    id: 'ct-book',
    kind: 'control',
    text: 'This book is more interesting than that one.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-meet',
    kind: 'control',
    text: 'Nice to meet you.',
    expect: UNCHANGED,
  },
  {
    id: 'ct-awesome',
    kind: 'control',
    // Informal American-flavoured tone: leave it, do not "translate" the vibe.
    text: 'That movie was awesome!',
    expect: both({
      must: [/\bfilm\b|\bmovie\b/],
      mustNot: [/brilliant|mate|bloody/],
    }),
  },
];
