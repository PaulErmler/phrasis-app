# Rendering variants: first-person forms and politeness

How a course's sentence-form settings change what a card shows and hears,
and the invariants every reader and writer of `translations` and
`audioRecordings` must keep. Decided with Paul on 2026-09-05/06; the plan is
`~/.claude/plans/add-gender-and-politeness-abundant-kettle.md`.

## The four layers

1. `texts` is the identity of a meaning. Cards, review history, collections
   and search bind to `textId`. A text carries content semantics only: a
   definitive speaker gender when the sentence itself is gendered ("I'm
   pregnant", "We are brothers"), and the register metadata the classifier
   guessed. On a curriculum text those fields are evidence only when
   `texts.metadataSource` is the current classifier build
   (lib/sentenceMetadataSource.ts); before that they are the coin flips the
   sweep and the offline curation wrote, and the content sweep asks the
   classifier for the text lazily, from the source sentence alone, the
   first time a learner meets it (`requestSentenceMetadataIfNeeded`). The
   translations get no vote: they were generated from the coin flip and are
   the thing under suspicion. Nothing in the variant path ever writes a
   `texts` row.
2. `courseSettings.firstPersonForms` (masculine / feminine / both) and
   `courseSettings.politenessLevels` (a SET of casual / polite / formal) are
   the preference. Undefined means canonical, which is exactly what every
   user saw before the feature. `onboardingProgress` carries the same two
   fields until `completeOnboarding` copies them over. A card can carry its
   own correction, `cards.renderingGenderOverride` and
   `renderingPolitenessOverride`, written by the Flag dialog; it outranks
   the settings and applies to any curriculum card, stamp or not.
3. `lib/preferenceResolution.ts` is the one resolver. Given a text, a
   language, the settings and the card, it returns the card-wide gender axis
   and voice (`resolveCardRendering`) and, per language, the politeness form
   plus two keys (`resolveLanguageRendering`). It is pure and never writes.
4. `translations` and `audioRecordings` rows are disposable realizations.
   Canonical rows have no `variantKey`; variant rows carry one.

## Keys

Two keys, because a wording and a voice have different sharing:

- `textVariantKey = "<male|female|auto>|<formId|auto>"` on `translations`.
  The gender part is the card's voice only when this language's WORDING
  marks the speaker's gender (`firstPersonMarking` in lib/languages.ts), so
  a politeness variant of German is generated once and shared by every
  voice. `auto` on an axis means "as canonical". Null means the canonical
  row itself.
- `audioVariantKey = "<male|female>|<formId|auto>"` on `audioRecordings`,
  the concrete voice the card is spoken in. Null means the canonical audio,
  which is right only when the wording is canonical AND the text's
  coin-flipped voice already is the card's voice. A feminine course on a
  German sentence whose canonical voice is male reads an audio-only variant
  `female|auto` whose wording is the canonical one.

The form ids come from `lib/languageForms.ts` (`plain`, `desu-masu`,
`keigo`, `t`, `v`, `particle`, ...). Only Japanese and Korean have three;
every other marking language has two, so a level set like {casual, polite}
resolves to one form on German (du) and never alternates there.

## Which cards follow the settings

- `cards.followsCoursePreferences` is stamped on curriculum cards created
  after the feature. Such a card resolves against the course's CURRENT
  settings on every read, so a settings change re-renders it (old renderings
  stay cached, so switching back is free).
- Cards without the stamp (from before the feature) and every card on a
  user-written text (custom, chat, import) read the canonical rows for good.
  The chips still show what those rows are, from the backfilled stamps.
- Precedence for the gender axis: a definitive `texts.speakerGender` that
  is evidence (a user-written text's verdict, or a curriculum text at the
  current `metadataSource`), then the card's override, then the setting.
  On an unclassified curriculum text the field is the coin flip the sweep
  wrote back, so it is ignored. A sentence that fixes its own gender is
  served canonical in that voice by every card.
- An address language (T-V) renders a sentence without a "you" the same at
  every level, so the resolver returns no form for it; predicate (ja, ko),
  particle (th, fil) and pronoun (vi, id, ms) languages get a form on every
  sentence and the generate-and-compare rule handles the ones that come out
  identical.

## Invariants

1. The variant path never writes `texts` or a canonical row.
2. Every point read of `translations` pins all four columns of
   `by_text_language_variant_supersededAt` and every point read of
   `audioRecordings` pins all three of `by_text_language_variant`. A prefix
   query plus `.first()` returns whichever row was created first, which is
   the silent-wrong-rendering bug. Only `convex/db/translationReads.ts` may
   name the indexes (`convex/tests/lib/translationsIndexInvariant.test.ts`).
3. A rendering is never deleted because another was requested. The
   gender-drift-by-preference deletions in the canonical sweep are gone; a
   canonical row keeps whatever gender it was generated under. The one
   deletion left is a canonical WORDING change (flag, curriculum fix,
   version bump, metadata correction): `retireVariantRenderings` drops the
   pair's variant rows and keyed pointers, assets cached, because they were
   rewrites of the old wording; the next ensure pass rewrites them from the
   new one. Two in-place regenerations exist, both keep-row writes that
   archive the old wording for pinned cards: a `translationVersion` bump,
   and a `'metadata_correction'`, when the classifier has fixed the
   speaker's gender on a curriculum text and the row's `renderedGender`
   stamp proves the wording was written in the other one. Only a proven
   row: `unmarked` and unstamped rows are left alone, and the row's own
   `speakerGender` (the gender it was generated under) stops the sweep from
   asking twice. The same verdict re-voices the canonical clips
   (`sweepInvalidAudio`), since no variant would ever replace them.
4. Variant LLM jobs never fall back to Google Translate (it cannot control
   gender or register); the claim is released and canonical keeps serving.
5. Claims are keyed by variant, so two learners with the same preference
   share one job.
6. Generate-and-compare: a variant whose wording equals the canonical row's
   is stored with `sameAsCanonical` (so the ensure path stops asking) and
   served as the canonical text with audio in the card's voice.
7. Every stored wording is stamped `renderedGender` / `renderedPoliteness`
   by the rendering classifier (`convex/lib/renderingClassifier.ts`): at
   generation for new rows, and lazily for rows from before: the canonical
   sweep (`scheduleMissingContent`) collects unstamped rows of marking
   languages and `flushRenderingStamps` asks the classifier for them, 25
   rows per call, claimed on the row (`renderingStampRequestedAt`, 15 min
   cooldown) so repeated sweeps do not double the call. The upcoming-cards
   and collection-warm loops share one collector per pass. While a stamp is
   pending, the rendering sweep asks for no rewrite of that row
   (`renderingStampPending`), since the next pass may find the canonical
   row already is the requested form. The stamps feed the chips and the
   shortcut "the canonical
   row already is the requested form, schedule nothing".

## Prompts

`convex/features/translationLLM.ts` takes `requestedGender` and
`requestedForm` (a form from `lib/languageForms.ts` with its own instruction
text). A requested form is emitted as `<register>` whether or not the
sentence addresses someone, with `requestedFormInstruction` in the
instructions block, mirrored into the best-of-N judge. Canonical jobs of a
predicate-marking language whose text has no formal/informal register
metadata request the language's `defaultLevel` (polite for ja and ko;
`requestedRendering` in llmTranslationQueue.ts), which is how new shared
Japanese rows stop leaning casual.

