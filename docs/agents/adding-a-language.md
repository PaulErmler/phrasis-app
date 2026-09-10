# Adding a language

What a new language needs since the sentence-form work (politeness levels
and first-person marking, Sep 2026), what to research before writing
the config, how to research it so the copy is right, and how to check the
result. The Egyptian Arabic addition from that feature is the worked
example at the end.

Read `docs/architecture/translation-variants.md` first for the model the
fields feed.

## The fields

Two files, one language.

`lib/languages.ts`, on the `Language` entry, only the flags:

- `politenessMarking?: 'predicate' | 'particle' | 'pronoun' | 'address'`.
  Unset = the language has no learner-relevant politeness grammar and the
  setting is hidden for courses whose targets are all unset. The value says
  which sentences can change between levels: `predicate` every full
  sentence (ja, ko), `particle` any sentence in dialogue (th, fil),
  `pronoun` sentences with a pronoun, first person included (vi, id, ms),
  `address` only sentences with a "you" (every T-V language). The
  create-course dialog and the course languages sheet ask the setting for
  every marked target (`courseAsksPoliteness`); the onboarding wizard asks
  it only for the targets in `ONBOARDING_POLITENESS_TARGETS` (ja, ko;
  `onboardingAsksPoliteness`) and starts every other target on every
  level. A new marked language is therefore not asked at sign-up unless
  it is added to that list.
- `firstPersonMarking?: true` when a first-person sentence's wording
  changes with the speaker's gender (verbs, adjectives, participles,
  pronouns, self-reference words). Every language follows the card's voice
  regardless; this flag decides whether the WORDING is rewritten when a
  card is corrected to the other voice (there is no course gender choice).

`lib/languageForms.ts`, keyed by the same code:

- `POLITENESS_CONFIG[code]`: `marking` (must equal the flag), `intro` (one
  learner-facing sentence, English source), `exampleEn`, `forms` (level ->
  form; two-form languages point two levels at one object), optional
  `defaultLevel` (predicate and particle languages only: the form a
  canonical job requests when the text has no register metadata; polite
  for ja, ko, th, fil), `sources`. Each form: `id` (stable, part of every
  `variantKey`), `name` (the shortest marker a learner sees: "du",
  "です・ます", "without po"), `description` (who you use it with, English
  source), `example` (the `exampleEn` rendered in that form), `prompt` (the
  instruction the translation model follows; positive carriers plus one
  example, see docs/architecture/translation-variants.md "Prompts"). The
  builders derive `promptLabel` ("Polite · Sie") for the model-facing
  prompts. Use the `tv(...)` builder for a T-V language and say whether
  level 2 is the familiar form (`split: 'familiar'`, like Spanish tú) or
  the distance form (the default, like French vous and German Sie).
- `FIRST_PERSON_CONFIG[code]`: `intro`, `exampleEn`, `masculine`,
  `feminine`, optional `note`, `sources`.
- `messages/en.json` and `messages/de.json`, under `LanguageForms`: the
  translated `intro`, per-form `description` and first-person `intro` /
  `note` for the code (`politeness.<code>.intro`,
  `politeness.<code>.forms.<formId>.description`,
  `firstPerson.<code>.intro`, `firstPerson.<code>.note`). The unit test
  checks that the English strings equal the config and that German has
  every key.

`tests/unit/lib/languageForms.test.ts` fails when a flag has no config or a
config has no flag, and checks every form has copy, an example and a
prompt. Run it first after editing either file.

Dialect variants inherit: a mixed dialect (`es_mixed`) resolves through
its `variants` sub-codes, an accent variant (`en_gb`) through
`sharesTextWith`; give the config to the concrete codes only. Two dialects
with the same forms share one config object (`vi_south` reuses the `vi` object).

## What to research, in this order

1. Does the language mark politeness at all, and by which mechanism? Look
   for a T-V distinction (two "you" pronouns with different verb
   agreement), speech levels on the verb, politeness particles, or a
   pronoun system driven by age and relationship. If none, leave the flag
   unset (Swedish, Hebrew, most Arabic dialects, Cantonese, Swahili).
