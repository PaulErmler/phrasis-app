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

## Evals to extend

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
