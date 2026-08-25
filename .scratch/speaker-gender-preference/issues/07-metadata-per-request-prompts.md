# 07 — Metadata: per-request prompts + preference rung

Status: ready-for-agent
Type: task
Blocked by: 04, 06 (baseline report must exist for the before/after comparison)

Read `../spec.md` (Prompts → Metadata classifier; Metadata section; decision
6, 8, 12).

## Scope
- `convex/features/sentenceMetadata.ts`: replace the hardcoded gender-language
  prose list (:45-50) — and its sibling copy in
  `convex/features/customTexts.ts` (~:101) — with a per-request prompt
  builder: name only the request's languages whose config marks gender; if
  none is marked, the speakerGender instruction reduces to "return neutral".
  Export the builder for the eval runner.
- `applyTextMetadata` (:395, ladder :410-427): add the
  `generationSpeakerGender` rung (chat only): LLM definitive → prior row →
  generationSpeakerGender → seeded flip. Fix the seedless fallback at :427
  (pass `textId`).
- Translation-stamping loop (:514-526): explicit slots (resolved gender on
  marked languages, `'neutral'` on unmarked).
- Custom texts: NO preference threading (decision 6 — inference pins;
  autofill/import prompts unchanged apart from the shared list removal).
- Re-run `scripts/evalSentenceMetadata.mjs`; include the before/after
  per-language accuracy comparison in the PR description; add per-language
  prompt notes for languages under ~90% and re-run.

## Tests
Unit: prompt contains exactly the request's marked subset; config change
changes the prompt. convex-test: ladder rung ordering; seeded fallback
determinism; stamping slots.

## Done when
Suites green; eval comparison shows no regression (or regressions fixed via
prompt notes); deployed.
