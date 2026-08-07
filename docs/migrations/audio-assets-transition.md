# audioAssets transition — reviewer notes and planned follow-up

Status: **transition phase** (shipped 2026-08-07). This document exists so a
reviewer of the current code knows which oddities are deliberate scaffolding
for a planned follow-up commit, and what that commit will do. Delete this file
as part of that follow-up.

## What shipped

TTS audio is content-addressed: `audioAssets` rows are keyed by
`(language, voiceGender, regionVariant, spokenTextHash)` and own the storage
blob + payload (voice, quality, speed, word timings, ttsVersion).
`audioRecordings` is now a thin `(textId, language) → assetId` pointer table.
Every audio-fill path checks the store before synthesizing
(`findReusableAudioAsset` in `convex/lib/audioAssets.ts`); a completed
synthesis patches the asset **in place by key**, which is what propagates a
regeneration (or a ttsVersion-bump re-synthesis) to every text sharing the
sentence. `migrations:backfillAudioAssets` folds legacy rows into assets, and
`migrations:deleteUnmigratedAudioRows` (runs after it in `runAll`) deletes the
rows the backfill deliberately skips, leaving the table fully pointer-shaped
after one deploy.

## Invariants a review should enforce

- **Completed synthesis always replaces.** A final write (`'validated'` or
  `'unvalidated'`) patches the shared asset unconditionally — regenerated
  audio must land even when validation failed. Only a mid-flight `'unknown'`
  write is refused against an asset that already has completed audio
  (`upsertAudioAsset` in `convex/lib/audioAssets.ts`).
- **The asset key uses the RAW spoken string.** No trim/NFC — normalization
  belongs exclusively to card-edit comparison (`convex/lib/textComparison.ts`).
  Lookups verify `spokenText` equality so hash collisions can only miss.
- **Every `audioRecordings` delete goes through `deleteAudioRow`**
  (`convex/lib/audio.ts`) — it refcounts pointers via `by_assetId` and deletes
  the asset + blob only on the last pointer.
- **Blob deletes are reference-checked against BOTH `by_storageId` indexes**
  (`audioRecordings` legacy rows AND `audioAssets`) until the narrow phase.
- **Superseded blobs are deleted on a delay** (`scheduleBlobSwapDelete`,
  10 min) so clients holding a just-issued signed URL don't 404.
- **Forced regeneration must bypass the cache** (`forceRegen` threaded from
  `regenerateCardAudio` → `scheduleMissingContent` →
  `scheduleAudioForLanguage` → job args); a cache hit would return exactly the
  audio the user asked to replace.

## Deliberately transitional code — do not flag as dead/redundant

These exist only until the narrow-phase commit below and are NOT oversights:

- The optional legacy payload fields on `audioRecordings` (`voiceName`,
  `storageId`, `ttsQuality`, `ttsProvider`, `voiceGender`, `speed`,
  `wordTimings`, `ttsVersion`) and every "legacy row" fallback branch:
  `audioPayloadFromRowAndAsset`, `deleteAudioRow`'s non-asset path,
  `updateAudioRecordingQuality`, `persistBackfilledWordTimings`, `editCard`'s
  payload-copy branch.
- The `by_text_and_language_and_voiceName` index — no live query uses it any
  more; retained so the initial deploy stays minimal-risk.
- The `audioRecordings.by_storageId` index and the dual-index check in
  `deleteStorageBlobIfUnreferenced` — needed while un-migrated editCard-era
  rows can still share a blob with an asset.
- `speed ?? 0.9` handling in the backfill: legacy assets keep their real
  synthesis speed, which intentionally makes them non-reusable for new texts
  (`findReusableAudioAsset` requires `speed === 1`) while still serving the
  texts that already point at them.
- The `voiceName` column at the END of `audioAssets.by_key` is unused by
  every current query (all use the 4-field prefix). It is forward-compat for
  a possible user-selectable favorite voice — see "Future work".

## Planned next commit: the narrow phase

Precondition: the current deploy's migrations have completed in prod and a
dashboard check confirms **zero** `audioRecordings` rows still carry a legacy
field. (Convex validates schema against existing documents at deploy time, so
a premature narrow fails the deploy safely — this ordering is also why the
narrow cannot ship in the same commit as the cleanup migration.)

The commit will:

1. Drop the eight legacy payload fields from `audioRecordings`, plus the
   `by_text_and_language_and_voiceName` and `by_storageId` indexes — leaving a
   pure pointer table `{textId, language, assetId}`.
2. Delete all legacy fallback branches listed above; `assetId` becomes
   required in practice (schema may keep `v.optional` only if rollout safety
   demands it — prefer required).
3. Simplify `deleteStorageBlobIfUnreferenced` to check only
   `audioAssets.by_storageId` — blob lifecycle collapses to "asset lifecycle
   plus delayed swap deletes".
4. Remove `backfillAudioAssets` and `deleteUnmigratedAudioRows` from `runAll`
   and delete their code and tests (they read the dropped fields and won't
   compile; fresh deployments have no legacy rows).
5. Optional: one-off orphan-blob sweep if dashboard storage didn't drop as
   expected (delayed-delete jobs interrupted by a redeploy). Note
   `ttsMismatches` rows legitimately reference their own blobs — a sweep must
   exclude those.
6. Delete this document.

## Future work (no commitment, but reviewers should not "clean up" its hooks)

- **Favorite voice per user**: switch `findAudioAssetByKey` and
  `upsertAudioAsset` to include `.eq('voiceName', …)` — the `by_key` index
  already ends in `voiceName`, so this is a code-only change. Caveat noted in
  the code: once identity is per-voice, `regenerateCardAudio` must pin the
  voice of the asset it replaces (today's random-within-gender re-roll would
  create a sibling asset and strand the other sharers on the old audio).
