# 04 — Pipeline: ensure-variant sweep + slot writes

Status: resolved
Type: task
Blocked by: 03 (must be soaked in prod first)

The core slice. User-invisible (preference not yet settable → effective ==
canonical), but the destructive gender-drift sweep is deleted and all writes
become explicit-slot writes (immediate cost win: no more re-translating
unmarked languages on gender flips). Read `../spec.md` (Architecture;
Pipeline; Prompts → Translation; Edge cases).

## Scope
- `convex/features/decks.ts` `scheduleMissingContent` (:405) rewrite per spec:
  keep canonical `genderPatch`; compute effective gender; audio loop drops the
  `genderMismatch` delete branch and pairs audio to the effective variant's
  text; translation block becomes ensure-variant (delete
  `langsWithAudioGenderDrift`/`isDrifted`/`isLegacyAlongsideDriftedAudio`);
  version-staleness on effective row only; regionVariant pinning across
  variants; probe-mode parity for every new branch.
- `storeTranslationAndScheduleTTS` (:2710): slot lookup (legacy `undefined`
  row = canonical slot on marked / neutral on unmarked, then stamped
  explicitly); insert always stamps `translationGenderSlot(...)`; **variant
  collapse** (identical text → re-stamp sibling `'neutral'`, no insert);
  gender-scoped audio delete on flag-retranslation; gender-aware trailing TTS
  check.
- Claims (`llmTranslationQueue.ts` :79-185, `ttsProcessing.ts` :105-214):
  slot param end-to-end (store on insert, match on read, legacy undefined
  blocks all slots, per-slot takeover), enqueue args + completion contexts.
- `convex/lib/audioAssets.ts` `upsertAudioPointer` (:186): match pointer row
  by pointed asset's `voiceGender`; insert second row otherwise.
- `convex/features/translationLLM.ts`: `<speaker_gender>` + agreement
  instruction emitted only for marked target languages, phrased per tier
  (grammatical vs stylistic); unmarked targets get neither.
- `mayAddTranslationVariant` in `lib/translationProvenance.ts` (premade +
  machine row → true; user-created/human-authored → false).
- `flagTranslation` (scheduling.ts:1690): bump ALL variant rows, retranslate
  each slot (effective at caller priority, siblings background), caps per row.
- `regenerateCardAudio` (scheduling.ts:1820): delete only effective-gender
  pointers; other variant untouched.
- Collection preview (`collections.ts` ~:420, :634): effective-gender aware.
- `convex/db/translationSeed.ts` `batchUpsertTranslations`: canonical-slot
  lookup, explicit-slot stamps, drop sibling variants when wording changes.
- Warmups/admin: verify untouched (no pref arg → canonical path).

## Tests (convex-test, per spec Testing section)
Ensure-variant additive behavior + flip-back zero-writes; variant collapse;
unmarked = `'neutral'` + never gender-regenerated; pinned custom text; claims
per slot + legacy blocking; slot upsert with legacy row; flag-all-variants;
gender-scoped audio regen; probe parity (zero-write steady state); prompt
omits `<speaker_gender>` for unmarked targets; kill-switch-off ≡ baseline.

## Done when
`tsc`, lint, unit + convex-test green; deployed; prod logs show no new sweep
deletions; behavior identical for users (canonical everywhere).

## Answer

Implemented in commit `37b2d65` on `claude/gender-card-translation-plan-3vnuk5`; suites green (typecheck, convex + app vitest).
