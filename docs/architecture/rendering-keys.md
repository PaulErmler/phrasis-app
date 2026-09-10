# One translation per sentence, keyed by its voice

How a sentence's translation and audio are produced, kept current and
served. One file for the rule every reader and writer follows.

Related: `docs/architecture/audio-assets.md` (the content-addressed clip
store), `docs/architecture/translation-archive.md` (superseded revisions).

## The model in one paragraph

A `texts` row is the identity of a meaning. It has ONE voice
(`audioSpeakerGender`) and, per language, ONE live `translations` row and
ONE `audioRecordings` pointer. Every row and pointer is stamped with the
voice it was written for, its RENDERING KEY (`variantKey`, `'male'` or
`'female'`, built by `renderingKey` in lib/preferenceResolution.ts). The
key is a label, not a lookup column: with one live row per (text,
language) there is nothing to disambiguate, so reads pin
`by_text_language_supersededAt` and the writers and the verifier are the
only code that reads a key.

## The layers

- `texts`: the meaning, the voice, and the sentence metadata a classifier
  can fix (`speakerGender`, `register`, `metadataSource`).
- `translations`: one live row per (text, language), plus the superseded
  revisions a pinned card still reads.
- `audioRecordings`: one pointer per (text, language), into the shared
  `audioAssets` store.
- `llmTranslationClaims` / `ttsGenerationClaims`: one claim per (text,
  language), so two learners meeting the same sentence share one job.

## The voice

`resolveCardSpeakerGenders` (lib/voices.ts) decides it once and keeps it:
the classifier's verdict when the sentence fixes its own speaker ("We are
brothers"), else one flip seeded on the text id, written into
`audioSpeakerGender` only. `texts.speakerGender` stays the classifier's
verdict, so a reader can tell evidence from a flip
(lib/sentenceMetadataSource.ts).

Two things move the voice:

- A classifier verdict (`applyTextMetadata`). It re-keys the text's rows in
  the same transaction and detaches the clips of the old voice, so the next
  sweep re-voices them.
- A Flag dialog "wrong speaker gender". The learner's pick becomes the
  text's voice, the classifier is asked about the sentence in the same
  breath, and the shared row is retranslated for every card on it. The
  classifier is reached ONLY here: no sweep classifies a curriculum
  sentence up front.

## Who reads what

`resolveServedRendering` and the batched `buildTextContentBatchForLanguages`
(convex/lib/cardContent.ts) are the two readers; the accessor rule below
keeps them the only ones. A card reads the live row of its language,
resolved to the revision that was live at its PIN
(`translationsAcceptedAt`, else `_creationTime`), so an existing learner
keeps the wording they learned. Its clip is the pointer of that language,
or the archived revision's own asset when the pin resolves to one.

## The sweep, `ensureTextContent`

One entry point for every surface (review, library, collection preview,
warm loops, card edit, audio regeneration). In order:

1. Decide the voice and write it if it was never written.
2. Load every required language's rows, pointer and claim in one round.
3. `sweepStaleTranslations`: regenerate a row in place through the
   version-bump path when the language's `translationVersion` moved past
   its stamp, or when its key names the other speaker.
4. `sweepInvalidAudio`: detach a pointer whose blob is gone, whose voice
   disagrees with the sentence's, whose asset speaks another wording, or
   whose provider / `ttsVersion` / accent has moved on. The asset is kept.
5. Fill the gaps per language: the missing row, its annotations
   (romanization, IPA, furigana), its audio, its word timings, and the same
   for every superseded revision a pinned card still reads.

## The job, `llmTranslationQueue.ts`

`enqueueRenderingJob` claims (text, language) and enqueues ONE job that
renders the row for the text's voice. `verifyRendering`
(convex/features/renderingClassification.ts) then asks the rendering
classifier whether the wording reads as written by that speaker, and one
retry carries the rejected attempt in the prompt. A second mismatch is
stored as it is, marked `renderingVerified: false`. A language whose
wording does not change with the speaker is never classified. There is no
Google Translate fallback: an exhausted chain leaves the claim failed for
`VARIANT_RETRY_COOLDOWN_MS` and the card on its current row.

## Wording changes

A regeneration never deletes. `storeTranslationAndScheduleTTS` restamps an
identical result, or copies the old wording into a superseded revision
(with its audio asset) before replacing the live row, so a card pinned
before the change keeps what it learned. Audio follows one level down: an
`audioAssets` row is never deleted because the TTS setup changed; a stale
pointer is detached with the asset kept, and the fresh synthesis creates a
sibling asset under the new setup, so a provider or prompt change can be
rolled back for free.

## Invariants

1. One voice per text, decided from data or a seeded flip, written once.
2. ONE live `translations` row and ONE `audioRecordings` pointer per (text,
   language). A voice change re-keys the row it has; nothing adds a second.
3. Accessor-only reads. Outside `convex/schema.ts`, only
   `convex/db/translationReads.ts` may name the translation and audio
   indexes (`convex/tests/lib/translationsIndexInvariant.test.ts`).
4. Every row written by this pipeline carries the voice it was written for,
   on `variantKey` and on `speakerGender`.
5. Nothing is deleted because it went stale. A wording change archives; a
   stale clip is detached with its asset kept.
6. Claims are per (text, language), so two learners share one job.
7. No Google Translate.

## The cutover

Production held only unkeyed rows when this shipped, so the storage
contract changed without a data migration. Dev and staging had run the
withdrawn politeness build, whose extra rows, pointers, claims and columns
the runAll-chained migrations in convex/migrations.ts remove. The
transitional `v.optional(v.any())` columns in `convex/schema.ts` are
dropped once those have run everywhere (kanban card
drop-rendering-cutover-columns).
