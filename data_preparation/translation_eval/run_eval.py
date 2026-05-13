#!/usr/bin/env python3
"""
End-to-end orchestrator for the translation eval pipeline.

  1. Ensure the FLORES sample exists (delegates to flores_loader.build_sample).
  2. Translate the (prompt × model × sentence × target) grid via OpenRouter,
     using data/translations_cache.csv as a resumable store.
  3. Score every (prompt, model, sentence, target) cell with COMET-22 and
     write per-row scores to data/comet_scores.csv.
  4. Pivot into data/results.csv (one row per (prompt × model × target),
     with mean / p25 / count) and print a compact leaderboard to stdout.

Usage:
    python run_eval.py                              # full sweep
    python run_eval.py --limit 10 --langs es,de     # smoke test
    python run_eval.py --models gemini-3-flash gemini-3.1-flash-lite  # subset of models
    python run_eval.py --skip-comet                 # only run the API stage
    python run_eval.py --skip-translate             # only re-score from existing cache
"""

from __future__ import annotations
import argparse
import asyncio
import sys
from pathlib import Path

import pandas as pd

from config import (
    DEFAULT_CONCURRENCY,
    FLORES_SAMPLE_PATH,
    MODEL_PRICING,
    MODELS,
    PROMPTS,
    RESULTS_PATH,
    SAMPLE_SIZE,
    TARGET_LANGUAGES,
    TRANSLATIONS_CACHE_PATH,
    COMET_CACHE_PATH,
)
from flores_loader import build_sample, load_sample
from translate import translate_grid_async
from score_comet import score as score_comet


def _filter_models(model_ids: list[str] | None) -> list[dict]:
    if not model_ids:
        return MODELS
    by_id = {m["id"]: m for m in MODELS}
    missing = [m for m in model_ids if m not in by_id]
    if missing:
        raise SystemExit(
            f"Unknown model id(s): {missing}. Known: {list(by_id)}"
        )
    return [by_id[m] for m in model_ids]


def _filter_prompts(prompt_ids: list[str] | None) -> list[dict]:
    if not prompt_ids:
        return PROMPTS
    by_id = {p["id"]: p for p in PROMPTS}
    missing = [p for p in prompt_ids if p not in by_id]
    if missing:
        raise SystemExit(
            f"Unknown prompt id(s): {missing}. Known: {list(by_id)}"
        )
    return [by_id[p] for p in prompt_ids]


def _filter_langs(langs: list[str] | None) -> list[str]:
    if not langs:
        return list(TARGET_LANGUAGES.keys())
    missing = [l for l in langs if l not in TARGET_LANGUAGES]
    if missing:
        raise SystemExit(
            f"Unknown target lang(s): {missing}. Known: {list(TARGET_LANGUAGES)}"
        )
    return langs


def _pivot_results() -> pd.DataFrame:
    if not COMET_CACHE_PATH.exists():
        raise FileNotFoundError(
            f"{COMET_CACHE_PATH} missing — run scoring first (omit --skip-comet)."
        )
    scores = pd.read_csv(COMET_CACHE_PATH)
    if scores.empty:
        raise RuntimeError("comet_scores.csv is empty.")

    grouped = scores.groupby(["prompt_id", "model_id", "tgt_code"])["comet"]
    results = grouped.agg(
        comet_mean="mean",
        comet_p25=lambda s: s.quantile(0.25),
        comet_p75=lambda s: s.quantile(0.75),
        n="count",
    ).reset_index()
    results.to_csv(RESULTS_PATH, index=False)
    return results


