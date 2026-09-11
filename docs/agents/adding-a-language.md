# Adding a language

What a new language needs on top of its `Language` entry: whether its
wording changes with the speaker's gender (first-person marking), what to
research before writing the config, and how to check the result.

Read `docs/architecture/rendering-keys.md` first for the model the fields
feed.

## The fields

Two files, one language.

`lib/languages.ts`, on the `Language` entry, one flag:

- `firstPersonMarking?: true` when a first-person sentence's wording
  changes with the speaker's gender (verbs, adjectives, participles,
  pronouns, self-reference words). Every language follows the sentence's
  voice for the audio regardless; this flag decides whether the WORDING is
  re-translated when a flag moves that voice.

`lib/languageForms.ts`, keyed by the same code:

- `FIRST_PERSON_CONFIG[code]`: `intro`, `exampleEn`, `masculine`,
  `feminine`, `sources`. The classifier that verifies a generated wording
  reads the example pair, so both sentences must differ only in the
  speaker's gender.

`tests/unit/lib/languageForms.test.ts` fails when a flag has no config or a
config has no flag. Run it first after editing either file.

Dialect variants inherit: a mixed dialect (`es_mixed`) resolves through its
`variants` sub-codes, an accent variant (`en_gb`) through `sharesTextWith`;
give the config to the concrete codes only. Two dialects with the same
forms share one config object (`vi_south` reuses the `vi` object).

## What to research, in this order

1. Does the language mark the speaker's gender in first-person sentences,
   and on which word classes? Verbs (Slavic past tense), adjectives and
   participles (Romance, Semitic), pronouns and self-reference terms (Thai,
   Japanese). If none, leave the flag unset (Swedish, Turkish, Cantonese,
   Swahili).
2. What is one short everyday sentence whose two forms differ ONLY in the
   speaker's gender? Prefer a difference that is audible, not only written
   (French prêt/prête over fatigué/fatiguée).
3. Which register does the app pin for the language (`translationName`,
   `translationPromptNotes` in lib/languages.ts)? The examples must be in
   that register: written-standard Persian, not colloquial Tehrani, unless
   the pin says otherwise.

## How to research it

Use web search with these query shapes and prefer reference grammars,
university course pages and Wiktionary conjugation tables over blogs:

- `<language> gender agreement first person`, `<language> past tense
gender`, `<language> adjective agreement speaker`
- `site:wiktionary.org <verb> conjugation` for the exact forms in the
  examples
- `<language> "<candidate pronoun>" rude OR offensive` for step 4

Cross-check every example sentence in at least one source that shows the
inflected form, and record the URLs in the config's `sources`. Never take
a single blog as the only evidence. When two sources disagree on where the
everyday norm sits (Italian tu/Lei, Greek εσύ/εσείς), note it in a comment
and pick the safer level (the distance form from level 2).

## Does the language need its own gloss rules?

Every target language gets a hyperliteral (word-for-word) gloss, on by
default, written in English. The shared rules in
`convex/lib/hyperliteralPrompt.ts` carry a language on their own; a
`CONVENTIONS[code]` entry exists only where the shared rules get something
WRONG. Adding one you do not need is worse than adding none: it is more text
in every call, and a rule that restates the obvious crowds out the ones that
matter.

Write an entry when one of these is true. In rough order of how often it is
the answer:

1. **The script has no spaces between words** (Japanese, Chinese, Cantonese,
   Thai). The model has to be told to segment, and told which units count.
2. **Grammatical particles carry meaning no English word has** (Japanese は /
   が, Korean 은/는, Mandarin 的 / 了 / 吗). Say which bracketed label each
   one gets, or the model invents its own and the gloss reads differently
   sentence to sentence.
3. **Case or possession is a suffix, not a preposition** (Turkish, Finnish,
   Hungarian, Estonian, Uzbek). Without a rule the model splits `evde` into
   two space-separated units and the gloss stops lining up with the sentence.
   The rule is always the same shape: the suffix becomes a hyphenated English
   preposition on the SAME unit.
4. **The language omits something English requires**, or requires something
   English omits: no articles (Slavic, Finnish, Hungarian), no present-tense
   copula (Russian, Arabic, Hebrew), an article where English has none
   (Greek).
5. **A word's position is the point** (German and Dutch verb-second and
   separable prefixes). Say to gloss each part where it stands, because the
   model's instinct is to reassemble it into English order.

If none apply, add nothing. Swedish, Indonesian and Spanish have no entry and
score fine.

### How to research it

The question is not "how does this language work" but "what will a model get
wrong if nobody tells it". Two searches answer it:

- `<language> grammar interlinear gloss example` and
  `site:en.wikipedia.org <language> grammar` — the `{{interlinear}}` template
  on the grammar article shows real glossed sentences, which is the fastest
  way to see which morphemes need their own unit.
- `<language> case suffixes list` / `<language> particles list` for the table
  the rule has to name. Wiktionary's declension tables are reliable here;
  blogs are not.

Then write one line per trap, with a CONCRETE example in it. `evimde is
"in-my-house"` teaches the model more than a paragraph about agglutination,
and it is checkable: the eval's `units` score fails the moment a suffix rule
is wrong, because the unit count stops matching the word count.

Keep it to five lines at most. If a language needs more than that, the
shared rules are probably wrong rather than the language being special.

### Check it

`pnpm eval:hyperliteral --langs=<code> --smoke` runs five sentences and
prints the glosses beside the reference, which is enough to see whether a new
rule fired. The gold data is
`data_preparation/hyperliteral_eval/data/<code>.json`; build it with
`python3 data_preparation/hyperliteral_eval/scripts/build_gold.py` and read
that directory's README first, especially the part about why nothing is
model-generated.

A language with no gold rows can still be smoke-tested by reading the output
by hand. That is worth doing before shipping a rule, because a badly worded
one makes every gloss in that language worse and nothing else will catch it:
`convex/tests/lib/hyperliteralPrompt.test.ts` only checks that the code is
real and that the rules reach the prompt.

## Evals to extend

- `data_preparation/hyperliteral_eval/data/<code>.json`: only when the
  language got a `CONVENTIONS` entry above, and only from attributable
  sources. See the section above.
- `data_preparation/gender_eval/data/<code>.jsonl`: 8 to 17 target-language
  sentences with a gold speaker gender (male / female / neutral) and the
  traps (addressee-not-speaker, referent-not-speaker, quoted-speech). The
  README there has the schema and the phenomenon vocabulary.
- Run `pnpm eval:metadata --validate-only`, then
  `pnpm eval:rendering --langs=<code>`, the classifier that verifies every
  generated row.

## Worked example: Egyptian Arabic (ar_eg)

1. Research: reference grammars show Egyptian Arabic adjectives and verbs
   agreeing with the speaker in the first person, so the wording of a
   first-person sentence is not the same for a man and a woman.
2. Flag: `firstPersonMarking: true` (Arabic adjectives and verbs agree
   with the speaker).
3. Config: `FIRST_PERSON_CONFIG.ar_eg` with the example "أنا تعبان /
   تعبانة" ("I'm tired"), which differs only in the speaker's gender.
4. Evals: ar_eg already had 8 gender-gold rows.
5. Tests: `tests/unit/lib/languageForms.test.ts` passes.
6. Gloss rules: Egyptian Arabic takes the shared `ar` entry (the definite
   article ال joins its word with a hyphen, person and gender live on the
   verb, no present-tense copula). A dialect needs its own entry only where
   it diverges from the standard on one of the five triggers above, which
   ar_eg does not.
