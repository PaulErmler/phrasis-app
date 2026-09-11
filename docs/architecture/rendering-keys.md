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
a verdict when the sentence fixes its own speaker ("We are brothers"),
else one flip seeded on the text id, written into `audioSpeakerGender`
only. `texts.speakerGender` holds the verdict, and `metadataSource` says
who gave it; on a curriculum text an unstamped male/female is the flip the
pre-2026-09-10 sweep wrote back and is not evidence
(`definitiveSpeakerGender`, lib/sentenceMetadataSource.ts).

Where verdicts come from:

- Curriculum texts: the offline corpus scan (`pnpm classify:speaker`,
  lib/speakerGenderPrompt.ts). Its definitive verdicts are code
  (`convex/lib/speakerGenderVerdicts.ts`, emitted from the scan's CSV) and
  the `applySpeakerGenderVerdicts` migration writes them onto every
  deployment's texts with `runAll`, touching only those sentences. The
  dataset upload (`scripts/uploadOgteV1.mjs`) carries the CSV too, for
  texts uploaded after a deploy. No sweep classifies a curriculum text at
  runtime.
- User-written texts: the full classifier at creation
  (`applyTextMetadata`), which re-keys the text's rows in the same
  transaction and detaches the clips of the old voice when a verdict moves
  it.
- A Flag dialog "wrong speaker gender". The learner's pick becomes the
  text's voice, the sentence is checked with the scan's own prompt
  (`checkSpeakerGender`), and the shared row is retranslated for every
  card on it. A definitive verdict outranks the pick; a neutral one leaves
  it. Rows keyed or stamped for the old voice are re-rendered by the next
  sweep.

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
   its stamp, or when the voice it was written for (its key, or on a legacy
   row its `speakerGender` stamp) is not the sentence's.
4. `sweepInvalidAudio`: detach a pointer whose blob is gone, whose voice
   disagrees with the sentence's, whose asset speaks another wording, or
   whose provider / `ttsVersion` / accent has moved on. The asset is kept.
   A pass that may not synthesize (`skipTts`: the collection preview, the
   library) detaches only unplayable pointers; a stale but playable clip
   waits for the pass that can replace it.
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
withdrawn politeness build; its extra rows, pointers, claims and columns
were removed by the runAll-chained migrations of the previous deploy, and
the transitional columns went with this one.