2. How many DISTINCT forms would a learner actually use, and which global
   level is each? The app has three global levels: casual (friends), polite
   ("always OK", safe with strangers and staff), formal (distance,
   honorific). Almost every language has two forms; only Japanese and
   Korean have three learnable ones. Decide the split from where the
   everyday norm sits: German du is what most learner sentences use, so
   Sie is level 3 only; French vous is the everyday norm with strangers, so
   vous starts at level 2.
3. What is each form called natively, and what is one short everyday
   sentence that differs between the forms? The same English sentence must
   render in every form (Are you coming? / Kommst du? / Kommen Sie?). For
   address languages the sentence needs a "you"; for the others any
   statement works.
4. Which forms are rude, archaic, regional or literary and must be kept OUT
   of the levels? Hindi तू, Bengali তুই, Thai กู/มึง, Vietnamese mày/tao,
   Romanian dumneata, Hungarian maga, European Portuguese você.
5. Does the language mark the speaker's gender in first-person sentences,
   and on which word classes? Prefer an example whose difference is
   audible, not only written (French prêt/prête over fatigué/fatiguée).
6. Which forms depend on the ADDRESSEE's gender or on relative age? Those
   are traps for the prompt text (Polish pan/pani, Hindi verb agreement,
   Vietnamese anh/chị/em); say so in the form's `prompt` and pick examples
   that avoid committing where possible.
7. Which register does the app pin for the language (`translationName`,
   `translationPromptNotes` in lib/languages.ts)? The examples must be in
   that register: written-standard Persian, not colloquial Tehrani, unless
   the pin says otherwise.

## How to research it

Use web search with these query shapes and prefer reference grammars,
university course pages and Wiktionary conjugation tables over blogs:

- `<language> T-V distinction`, `<language> polite pronoun textbook`,
  `<language> honorific speech levels`, `<language> politeness particle`
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
- `data_preparation/politeness_eval/data/<code>.jsonl`: 12 to 16 sentences
  with a gold register (casual / polite / formal / neutral), including a
  quoted casual line inside a polite frame and a fossilised V-form phrase.
- Run `pnpm eval:metadata --validate-only`, then `pnpm eval:rendering
--langs=<code>` (the classifier that stamps every row) and `pnpm
eval:adherence --langs=<code>` (does the translation prompt render the
  requested forms). Add a surface check for the new forms to `CHECKS` in
  `scripts/eval-adherence.ts` when a regex can tell them apart.

## Mixed-target courses

Rows in the settings UI are the union of the course languages' distinct
forms (`coursePolitenessRows`): a level gets a row when at least one
language renders it differently from the level below. Storage is always
global levels, and a hidden level inherits the visible level below it
(`levelsFromTickedRows`). So adding a three-form language to a course that
stored {casual, polite, formal} from two ticked German rows shows the new
middle row ticked. Check `tests/unit/lib/languageForms.test.ts` for the
row-union cases and add one for a new split shape.

## Worked example: Egyptian Arabic (ar_eg)

1. Research: the Wiktionary entry for حضرتك and the Wikivoyage phrasebook
   show حضرتك as everyday polite address with strangers, elders and
   officials, gendered ḥaḍritak / ḥaḍritik, taking second-person verb
   agreement. The reviewer of the Sep 2026 table called it learner-relevant
   where the other Arabic dialects are not.
2. Flags: `politenessMarking: 'address'`, `firstPersonMarking: true`
   (Arabic adjectives and verbs agree with the speaker).
3. Config: `tv({ intro, exampleEn: 'Where are you from?', t: إنت/إنتي,
v: حضرتك, sources })`, distance split. The example "إنت منين؟ /
   حضرتك منين؟" was chosen over "what do you want" because its predicate
   is invariant and the sentence is not blunt. First-person example "أنا
   تعبان / تعبانة".
4. Evals: ar_eg already had 8 gender-gold rows; a politeness file is still
   owed (docs/tech-debt.md C40).
5. Tests: the flag/config test passes; `courseAsksPoliteness(['ar_eg'])`
   is true; the settings sheet shows two rows named "Casual · إنت" and
   "Polite · حضرتك".
