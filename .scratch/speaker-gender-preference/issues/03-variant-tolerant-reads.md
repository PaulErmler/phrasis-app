# 03 — Variant-tolerant reads (readers before writers)

Status: ready-for-agent
Type: task
Blocked by: 01, 02

Behavior-neutral on today's single-row data. **This slice must be fully
deployed and soaked in prod before slice 04 ships** — `cardContent.ts:375`
`.unique()` throws the moment a second translations row exists. Read
`../spec.md` (Pipeline → Serve path; Edge cases → deploy order).

## Scope
Audit every `translations`/`audioRecordings` read that assumes one row per
(text, language) and make it `.take(4)` + picker:
- `convex/lib/cardContent.ts`: batch reads (:147-161), searchable text
  `.unique()` (:375 → canonical pick, preference-independent).
- `convex/features/scheduling.ts` serve reads (`getCardForReview` :224).
- `convex/features/decks.ts` internal getters; `getDeckCards` (:860).
- `convex/features/collections.ts` preview reads (:251, ~:420, :634).
- `convex/features/library.ts` (:352), `convex/features/stats.ts` (:562).
- `convex/features/scheduling.ts` `flagTranslation` fetch (:1690).
- `convex/features/ttsProcessing.ts` row-locates:
  `updateAudioRecordingQuality` (:679), `persistBackfilledWordTimings` (:842)
  → find row by asset match instead of `.first()`.
- Placement test / onboarding first lesson (`placementTest.ts`,
  `onboarding.ts`): route through a small `getCanonicalTranslation(ctx,
  textId, lang)` helper (canonical pick; intentionally preference-free).
- `convex/features/chat/cardContext.ts` (:49): canonical row per language.
- Helper: canonical-pick lives beside `pickTranslationVariant` (from 01).

## Tests
convex-test: all reads return the same result on single-row data as before;
synthetic two-row fixtures (male+female, neutral+legacy) return the canonical
row from canonical-pick sites and never throw.

## Done when
`tsc`, lint, unit + convex-test green; deployed; no user-visible change.
