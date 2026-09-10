# Rendering keys: voice and politeness on every row

How a card's voice and politeness form decide which `translations` and
`audioRecordings` rows it reads, how those rows are produced, and the
invariants every reader and writer must keep. This replaces the
"rendering variants" model of 2026-09-05 (canonical rows plus rewrites
labelled after the fact); the restructuring was decided with Paul on
2026-09-10, plan `~/.claude/plans/your-task-is-to-snoopy-dewdrop.md`,
before/after flowcharts at
https://claude.ai/code/artifact/7f5a9d96-b1d5-44c4-99db-b197a8be6781.

## The model in one paragraph

A text has one voice. Every row written since the cutover was generated for
a named voice and a named politeness form, and is stored under that name,
the rendering key. The key is the truth about the row; a classifier checks
that the model honoured it and never labels a row after the fact. A card
resolves its key from the text, the course settings and its own
corrections, reads the row at that key, and asks the content sweep for it
when it is missing. Rows from before the cutover carry no key and serve the
cards that were created on them.

## The layers

1. `texts` is the identity of a meaning. Cards, review history, collections
   and search bind to `textId`. A text carries its source metadata: the
   register, whether the sentence addresses someone, a definitive speaker
   gender when the sentence fixes it ("I'm pregnant", "We are brothers"),
   plus the voice. On a curriculum text the metadata is evidence only at the
   current classifier build (`texts.metadataSource`,
   lib/sentenceMetadataSource.ts); older values are the offline curation's
   guesses.
2. `texts.audioSpeakerGender` is the voice, male or female, always decided.
   It is the classifier's verdict when the sentence fixes its own gender,
   else one seeded flip on the text id (`resolveCardSpeakerGenders`,
   lib/voices.ts), written once and never re-rolled. `texts.speakerGender`
   holds the verdict alone (male, female or neutral); the flip is never
   written into it.
3. `courseSettings.politenessLevels`, a set of casual / polite / formal, is
   the preference. Undefined means each sentence's primary form. There is no
   course-level gender preference. A card can carry its own correction,
   `cards.renderingGenderOverride` and `renderingPolitenessOverride`,
   written by the Flag dialog; it outranks the settings. The gender override
   is the one way a card leaves the text's voice, and never on a sentence
   that fixes its own gender.
4. `lib/preferenceResolution.ts` is the one resolver. `resolveCardRendering`
   gives the card-wide voice, `resolveLanguageRendering` the form and key per
   language, `primaryRenderingKey` the text's default key. Pure, never
   writes.
5. `translations` and `audioRecordings` rows are disposable realizations,
   each under a key.

## Keys

One format on `translations.variantKey` and `audioRecordings.variantKey`:

    "<male|female>|<formId|none>"

- The gender part is always concrete: the speaker the wording was written
  for and the voice the clip is spoken in. There is no wildcard. On a
  language whose wording does not change with the speaker, a `male|v` row
  and a `female|v` row hold the same words; that duplicate is cheap (a copy
  with no call where the language marks nothing, else one versioning call
  that returns the wording unchanged) and only occurs when a card asks for
  the other voice.
- The form part is the language's form (`lib/languageForms.ts`: `plain`,
  `desu-masu`, `keigo`, `t`, `v`, `particle`, ...) when the form axis applies
  to the sentence, else `none`. `none` is a decision too, taken from data:
  an address (T-V) language renders a sentence with no "you" the same at
  every level, so "Hola." is one `male|none` row for a casual, a polite and
  a formal course (`formAxisApplies`, `sentenceAddressesSomeone`). Predicate
  (ja, ko), particle (th, fil) and pronoun (vi, id, ms) languages carry a
  form on every sentence. Unmarked languages are always `none`.
- The primary key of (text, language) is the text's voice plus
  `primaryPolitenessForm(code, text)`: for an address language the T or V
  form by register when the sentence addresses someone, else `none`; for the
  other marking languages the casual form for an informal register, the
  polite form for a formal one, else the language's `defaultLevel` (required
  for every non-address language; polite for ja, ko, th, fil, vi, id, ms).
  A mixed code (`es_mixed`) resolves its form through the row's dialect
  (`classificationLanguageForRow`), since Spain and Latin America map the
  levels onto tú / usted differently.
