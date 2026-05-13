#!/usr/bin/env python3
"""
COMET-22 (Unbabel/wmt22-comet-da) scoring over translations_cache.csv against
the FLORES references in flores_sample.csv. Writes per-row scores to
data/comet_scores.csv.

COMET is a neural reference-based metric (correlates ~0.8 with human MQM on
WMT data). One score per (prompt_id, model_id, src_hash, tgt_code) triple.

Usage:
    python score_comet.py                  # CPU
    python score_comet.py --gpu 0          # use CUDA device 0
    python score_comet.py --force-rescore  # ignore existing comet_scores.csv
"""

from __future__ import annotations
import argparse
import sys
from pathlib import Path

import pandas as pd

from config import (
    COMET_CACHE_PATH,
    FLORES_SAMPLE_PATH,
    TRANSLATIONS_CACHE_PATH,
)


COMET_COLUMNS = [
    "prompt_id", "model_id", "src_hash", "tgt_code",
    "src", "mt", "ref", "comet",
]


def _load_comet_model():
    """Lazy import so `--help` works without torch installed."""
    from comet import download_model, load_from_checkpoint
    path = download_model("Unbabel/wmt22-comet-da")
    return load_from_checkpoint(path)


def _build_scoring_inputs(
    translations: pd.DataFrame,
    sample: pd.DataFrame,
    already_scored: set[tuple],
) -> tuple[list[dict], list[tuple[str, str, str, str, str, str, str]]]:
    """Join translations with FLORES references; emit triples + index metadata.

    Returns (comet_inputs, index_rows) where `index_rows` is a list of
    (prompt_id, model_id, src_hash, tgt_code, src, mt, ref) tuples aligned
    1:1 with comet_inputs.
    """
    # Build src_hash → src and src_hash → ref_<tgt> lookups
    sample = sample.set_index("src_hash")
    src_by_hash = sample["src"].to_dict()

    comet_inputs: list[dict] = []
    index_rows: list[tuple] = []

    skipped_missing_mt = 0
    skipped_already_scored = 0
    skipped_missing_ref = 0

    for _, row in translations.iterrows():
        key = (row["prompt_id"], row["model_id"], row["src_hash"], row["tgt_code"])
        if key in already_scored:
            skipped_already_scored += 1
            continue
        mt = row["mt"]
        if pd.isna(mt) or not str(mt).strip():
            skipped_missing_mt += 1
            continue
        src = src_by_hash.get(row["src_hash"])
        if src is None:
            skipped_missing_ref += 1
            continue
        ref_col = f"ref_{row['tgt_code']}"
        if ref_col not in sample.columns:
            skipped_missing_ref += 1
            continue
        ref = sample.loc[row["src_hash"], ref_col]
        if pd.isna(ref) or not str(ref).strip():
            skipped_missing_ref += 1
            continue
        comet_inputs.append({"src": str(src), "mt": str(mt), "ref": str(ref)})
        index_rows.append((
            row["prompt_id"], row["model_id"], row["src_hash"], row["tgt_code"],
            str(src), str(mt), str(ref),
        ))

    print(
        f"[score_comet] queued {len(comet_inputs)} triples — "
        f"already_scored={skipped_already_scored} missing_mt={skipped_missing_mt} "
        f"missing_ref={skipped_missing_ref}"
    )
    return comet_inputs, index_rows


def score(force: bool, gpu: int | None, batch_size: int) -> Path:
    if not FLORES_SAMPLE_PATH.exists():
        raise FileNotFoundError(f"{FLORES_SAMPLE_PATH} not found — run flores_loader.py first")
    if not TRANSLATIONS_CACHE_PATH.exists():
        raise FileNotFoundError(f"{TRANSLATIONS_CACHE_PATH} not found — run run_eval.py first")

    sample = pd.read_csv(FLORES_SAMPLE_PATH)
    translations = pd.read_csv(TRANSLATIONS_CACHE_PATH)
    print(f"[score_comet] {len(translations)} translation rows, {len(sample)} reference rows")

    existing = pd.DataFrame(columns=COMET_COLUMNS)
    if COMET_CACHE_PATH.exists() and not force:
        existing = pd.read_csv(COMET_CACHE_PATH)
        print(f"[score_comet] loaded {len(existing)} previously-scored rows")
    already_scored = set(zip(
        existing["prompt_id"], existing["model_id"], existing["src_hash"], existing["tgt_code"]
    )) if not existing.empty else set()

    comet_inputs, index_rows = _build_scoring_inputs(translations, sample, already_scored)
    if not comet_inputs:
        print("[score_comet] nothing to score — exiting.")
        return COMET_CACHE_PATH

    print(f"[score_comet] loading Unbabel/wmt22-comet-da (first run downloads ~1.5 GB)…")
    model = _load_comet_model()

    print(f"[score_comet] running COMET on {len(comet_inputs)} triples "
          f"(batch_size={batch_size}, gpus={gpu if gpu is not None else 0})…")
    # num_workers > 0 is required by torch 2.11 when COMET's DataLoader passes a
    # multiprocessing_context kwarg; without it, predict() raises ValueError.
    out = model.predict(
        comet_inputs,
        batch_size=batch_size,
        gpus=1 if gpu is not None else 0,
        num_workers=2,
        progress_bar=True,
    )
    scores = out["scores"] if isinstance(out, dict) else out.scores

    new_records = [
        {
            "prompt_id": pid, "model_id": mid, "src_hash": sh, "tgt_code": tc,
            "src": src, "mt": mt, "ref": ref, "comet": float(score),
        }
        for (pid, mid, sh, tc, src, mt, ref), score in zip(index_rows, scores)
    ]
    additions = pd.DataFrame(new_records, columns=COMET_COLUMNS)
    combined = pd.concat([existing, additions], ignore_index=True)
    combined = combined.drop_duplicates(
        subset=["prompt_id", "model_id", "src_hash", "tgt_code"], keep="last"
    )
    combined.to_csv(COMET_CACHE_PATH, index=False)
    print(f"[score_comet] wrote {len(combined)} rows to {COMET_CACHE_PATH}")
    return COMET_CACHE_PATH


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--force-rescore", action="store_true",
                   help="Re-score everything even if comet_scores.csv exists.")
    p.add_argument("--gpu", type=int, default=None, help="CUDA device id; omit for CPU.")
    p.add_argument("--batch-size", type=int, default=16)
    args = p.parse_args(argv)
    score(force=args.force_rescore, gpu=args.gpu, batch_size=args.batch_size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
