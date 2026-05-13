# OGTE Sentence Dataset

Vocabulary-stratified English sentence dataset built on the OGTE-graded Tatoeba lists (https://www.manythings.org/tatoeba/ogte.html). Each sentence is assigned to one of 20 difficulty buckets (Alphabet → Native) plus an "Unlisted" bucket.

The pipeline produces `data/output/levels_final/` — one CSV per pedagogical level, ordered with the most useful sentences first for levels 01–08 (LLM-scored + reviewed) and frequency-ordered for L09 onward. The final dataset has **~20k sentences** across 20 files (L20 = Native is a merge of OGTE L20 + L99/Unlisted).

## Pipeline overview

```
Tatoeba sentences.csv ──┐
                        ├─► 1 vocab ──► 4 filter ──► 5 cap+augment+prune ──► levels/
sentences_in_lists.csv ─┘                       └─► 7 original-order copy ──► levels_original_order/

levels/ ──► 8 pedagogy score (L01-L08) ──► 10 reorder ──► levels_pedagogy_ordered/
                                                          │
                                                          └─► review agents ──► levels_pedagogy_ordered_reviewed/

levels/ + levels_pedagogy_ordered_reviewed/ ──► 11 build final ──► levels_final/  ◀── FINAL DATASET
```

## Inputs (must exist before running)

- `../data/inputs/sentences.csv` — Tatoeba bulk export, all languages, ~700 MB. (`tar -xjf` of `https://downloads.tatoeba.org/exports/sentences.tar.bz2`.)

The pipeline auto-runs the existing `read_tatoeba_dataset.py` to produce `../data/intermediate_outputs/english_sentences.csv` if it's missing.

## Run

```bash
# free, deterministic (steps 1-7)
python data_preparation/ogte-dataset/scripts/run_pipeline.py
```

```bash
# steps 8-11 require an OPENROUTER_API_KEY in data_preparation/.env
# scoring is paid (~$0.30 for L01-L08, ~$3.70 for all 21 levels)

# 1. Score curated levels 01-08 (resumable; skip already-scored ids)
python data_preparation/ogte-dataset/scripts/8_pedagogy_score.py \
    --full --levels 01,02,03,04,05,06,07,08 --from-folder levels \
    --model google/gemini-3.1-flash-lite-preview

# 2. Reorder L01-L08 by pedagogy
python data_preparation/ogte-dataset/scripts/10_reorder_curated_by_pedagogy.py \
    --levels 01,02,03,04,05,06,07,08

# 3. (Manual) Review L01-L08 with subagents — see "Review" below.

# 4. Build the final per-level dataset
python data_preparation/ogte-dataset/scripts/11_build_final_dataset.py
```

## Steps in detail

| # | Script | Purpose |
| ---: | --- | --- |
| 1 | `1_build_vocab.py` | Top-20k from Tatoeba ∩ top-20k from `wordfreq` → 14,876-word vocab. |
| 2 | `2_download_lists_export.py` | Download Tatoeba `sentences_in_lists.csv` bulk export. |
| 3 | `3_extract_ogte_sentences.py` | Inner-join OGTE list memberships with English sentences. |
| 4 | `4_filter_sentences.py` | Length ≤ 30 words, banned-words list, drop "Tom", profanity, near-duplicate dedup (trailing `.!?` collapse). |
| 5 | `5_score_and_export.py` | Per (OGTE level, max_wfs) bucket: cap at 2, then greedy coverage augmentation up to hard cap 3 (with novelty bypass for sentences contributing ≥2 new words), then min-2-occurrences-per-word pruning. Output: `levels/`. |
| 6 | `6_build_stats.py` + `6b_extra_stats.py` | Per-level stats, vocabulary growth plot, missing-words list, vocab-by-level dump. |
| 7 | `7_export_original_order.py` | Full filtered set in Tatoeba sentence-id order. Output: `levels_original_order/`. |
| 8 | `8_pedagogy_score.py` | Batch-score sentences 1–10 for pedagogical priority via OpenRouter (Gemini 3.1 Flash Lite or 2.5 Flash Lite). With `--from-folder levels`, scores only the curated subset. |
| 9 | `9_export_pedagogy_ordered.py` | (Alternative entry) Score the FULL pool then re-curate by pedagogy. Currently unused in the recommended flow but kept for completeness. |
| 10 | `10_reorder_curated_by_pedagogy.py` | Re-sort an already-curated `levels/*.csv` by pedagogy DESC (joins with `pedagogy_scores.csv`). No re-curation. Output: `levels_pedagogy_ordered/`. |
| 11 | `11_build_final_dataset.py` | Assemble `levels_final/` taking the reviewed file if present, otherwise the pedagogy-ordered, otherwise the frequency-ordered curated file. Merges L20+L99 into one Native file. |

## Curation algorithm (step 5)

For each `(ogte_level, max_wfs)` bucket within a level:
1. **Cap**: keep the top `--bucket-cap` (default 2) by frequency criterion (`max_wfs ASC, word_count ASC, id ASC`).
2. **Augment**: greedy max-coverage — repeatedly pick the candidate that adds the most uncovered in-vocab words, with two rules:
   - At most `--bucket-hard-cap` (default 3) sentences per bucket.
   - **Novelty bypass**: candidates contributing `--augment-novelty-threshold` (default 2) or more new in-vocab words ignore the bucket cap.
3. **Prune**: iteratively drop sentences (longest first) while keeping every in-vocab word in `≥ --min-word-occurrences` (default 2) kept sentences.

The first two phases recover most of the upper-level vocabulary that the strict cap=3 would lose; the prune pass removes redundant sentences without dropping any in-vocab word.

## Pedagogy scoring (step 8)

Async, batch-of-30, `aiohttp` directly against `https://openrouter.ai/api/v1/chat/completions`. Each batch carries 10 calibration anchor sentences (scored 1–10 by hand) so the model's scale stays consistent. Strict JSON-schema response. Resumable via id-set scan of `pedagogy_scores.csv`.

Cost on observed runs:
- Gemini 3.1 Flash Lite Preview: ~$0.041 per 1k sentences.
- Gemini 2.5 Flash Lite: ~$0.023 per 1k sentences.

The full 160k-sentence run is ~$3.70–$7. The L01–L08 scoring used here is ~$0.30.

## Review (manual, subagent-driven)

The repo doesn't ship review automation — instead, ask Claude Code to spawn 8 parallel `general-purpose` agents, one per level, against the files in `levels_pedagogy_ordered/`. Each agent removes (a) sexist content and (b) semantic near-duplicates, writing the cleaned CSV and a `*.review.md` log to `levels_pedagogy_ordered_reviewed/`. The prompt template used is in chat history; see `data/output/levels_pedagogy_ordered_reviewed/*.review.md` for examples of past reviews.

Total removed across L01–L08 in the latest run: 17 sexist + 344 near-duplicates = 361 sentences (8,144 → 7,783).

## Outputs

| Path | Purpose |
| --- | --- |
| `data/intermediate/merged_vocab.csv` | Tatoeba ∩ wordfreq vocabulary (14,876 words). |
| `data/intermediate/ogte_sentences_filtered.csv` | Full filtered pool (~160k sentences). |
| `data/intermediate/pedagogy_scores.csv` | LLM scores `(id, score, ogte_level)` — append-only, resumable. |
| `data/output/levels/` | Frequency-ordered curated CSVs per level. |
| `data/output/levels_original_order/` | Full filtered pool in Tatoeba sentence-id order. |
| `data/output/levels_pedagogy_ordered/` | Curated levels re-sorted by pedagogy DESC. |
| `data/output/levels_pedagogy_ordered_reviewed/` | Above + agent review (sexism + dup removal). |
| **`data/output/levels_final/`** | **The final dataset.** One CSV per pedagogical level (01–19 + 20 native), with provenance manifest `_sources.csv`. |
| `data/output/stats/` | Overview tables, vocab growth plot, missing words, samples. |
| `data/output/ogte_cefr_mapping.csv` | OGTE → CEFR mapping. |

All `data/` is gitignored — only scripts, README, and `requirements.txt` are tracked.

## Filters applied to sentences

- English only, deduplicated by exact text (case-sensitive) at the source.
- Length ≤ 30 words.
- No banned word (128-word list from `data_preparation/data_filtering/config.py`).
- No "Tom" (whole word, case-insensitive — Tom is dominant on Tatoeba).
- `better_profanity.contains_profanity()` is False.
- Near-duplicate dedup: trailing `.!?` collapse, lowercase comparison.

No LLM moderation — OGTE lists are already curated.

## Tunable parameters worth knowing

```bash
# step 5 (and step 9) — curation knobs
--bucket-cap 2                    # initial picks per (level, max_wfs)
--bucket-hard-cap 3               # max picks via augmentation; -1 = unlimited (legacy)
--augment-novelty-threshold 2     # candidates with this many new in-vocab words bypass the cap
--min-word-occurrences 2          # final prune: each in-vocab word in >= N kept sentences (0 = off)

# step 8 — scorer knobs
--model google/gemini-3.1-flash-lite-preview   # or google/gemini-2.5-flash-lite (~half price)
--from-folder levels                            # score curated subset, not full pool
--levels 01,02,03                               # restrict to specific OGTE levels
--pilot 100                                     # smoke-test a stratified sample
```