- A user-written text (custom, chat, autofill, import, a card-edit copy)
  has one rendering per language, `<voice>|none`, which never varies with
  the settings. Its metadata lands after the rows are inserted; when the
  verdict moves the voice, `applyTextMetadata` re-keys the rows (and
  restamps a legacy row's `speakerGender`, which archived-revision audio
  reads) in the same transaction, and detaches the clips of the old voice
  so the next pass re-voices them.
- Rows with no key are legacy rows: everything in prod before the cutover.
  They are never generated again and never relabelled, with one exception:
  a flag or curriculum fix on a card that reads a legacy row replaces that
  legacy row (`replacesLegacyRow` on the job), because the learner disputed
  exactly that wording. That fix stays on the legacy row: a keyed primary
  adopted from the same wording keeps it until a keyed card flags it (open
  question on the kanban card).
- The key space is open. Rows for the other forms, and for the other
  gender, sit next to the primary under their own keys, produced by the
  versioning prompt on demand. A future course-level gender choice would
  use the same rows and the same job.

## Who reads what

`cardAcceptsLegacyRow(text, card)`: true for a user-written text, and for a
pre-feature card (no `followsCoursePreferences` stamp and no override).

- A legacy view reads its legacy row first, and a keyed row only for a
  language where it has no legacy row. Its clips are the legacy pointers.
  Its chips show the card's resolved voice (the text's voice, or the
  card's gender override) and no politeness level.
- Every other view (settings-following cards, corrected cards, readers with
  no card such as the collection preview, placement and the library) reads
  the row at its key, and shows the legacy row as a placeholder while the
  keyed row is being written (`textPending`; the chip says "updating", the
  browse row sets `needsRenderingRewrite`). Its clips are the keyed
  pointers, the source slot's included (`<voice>|none`).
- The pin (`cardPinAt`, `translationsAcceptedAt`) applies within a key: a
  card pinned to an archived revision of its key reads that revision as it
  was; a settings switch is the learner's own action and reads the new
  key's live row. `resolveServedRendering` and the batched
  `buildTextContentBatchForLanguages` are the two readers; the accessor
  rule below keeps them the only ones.
- `writingFeedback.ts` reads register and gender from the served key, and
  from `texts.register` and the voice on a legacy row.

## Writes

Every row written after the cutover carries a key: the LLM worker with the
job's key; `customTexts.ts`, `chat/cardApprovals.ts`, the import path in
`collections.ts` and `cardEditPipeline.ts` with `<voice>|none`;
`translationSeed.ts` under the primary key; the accent-row path in
`contentScheduling.ts` (an `en` sentence on an `en_us` course, verbatim)
under `<voice>|none`.

Columns: `versionedFromText` on a row the versioning prompt produced (the
primary wording it was derived from), `renderingVerified` (the verifier's
verdict, absent when it could not answer), `texts.metadataAttempts`.
`translations.speakerGender` stays for the chips on legacy rows; on a keyed
row it equals the key's gender part.

## The content sweep, `ensureTextContent`

One entry point in `convex/lib/contentScheduling.ts` for every caller: the
card surfaces pass their card and the course settings, the warm and browse
surfaces pass the settings alone (`previewView`), and the guard "which
rendering does this view read" is applied once, inside.

1. The voice is decided and written if it is not yet.
2. The metadata gate. A curriculum text is classified from its source
   sentence alone (`classifyCurriculumText`, through the action retrier)
   before its first keyed row or clip, so no key is ever computed from a
   register or a voice a verdict can later overturn. The gate is asked
   lazily, only where a keyed write is due: legacy rows and clips are
   repaired without it. One request per 15 minutes, `MAX_METADATA_ATTEMPTS`
   (3) in all, after which the text renders from defaults (neutral
   register, the seeded voice, the legacy addressee fallback). The verdict
   re-runs the sweep (`applyTextMetadata`), buying audio only when the text
   has a card.