def _print_cost_summary() -> None:
    """Per-model cost roll-up keyed off the translations cache + FLORES sample.

    Reports: total input/output tokens, total USD spent, average source-character
    count per call, and cost per **1M source characters** (the most stable
    comparison metric since output-token counts vary wildly between thinking-on
    and thinking-off models on the same source).
    """
    if not TRANSLATIONS_CACHE_PATH.exists() or not FLORES_SAMPLE_PATH.exists():
        return
    cache = pd.read_csv(TRANSLATIONS_CACHE_PATH)
    if cache.empty:
        return
    sample = pd.read_csv(FLORES_SAMPLE_PATH)[["src_hash", "src_len"]]
    joined = cache.merge(sample, on="src_hash", how="left")

    print("\n=== Cost summary (per model) ===")
    header = (
        f"{'model_id':<32}"
        f"{'calls':>7}"
        f"{'in_tok':>10}"
        f"{'out_tok':>10}"
        f"{'cost_USD':>12}"
        f"{'src_chars':>12}"
        f"{'$/M_src_chr':>14}"
    )
    print(header)
    print("-" * len(header))

    grand_cost = 0.0
    grand_src_chars = 0
    for model_id, g in joined.groupby("model_id"):
        price = MODEL_PRICING.get(model_id)
        in_tok = int(g["input_tokens"].fillna(0).sum())
        out_tok = int(g["output_tokens"].fillna(0).sum())
        src_chars = int(g["src_len"].fillna(0).sum())
        if price is None:
            cost = float("nan")
            per_m = float("nan")
        else:
            cost = (in_tok * price["input_per_m"] + out_tok * price["output_per_m"]) / 1_000_000
            per_m = (cost / src_chars * 1_000_000) if src_chars else float("nan")
            grand_cost += cost
            grand_src_chars += src_chars
        print(
            f"{model_id:<32}"
            f"{len(g):>7}"
            f"{in_tok:>10}"
            f"{out_tok:>10}"
            f"{cost:>12.4f}"
            f"{src_chars:>12}"
            f"{per_m:>14.2f}"
        )
    if grand_src_chars:
        print("-" * len(header))
        print(
            f"{'TOTAL':<32}"
            f"{len(joined):>7}"
            f"{'':>10}"
            f"{'':>10}"
            f"{grand_cost:>12.4f}"
            f"{grand_src_chars:>12}"
            f"{(grand_cost / grand_src_chars * 1_000_000):>14.2f}"
        )


def _print_leaderboard(results: pd.DataFrame) -> None:
    print("\n=== Leaderboard: mean COMET by (prompt × model × target) ===")
    pivot = results.pivot_table(
        index=["prompt_id", "model_id"],
        columns="tgt_code",
        values="comet_mean",
    )
    # Add a row-level mean across all target langs for a quick global ranking.
    pivot["__mean__"] = pivot.mean(axis=1)
    pivot = pivot.sort_values("__mean__", ascending=False)
    with pd.option_context(
        "display.max_columns", None,
        "display.width", 240,
        "display.float_format", lambda f: f"{f:.4f}",
    ):
        print(pivot)
    print(f"\nFull per-(prompt, model, lang) results: {RESULTS_PATH}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--limit", type=int, default=None,
                   help=f"Use only the first N sample sentences (debug; default: {SAMPLE_SIZE}).")
    p.add_argument("--models", nargs="*", default=None,
                   help="Subset of model ids from config.MODELS to evaluate.")
    p.add_argument("--prompts", nargs="*", default=None,
                   help="Subset of prompt ids from config.PROMPTS to evaluate.")
    p.add_argument("--langs", nargs="*", default=None,
                   help="Subset of target language codes (e.g. es de fr).")
    p.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY,
                   help=f"Async semaphore size for OpenRouter calls (default {DEFAULT_CONCURRENCY}).")
    p.add_argument("--skip-translate", action="store_true",
                   help="Skip the API stage; score only.")
    p.add_argument("--skip-comet", action="store_true",
                   help="Skip the COMET stage; translate only.")
    p.add_argument("--comet-gpu", type=int, default=None,
                   help="CUDA device id for COMET (omit for CPU).")
    p.add_argument("--force-redownload-flores", action="store_true",
                   help="Re-download the FLORES sample even if it exists.")
    args = p.parse_args(argv)

    build_sample(force=args.force_redownload_flores)
    sample = load_sample()
    if args.limit is not None:
        sample = sample.head(args.limit)

    prompts = _filter_prompts(args.prompts)
    models = _filter_models(args.models)
    langs = _filter_langs(args.langs)

    print(
        f"[run_eval] grid: {len(prompts)} prompts × {len(models)} models × "
        f"{len(sample)} sentences × {len(langs)} target languages = "
        f"{len(prompts) * len(models) * len(sample) * len(langs)} calls (cache-aware)"
    )

    if not args.skip_translate:
        asyncio.run(translate_grid_async(
            sample, prompts=prompts, models=models, target_codes=langs,
            concurrency=args.concurrency,
        ))

    if not args.skip_comet:
        score_comet(force=False, gpu=args.comet_gpu, batch_size=16)
        results = _pivot_results()
        _print_leaderboard(results)

    _print_cost_summary()

    return 0


if __name__ == "__main__":
    sys.exit(main())
