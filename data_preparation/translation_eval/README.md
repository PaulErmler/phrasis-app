# Translation prompt + model evaluation

Self-contained pipeline that benchmarks two candidate **prompts** against four candidate **OpenRouter models** on 100 hard FLORES-200 sentences, scored with **COMET-22** (`Unbabel/wmt22-comet-da`).

The output (`data/results.csv`) tells us, per (prompt × model × target language), the mean COMET score — i.e. which prompt+model combo to pick as the default before wiring LLM translation into the Convex backend.

## What's under test

**Prompts** (defined in [prompts.py](prompts.py)):
- `A_pure_prose` — flat WMT24++-style prose prompt; safer on smaller / quantized models.
- `B_xml_structured` — Gemini-3-aligned XML-tagged context block; the recommended default per the source spec.

**Models** (defined in [config.py](config.py) → `MODELS`):
- `gemini-3-flash` — `google/gemini-3-flash-preview`, default reasoning.
- `gemini-3-flash-high-think` — same model, `reasoning: {effort: "high"}`.
- `gemini-3.1-flash-lite` — `google/gemini-3.1-flash-lite-preview` (high-resource-language candidate).
- `gemini-2.5-flash-lite-baseline` — `google/gemini-2.5-flash-lite` (already used elsewhere in the project; serves as a cheap baseline).

**Target languages**: the 16 production target languages (`es, fr, de, it, pt, ru, hi, zh, ja, ko, vi, sv, fi, nl, el, ar`). `es_latam` and `es` share the same FLORES reference (FLORES doesn't split Spain/LatAm), so they're folded together in the grid by default.

**Metric**: COMET-22 (`Unbabel/wmt22-comet-da`). Reference-based, neural, correlates ~0.8 with human MQM on WMT data. Loads ~1.5 GB of weights the first time it runs; cached afterwards. CPU is fine for 100 sentences × 16 langs × 8 (prompt × model) = 12 800 triples (~10 min on M-series).

## Grid size & cost

| dimension | size |
|----------|------|
| prompts | 2 |
| models | 4 |
| sentences | 100 |
| target langs | 16 |
| **total API calls** | **12 800** |

At OpenRouter Flash-Lite pricing ($0.10 / $0.40 per M tokens in/out) and ~80 in / ~50 out tokens per call, a full sweep costs **< $5**. The COMET pass is free (local CPU).

The cache at `data/translations_cache.csv` is keyed by `(prompt_id, model_id, src_hash, tgt_code)`, so reruns skip completed cells. Crashing mid-sweep loses at most one checkpoint interval (50 calls).

## Setup

```bash
cd data_preparation/translation_eval
pip install -r requirements.txt          # installs unbabel-comet + datasets on top of the conda env

# OpenRouter key — same key used elsewhere in the project
export OPENROUTER_API_KEY=sk-or-...
# (or add it to data_preparation/.env / data_preparation/translation_eval/.env)
```

## Run

```bash
# 1. Download FLORES-200 devtest and write the 100-sentence sample.
python flores_loader.py

# 2. Smoke test (10 sentences, one model, two languages — should finish in ~30 s).
python run_eval.py --limit 10 --models gemini-3.1-flash-lite --langs es de

# 3. Full sweep.
python run_eval.py

# Useful subsets:
python run_eval.py --prompts B_xml_structured                 # only Prompt B
python run_eval.py --models gemini-3-flash gemini-3.1-flash-lite
python run_eval.py --langs es fr de                            # only high-resource langs
python run_eval.py --skip-translate                            # rescore existing cache
python run_eval.py --skip-comet                                # API stage only
```

`run_eval.py` prints a leaderboard table at the end and writes the long-form CSV to `data/results.csv`.

## Output files

```
data/
├── flores_sample.csv        # 100 source sentences + per-target-language references + synthetic metadata
├── translations_cache.csv   # one row per (prompt × model × sentence × target) API call (resumable)
├── comet_scores.csv         # one row per (prompt × model × sentence × target) with COMET score
└── results.csv              # pivoted: one row per (prompt × model × target) with comet_mean / p25 / p75 / n
```

The leaderboard printed by `run_eval.py` is a quick visual of `results.csv` pivoted as `(prompt, model)` rows × `tgt_code` columns, sorted by overall mean COMET.

## Sampling: what makes a sentence "hard"?

`flores_loader.py` takes the **longest-third** of FLORES-200 devtest sentences by English character count, then deterministically samples 100 of them (`SAMPLE_RANDOM_SEED = 20260512` in `config.py`). Longer sentences correlate with more clauses, more agreement decisions, and more disambiguation work — a cheap proxy for translation difficulty without needing reference scores.

If you'd rather sample uniformly, edit `build_sample()` in `flores_loader.py` (the `hard_indices` filter is two lines).

## Synthetic metadata

FLORES sentences ship without speaker / addressee / register annotations, so each sampled sentence gets deterministic synthetic metadata (`speaker_gender`, `addressee_gender`, `formality`) via `metadata_for_index()` in [config.py](config.py). Both prompts see the same metadata for the same sentence — an apples-to-apples comparison.

This means COMET is the only quality signal here. **COMET is less sensitive to gender/register adherence than humans**, so two prompts that produce the same lexical output but disagree on gendered pronouns can score similarly. If the Phase-1 results across prompts are close (≤0.005 COMET delta), do a follow-up evaluation that hand-annotates 50 sentences with expected target-language register/gender markers and grades pass/fail rates programmatically.

## Files

| file | purpose |
|------|---------|
| `config.py` | OpenRouter endpoint, target language list, FLORES code map, model grid, prompt list, metadata assignment |
| `prompts.py` | `PROMPT_A_PURE_PROSE`, `PROMPT_B_XML_STRUCTURED`, plus `render_prompt()` that strips missing metadata cleanly |
| `flores_loader.py` | downloads FLORES-200 / devtest, samples 100 hard sentences, writes `data/flores_sample.csv` |
| `translate.py` | async OpenRouter batch translator with resumable CSV cache |
| `score_comet.py` | loads Unbabel/wmt22-comet-da, scores everything in the translation cache, writes `data/comet_scores.csv` |
| `run_eval.py` | end-to-end orchestrator + leaderboard pretty-printer |