3. Per language, `ensureRenderingRow`:
   - the row at the key exists: done;
   - adoption: a legacy row may stand in for the PRIMARY key only. When the
     wording cannot carry either axis (an unmarked language, or a form-free
     key on a language that does not mark the first person) it is copied
     under the key with no call, annotations and provenance included, and
     the view goes on to its annotations and audio in the same pass. When
     the wording could carry the voice or the form, the copy is made by a
     job that first verifies the legacy wording against the key. Never a
     version-stale wording the pipeline would regenerate (a human wording,
     `mayRegenerateTranslation` false, has no version to be stale against),
     never a Google Translate or source-verbatim row for a key with an axis,
     never for a non-primary key: nobody ever asked the legacy row for that
     form or that gender;
   - else the key is claimed in `llmTranslationClaims`, and the primary key
     too when the primary row is missing, and one job carries both.
4. Annotations, audio under the key (the `skipTts` hatch, a card exists so
   buy audio anyway, applies to the primary rendering only), the timings
   backfill, and the stale sweeps: `translationVersion`, TTS setup, accent,
   and derivation (below). A copy is not counted as scheduled work.

## The job, `llmTranslationQueue.ts`

One job type: (text, language, keys[]), every key claimed by the enqueuing
mutation, so nothing inside the action waits or throws for another job.

1. The primary key first, when it is in the list: a fresh translation with
   the language-specific prompt. Then every other key: the versioning
   prompt (`buildVersioningPrompt`, the 2026-09-06 rewrite wording that won
   the A/B) from the primary wording to the key's form and/or gender. When
   the language marks neither axis the key asks to change, the primary
   wording is copied under the key without a call.
2. Every generated wording is verified with `verifyRendering`
   (`convex/features/renderingClassification.ts`: the rendering classifier
   on one sentence). A gender mismatch counts only where the language marks
   the first person; a politeness mismatch only when the key has a form,
   and `unmarked` passes only where `unmarkedIsAcceptable` (pronoun
   languages). On a mismatch, one retry with a `<previous_attempt>` block;
   a second mismatch stores the row with `renderingVerified: false`. A
   classifier outage stores the row unverified rather than blocking it.
3. Each row is stored through `storeTranslationAndScheduleTTS` with its key
   and `versionedFromText` when versioned; each store releases its own
   claim in the same transaction, so a retried action skips the keys that
   already landed and versions from the stored primary. If the chain is
   exhausted, the completion handler marks the claims still held
   `variantFailedAt` (24 h cooldown), so a sentence the model refuses is not
   re-bought on every card view; an accent rewrite falls back to the source
   text verbatim instead. There is no Google Translate fallback anywhere.
   A flagged or corrected non-primary row is rendered fresh with the
   dispute context rather than versioned, and stands on its own from then
   on.

## Wording changes

A flag, curriculum fix or version bump replaces one row through
`replaceTranslationRow` / `replaceForVersionBump`, which archive the old
wording (with its clip) for the cards pinned to it. Rows versioned from
that wording are not written to in that transaction. The next sweep finds
them derivation-stale (`versionedFromText !== primary.translatedText`) and
sends them through the same archive-then-replace path a `translationVersion`
bump uses. The store's `rewriteOf` guard drops a versioning of a primary
wording that moved on while the job ran.

## Prompts

`convex/features/translationLLM.ts` builds one language-specific prompt:
`<speaker_gender>` is always the voice, `<addressee_gender>` when the
sentence addresses someone, `<politeness_form>` with the form id when the
key has a form. The instructions carry the agreement and referent rules
(the source wins over the referent gender, never he into she), the
language's politeness block (`POLITENESS_CONFIG[code].intro` plus the
requested form's own instruction) when a form is requested, and nothing
about politeness otherwise. The three-level glossary that every language
used to share is gone. The best-of-N judge mirrors the same context.
Shared, dependency-free helpers in `lib/renderingPrompts.ts`
(`speakerInstruction`, `politenessInstruction`, `languagePolitenessBlock`,
`studiedFormsInstruction`, `studiedFormsLabel`) feed the translation
prompt, the versioning prompt, the judge, the chat forms section, the
quick actions and the autofill prompt, so chat and autofill get the course
settings per language.

