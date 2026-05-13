#!/usr/bin/env python3
"""
Build two side-by-side German translation CSVs:
  data/sidebyside_flores_de.csv  — 50 FLORES sentences × {Gemini, DeepSeek} variants
  data/sidebyside_ogte_de.csv    — 100 OGTE sentences × {Gemini, DeepSeek} variants

Columns (FLORES):
  sample_idx, src, ref_de, comet_gemini_low, comet_deepseek_low,
  gemini_lite_min, gemini_lite_low, deepseek_low

Columns (OGTE):
  sample_idx, level, src_len, src,
  gemini_lite_min, gemini_lite_low, deepseek_low

Uses Prompt B (XML-structured) translations from translations_cache.csv for
FLORES; reads OGTE translations from data/ogte_cost_de.csv (one row per call,
includes the mt column).
"""

from __future__ import annotations
import sys
from pathlib import Path
import pandas as pd

DATA = Path(__file__).parent / "data"

PROMPT = "B_xml_structured"

# Model picks. DeepSeek max-think and Gemini med-think are dropped per the
# cost-validation outcome (both too expensive for marginal lift).
GEMINI_MIN = "gemini-3.1-flash-lite-min-think"
GEMINI_LOW = "gemini-3.1-flash-lite-low-think"
DEEPSEEK_LOW = "deepseek-v4-flash-low-think"


def build_flores() -> Path:
    sample = pd.read_csv(DATA / "flores_sample.csv")
    cache = pd.read_csv(DATA / "translations_cache.csv")
    scores = pd.read_csv(DATA / "comet_scores.csv")

    # Filter cache to prompt B, de, our 3 models, our 50 sample sentences.
    sample_hashes = set(sample["src_hash"])
    f = cache[
        (cache["prompt_id"] == PROMPT)
        & (cache["tgt_code"] == "de")
        & (cache["model_id"].isin([GEMINI_MIN, GEMINI_LOW, DEEPSEEK_LOW]))
        & (cache["src_hash"].isin(sample_hashes))
    ]
    wide_mt = f.pivot_table(
        index="src_hash", columns="model_id", values="mt", aggfunc="first"
    ).reset_index()

    s = scores[
        (scores["prompt_id"] == PROMPT)
        & (scores["tgt_code"] == "de")
        & (scores["model_id"].isin([GEMINI_LOW, DEEPSEEK_LOW]))
        & (scores["src_hash"].isin(sample_hashes))
    ]
    wide_comet = s.pivot_table(
        index="src_hash", columns="model_id", values="comet", aggfunc="first"
    ).reset_index()
    wide_comet = wide_comet.rename(columns={
        GEMINI_LOW: "comet_gemini_low",
        DEEPSEEK_LOW: "comet_deepseek_low",
    })

    out = (
        sample[["sample_idx", "src_hash", "src", "ref_de"]]
        .merge(wide_mt, on="src_hash", how="left")
        .merge(wide_comet, on="src_hash", how="left")
    )
    out = out.rename(columns={
        GEMINI_MIN: "gemini_lite_min",
        GEMINI_LOW: "gemini_lite_low",
        DEEPSEEK_LOW: "deepseek_low",
    })
    out = out[[
        "sample_idx", "src_hash", "src", "ref_de",
        "comet_gemini_low", "comet_deepseek_low",
        "gemini_lite_min", "gemini_lite_low", "deepseek_low",
    ]].sort_values("sample_idx")
    # The translation runs used --limit 50, so only the first 50 sample_idx
    # rows have all three model translations. Drop the rest so the side-by-side
    # only contains rows where every model has output.
    out = out.dropna(subset=["gemini_lite_min", "gemini_lite_low", "deepseek_low"])
    path = DATA / "sidebyside_flores_de.csv"
    out.to_csv(path, index=False)
    print(f"[flores] wrote {len(out)} rows to {path}")
    return path


def build_ogte() -> Path:
    df = pd.read_csv(DATA / "ogte_cost_de.csv")
    # Filter to the 3 model_ids we care about; drop max-think.
    df = df[df["model_id"].isin([GEMINI_MIN, GEMINI_LOW, DEEPSEEK_LOW])]
    wide = df.pivot_table(
        index="src_hash", columns="model_id", values="mt", aggfunc="first"
    ).reset_index()
    # Attach the source metadata from one of the model_id rows (they share src).
    meta = (
        df.drop_duplicates("src_hash")[
            ["src_hash", "sample_idx", "level", "src_len", "src",
             "addresses_someone", "ogte_formality"]
        ]
        .reset_index(drop=True)
    )
    out = meta.merge(wide, on="src_hash", how="left")
    out = out.rename(columns={
        GEMINI_MIN: "gemini_lite_min",
        GEMINI_LOW: "gemini_lite_low",
        DEEPSEEK_LOW: "deepseek_low",
    })
    out = out[[
        "sample_idx", "level", "src_len", "addresses_someone", "ogte_formality",
        "src", "gemini_lite_min", "gemini_lite_low", "deepseek_low",
    ]].sort_values(["level", "sample_idx"])
    path = DATA / "sidebyside_ogte_de.csv"
    out.to_csv(path, index=False)
    print(f"[ogte]   wrote {len(out)} rows to {path}")
    return path


if __name__ == "__main__":
    build_flores()
    build_ogte()
    sys.exit(0)