A VARIANT is a REWRITE of the canonical wording, not a fresh translation:
`buildRenderingRewritePrompt` (`rewriteOf` on the job) asks the model to
change only what the form requires and to return the sentence unchanged
otherwise. The 2026-09-06 gender-relevance bench showed two independent
translations of one sentence drifting in unrelated wording on a third of
the pairs ("Je me suis perdu en ville" became "perdue dans la ville"),
which would have made every such variant a separate clip; the rewrite arm
of the adherence bench scored 9 to 10 with the judge and returned the
baseline wording untouched wherever the form did not bite. The variant job
therefore waits for the canonical row and never falls back to Google
Translate. The request is phrased in the terms of the linguistics
literature (`promptWording: 'literature'`: speech level, T-V distinction,
speaker gender agreement), which edged out the app's wording by a few
tenths in the adherence bench.

## Benches (2026-09-06 results)

- `pnpm eval:metadata`: the sentence-metadata classifier on the gold corpora
  (`data_preparation/gender_eval`, `politeness_eval`), 651 sentences.
- `pnpm eval:rendering`: the rendering classifier on the gold corpora plus a
  judged wild sample of 176 live rows. Gemini 3.1 Flash Lite with the
  product wording: 98.7% gender / 100% wild, 79.0% politeness gold / 92.6%
  wild, $0.18 per 1000 rows. 3.7 Flash was no better on gold at seven
  times the price and collapsed on ja/ko with the literature wording; Luna
  lost 4 points on gender. The politeness gold misses are mostly
  "casual" rows the models call "formal" on pt, zh and es, worth a look at
  the corpus labels before trusting them. Thinking does not help: the
  `-minimal` and `-low` arms (`--models=flash-lite-31-low,...`) showed
  that OpenRouter's `minimal` buys no reasoning tokens on Flash Lite, that
  `low` on 3.1 Flash Lite costs 27% more and loses 2 points on gender gold
  and 11 on the wild sample, and that 3.7 Flash thinks by default (1076
  output tokens per batch for 400 of JSON), which is where its price comes
  from. Run-to-run noise at temperature 0 is about 5 points on the 143-row
  politeness gold set, so differences below that are not signal.
- `pnpm eval:gender-relevance`: which sentences the speaker's gender changes
  at all (double generation, judged). First-person sentences are marked on
  8 to 12 of 12 in ru, pl, cs, it, ar, he, th and 2 to 5 in fr, es, pt, el,
  hi (silent agreement or dropped pronouns); ja and ko mark none in the
  polite register. A cheap predictor reached 62 to 82% precision at 75 to
  100% recall on the marked languages; the generate-and-compare rule plus
  the rewrite prompt makes a pre-filter unnecessary for now.
- `pnpm eval:adherence`: today's prompt renders 0% of descriptive Japanese
  and Korean sentences in the polite form (the reported bias); with a
  requested form the judge scores 9.5 to 10 on every language, and the
  female-speaker request lifts fr/ru/es/hi/pl from 4 to 6 to 10.

All four judge with `google/gemini-3.8-flash` and read the key from the
environment by name. Reports and caches live under `.scratch/<bench>/`.