Gate for prompt changes: `pnpm eval:adherence`, fresh arms, on ja, ko, de,
fr, ru, es, th, vi, hi, pl; noise is about 8 points on 40 sentences. A
language that loses beyond that gets a hint in its own config, never the
global glossary back.

## Invariants

1. One voice per text, decided from data or a seeded flip, written once.
   Nothing in the rendering path writes `texts` except that voice, the
   metadata gate's request stamps and the verdict.
2. Accessor-only reads. Every point read of `translations` pins all four
   columns of `by_text_language_variant_supersededAt` and every point read
   of `audioRecordings` pins all three of `by_text_language_variant`.
   Outside `convex/schema.ts`, only `convex/db/translationReads.ts` may
   name those indexes; the two claims tables carry an index of the same
   name, queried by `llmTranslationQueue.ts` and `ttsProcessing.ts`
   (`convex/tests/lib/translationsIndexInvariant.test.ts`).
3. Every row written after the cutover is labelled with a concrete voice
   and a form or `none`; the classifier verifies and never labels.
4. Legacy rows are never generated, adopted for a non-primary key, or
   relabelled. A card still on one keeps it; a flag on such a card
   replaces it.
5. A user text's rows are `<voice>|none` and follow the voice when a
   verdict moves it.
6. A rendering is never deleted because another was requested. A wording
   change archives; derivation staleness is a bump. Audio follows the same
   rule one level down: an `audioAssets` row is never deleted because the
   TTS setup changed; a stale pointer is detached with the asset kept and
   the fresh synthesis creates a sibling asset under the new setup. A keyed
   pointer speaks its key's voice and its row's wording (a clip that
   outlived its wording is detached); a legacy pointer is maintained only
   by the legacy views that play it, and re-voiced when a verdict fixes the
   sentence's own gender, so the clip matches the voice chip; the legacy
   wording itself is never corrected.
7. Claims are keyed, so two learners with the same preference share one
   job, and a job never waits on another.
8. No Google Translate. The LLM chain is the only producer; an exhausted
   chain leaves the claim failed with the cooldown and the card on its
   placeholder or legacy row.

## The cutover

Prod held only legacy rows and no settings-following cards on 2026-09-10,
so the storage contract changed without a data migration. Dev and staging
had run the pre-cutover build (`auto|…` rows, keyed pointers and claims
under the old key vocabulary, the rendering stamps, `firstPersonForms`).
The dropped columns stay in the schema as transitional `v.optional(v.any())`
fields until the runAll-chained migrations (`dropOldVocabularyTranslations`
and siblings in convex/migrations.ts: delete every row, pointer and claim
keyed in the old vocabulary, `auto` on either axis, and unset the dropped
columns) have run on every deployment; then the fields are dropped from the
schema (kanban card drop-rendering-cutover-columns). The first sweep after deploy spends one
Flash Lite metadata call per curriculum text a learner meets, once ever.
Cards learners already hold keep their translations; new cards come in the
chosen form in every language that marks it, adopting the legacy wording
where it already is that form.

## Benches

- `pnpm eval:metadata`: the sentence-metadata classifier on the gold
  corpora (`data_preparation/gender_eval`, `politeness_eval`).
- `pnpm eval:rendering`: the rendering classifier, now the verifier. Gemini
  3.1 Flash Lite with the product wording: 98.7% gender / 100% wild, 79.0%
  politeness gold / 92.6% wild, $0.18 per 1000 rows (2026-09-06).
- `pnpm eval:adherence`: does the prompt render the requested forms. The
  2026-09-07 A/B kept the current wrapper and per-form prompts (the
  candidate lost Japanese keigo on the rewrite path); those arms stay in
  `scripts/eval-adherence.ts` as `candidate`.
- `pnpm eval:autofill`: the nine preference-override cases must not regress
  when the autofill prompt changes.

All judge with `google/gemini-3.8-flash` and read the key from the
environment by name. Reports and caches live under `.scratch/<bench>/`.
