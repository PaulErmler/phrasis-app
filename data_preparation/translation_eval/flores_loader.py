#!/usr/bin/env python3
"""
Download FLORES-200 devtest and write a 100-sentence "hard" sample to
data/flores_sample.csv with one column per target-language reference.

"Hard" sampling: pick the top tertile of sentences by English source length
(longer sentences correlate with more clauses, more agreement decisions, and
more disambiguation work — a reasonable cheap proxy for translation difficulty),
then take a deterministic random sample of SAMPLE_SIZE from that tertile.

Usage:
    python flores_loader.py
    python flores_loader.py --force-redownload
"""

from __future__ import annotations
import argparse
import hashlib
import random
import sys
from pathlib import Path

import pandas as pd

from config import (
    DATA_DIR,
    FLORES_SAMPLE_PATH,
    FLORES_SPLIT,
    SAMPLE_RANDOM_SEED,
    SAMPLE_SIZE,
    SOURCE_FLORES_CODE,
    TARGET_LANGUAGES,
    metadata_for_index,
)


def _short_hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]


def _load_flores_columns(flores_codes: set[str], split: str) -> dict[str, dict[int, str]]:
    """Return {flores_code -> {sentence_id -> text}} for the requested languages.

    Uses `openlanguagedata/flores_plus` (the Parquet successor to `facebook/flores`,
    which retired its script-based loader). One row per (sentence × language)
    with iso_639_3 + iso_15924 + id columns; we filter the flat table once and
    pivot into per-language dicts keyed by id (so we can align across languages).
    """
    from datasets import load_dataset  # imported lazily so --help works without HF installed

    wanted_pairs = {tuple(code.split("_", 1)): code for code in flores_codes}
    # Sanity: every code must be `iso_639_3_Script` shaped.
    for pair, code in wanted_pairs.items():
        if len(pair) != 2:
            raise ValueError(f"Bad FLORES code {code!r}; expected 'iso639_3_Script' form")

    ds = load_dataset("openlanguagedata/flores_plus", split=split)

    result: dict[str, dict[int, str]] = {code: {} for code in flores_codes}
    for row in ds:
        pair = (row["iso_639_3"], row["iso_15924"])
        code = wanted_pairs.get(pair)
        if code is None:
            continue
        result[code][row["id"]] = row["text"]

    for code in flores_codes:
        if not result[code]:
            raise RuntimeError(f"No rows found for {code} in flores_plus / {split}")
    return result


def build_sample(force: bool = False) -> Path:
    if FLORES_SAMPLE_PATH.exists() and not force:
        print(f"[flores_loader] {FLORES_SAMPLE_PATH} already exists — skip. Pass --force to rebuild.")
        return FLORES_SAMPLE_PATH

    print(f"[flores_loader] downloading FLORES+ / {FLORES_SPLIT} for source ({SOURCE_FLORES_CODE}) + {len(TARGET_LANGUAGES)} target slots…")

    # Collect distinct FLORES codes (es/es_latam share spa_Latn, etc.)
    distinct_flores = {SOURCE_FLORES_CODE} | {meta["flores"] for meta in TARGET_LANGUAGES.values()}
    columns_by_flores = _load_flores_columns(distinct_flores, FLORES_SPLIT)
    print(f"[flores_loader]   loaded {len(distinct_flores)} languages")

    source_by_id = columns_by_flores[SOURCE_FLORES_CODE]
    sentence_ids = sorted(source_by_id.keys())
    n_total = len(sentence_ids)
    print(f"[flores_loader]   {n_total} source sentences in {FLORES_SPLIT}")

    # Map internal codes to their reference dicts; two internal codes can share
    # the same FLORES reference (e.g. es/es_latam → spa_Latn).
    refs_by_internal_code: dict[str, dict[int, str]] = {
        code: columns_by_flores[meta["flores"]] for code, meta in TARGET_LANGUAGES.items()
    }

    # ── Pick the hard tertile (longest third by char-count) ──
    lengths_by_id = {sid: len(source_by_id[sid]) for sid in sentence_ids}
    threshold = sorted(lengths_by_id.values())[len(sentence_ids) * 2 // 3]
    hard_ids = [sid for sid, n in lengths_by_id.items() if n >= threshold]
    print(
        f"[flores_loader] {len(hard_ids)} sentences in the hard tertile "
        f"(char-count ≥ {threshold})"
    )

    if len(hard_ids) < SAMPLE_SIZE:
        raise RuntimeError(
            f"Hard tertile only has {len(hard_ids)} sentences but SAMPLE_SIZE={SAMPLE_SIZE}"
        )

    rng = random.Random(SAMPLE_RANDOM_SEED)
    sampled_ids = sorted(rng.sample(hard_ids, SAMPLE_SIZE))

    # ── Materialise the sample as a DataFrame ──
    records: list[dict] = []
    for sample_idx, sid in enumerate(sampled_ids):
        src = source_by_id[sid]
        metadata = metadata_for_index(sample_idx)
        record = {
            "sample_idx":       sample_idx,
            "flores_devtest_id": sid,
            "src_hash":         _short_hash(src),
            "src":              src,
            "src_len":          len(src),
            "speaker_gender":   metadata["speaker_gender"],
            "addressee_gender": metadata["addressee_gender"],
            "formality":        metadata["formality"],
        }
        for tgt_code in TARGET_LANGUAGES:
            ref = refs_by_internal_code[tgt_code].get(sid)
            if ref is None:
                raise RuntimeError(
                    f"FLORES id {sid} missing in language {tgt_code} — alignment broken"
                )
            record[f"ref_{tgt_code}"] = ref
        records.append(record)

    df = pd.DataFrame(records)
    DATA_DIR.mkdir(exist_ok=True)
    df.to_csv(FLORES_SAMPLE_PATH, index=False)
    print(f"[flores_loader] wrote {len(df)} rows to {FLORES_SAMPLE_PATH}")
    return FLORES_SAMPLE_PATH


def load_sample() -> pd.DataFrame:
    """Convenience reader for downstream stages."""
    if not FLORES_SAMPLE_PATH.exists():
        raise FileNotFoundError(
            f"{FLORES_SAMPLE_PATH} missing — run `python flores_loader.py` first."
        )
    return pd.read_csv(FLORES_SAMPLE_PATH)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--force-redownload", action="store_true",
                   help="Rebuild the sample even if data/flores_sample.csv already exists.")
    args = p.parse_args(argv)
    build_sample(force=args.force_redownload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
