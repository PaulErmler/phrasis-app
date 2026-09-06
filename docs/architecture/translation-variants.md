# Rendering variants: first-person forms and politeness

How a course's sentence-form settings change what a card shows and hears,
and the invariants every reader and writer of `translations` and
`audioRecordings` must keep. Decided with Paul on 2026-09-05/06; the plan is
`~/.claude/plans/add-gender-and-politeness-abundant-kettle.md`.

## The four layers

1. `texts` is the identity of a meaning. Cards, review history, collections
   and search bind to `textId`. A text carries content semantics only: a
   definitive speaker gender when the sentence itself is gendered ("I'm
   pregnant"), and the register metadata the classifier guessed. Nothing in
   the variant path ever writes a `texts` row.
2. `courseSettings.firstPersonForms` (masculine / feminine / both) and
   `courseSettings.politenessLevels` (a SET of casual / polite / formal) are
   the preference. Undefined means canonical, which is exactly what every
   user saw before the feature. `onboardingProgress` carries the same two
   fields until `completeOnboarding` copies them over.
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
- A definitive `texts.speakerGender` wins over the setting: the canonical
  rendering already has it.
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
   gender-drift deletions in the canonical sweep are gone; a canonical row
   keeps whatever gender it was generated under.
4. Variant LLM jobs never fall back to Google Translate (it cannot control
   gender or register); the claim is released and canonical keeps serving.
5. Claims are keyed by variant, so two learners with the same preference
   share one job.
6. Generate-and-compare: a variant whose wording equals the canonical row's
   is stored with `sameAsCanonical` (so the ensure path stops asking) and
   served as the canonical text with audio in the card's voice.
7. Every stored wording is stamped `renderedGender` / `renderedPoliteness`
   by the rendering classifier (`convex/lib/renderingClassifier.ts`): at
   generation for new rows, by `migrations/backfillRenderedForms` for rows
   from before. The stamps feed the chips and the shortcut "the canonical
   row already is the requested form, schedule nothing".

## Prompts

`convex/features/translationLLM.ts` takes `requestedGender` and
`requestedForm` (a form from `lib/languageForms.ts` with its own instruction
text). A requested form is emitted as `<register>` whether or not the
sentence addresses someone, with `requestedFormInstruction` in the
instructions block, mirrored into the best-of-N judge. Canonical jobs of a
predicate-marking language whose text has no register metadata request the
language's `defaultLevel` (polite for ja and ko), which is how new shared
Japanese rows stop leaning casual. `promptWording` switches between the
app's wording and the linguistics terms; `pnpm eval:adherence` compares the
two.

## Benches

- `pnpm eval:metadata`: the sentence-metadata classifier on the gold corpora
  (`data_preparation/gender_eval`, `politeness_eval`).
- `pnpm eval:rendering`: the rendering classifier, model and wording choice,
  on the gold corpora plus a judged wild sample of live rows.
- `pnpm eval:gender-relevance`: for which sentences the speaker's gender
  changes the wording at all (double generation), and whether a cheap
  predictor can tell in advance.
- `pnpm eval:adherence`: does the production prompt render the requested
  form and gender, baseline vs product vs literature wording.

All four judge with `google/gemini-3.8-flash` and read the key from the
environment by name.
