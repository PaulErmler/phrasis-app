# 06 — Classifier gold dataset + eval runner + baseline

Status: ready-for-agent
Type: task
Blocked by: 01 (needs the config for the marked-language list)

Read `../spec.md` (section: Classifier gold dataset & accuracy eval). No app
code changes; landable in parallel with 02–05.

## Scope
- `data_preparation/gender_eval/data/<languageCode>.jsonl` — 10–50 sentences
  per marked language (34 langs; dialect variants share base files where the
  phenomenon is identical, Arabic dialects get variant-specific entries) +
  5–10 negative controls each for en, de, zh, tr, fi, id. Record shape:
  `{ language, text, expected: 'male'|'female'|'neutral', phenomenon, glossEn, sourceUrl, notes? }`.
- Coverage per language: definitive male, definitive female,
  neutral-despite-marked (third person), and confusion edge cases
  (addressee-not-speaker e.g. ru "ты сказала", referent-not-speaker, quoted
  speech, particles th ครับ/ค่ะ, pronouns ja 僕/あたし, audible vs
  written-only fr, pt obrigado/obrigada).
- **The 100% bar**: sentences from authoritative reference websites
  (reference grammars, Wiktionary inflection tables), `sourceUrl` per entry,
  exact marker named; verify each entry against its source AND two
  independent LLM cross-checks; DROP anything with any disagreement or
  ambiguity — fewer verified entries beat padding. Under 10 airtight entries
  for a language → ship fewer and note the gap in the README.
- `data_preparation/gender_eval/README.md`: schema, curation rules, gaps.
- `scripts/evalSentenceMetadata.mjs` (pattern `scripts/updateTranslations.mjs`):
  imports the classifier prompt builder exported from
  `convex/features/sentenceMetadata.ts` (export it; single source of truth),
  calls OpenRouter with the production classifier model, writes
  `data_preparation/gender_eval/reports/<date>.md` (per-language accuracy,
  per-class precision/recall, misclassified list). On-demand, not CI.
- Run the **baseline report against the CURRENT prompt** and commit it.

## Done when
Dataset + README + runner committed; baseline report generated and committed;
every entry carries a sourceUrl and named marker.
