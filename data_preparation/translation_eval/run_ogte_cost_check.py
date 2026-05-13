#!/usr/bin/env python3
"""
Measure real production translation cost for `gemini-3.1-flash-lite-preview`
in two reasoning modes (no/minimal-think vs medium-think) against
**100 sentences drawn from the actual OGTE dataset** (5 per level × 20 levels).

Why this matters: the FLORES random sample averaged 132 src chars/sentence;
OGTE spans L01 alphabet/greeting (~10–25 chars) through L20 native (~80+ chars).
Reasoning overhead is largely fixed per call, so $/M src chars rises sharply
on short sentences. This script gives a per-level cost breakdown so we can
decide whether to default to med-think or hybrid (med-think only for L10+).

Inputs:
  data_preparation/ogte-dataset/data/output/levels_curated/ogte_*.csv

Outputs:
  data/ogte_cost_de.csv — one row per (model × sentence) with src, level,
    src_len, mt, input_tokens, output_tokens, latency_ms, cost
  stdout — per-model totals + level-stratified $/M src chars

Usage:
  python run_ogte_cost_check.py
  python run_ogte_cost_check.py --per-level 5     # 5 sentences per level (default)
  python run_ogte_cost_check.py --per-level 2     # smoke (40 sentences total)
  python run_ogte_cost_check.py --seed 12345      # different random sample
"""

from __future__ import annotations
import argparse
import asyncio
import hashlib
import os
import random
import sys
import time
from pathlib import Path

import pandas as pd
from openai import AsyncOpenAI

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

from config import (
    DEFAULT_CONCURRENCY,
    DEFAULT_TIMEOUT_S,
    MAX_OUTPUT_TOKENS,
    MODEL_PRICING,
    OPENROUTER_BASE_URL,
    TARGET_LANGUAGES,
    metadata_for_index,
)
from prompts import PROMPT_B_XML_STRUCTURED, render_prompt


# ── Models under test ────────────────────────────────────────────

MODELS = [
    {
        "id":        "gemini-3.1-flash-lite-min-think",
        "slug":      "google/gemini-3.1-flash-lite-preview",
        "reasoning": None,            # no explicit reasoning field — equivalent to minimal
    },
    {
        "id":        "gemini-3.1-flash-lite-low-think",
        "slug":      "google/gemini-3.1-flash-lite-preview",
        "reasoning": "low",
    },
    {
        "id":        "gemini-3.1-flash-lite-med-think",
        "slug":      "google/gemini-3.1-flash-lite-preview",
        "reasoning": "medium",
    },
    {
        "id":        "deepseek-v4-flash-low-think",
        "slug":      "deepseek/deepseek-v4-flash",
        "reasoning": "low",
    },
    # NB: `deepseek-v4-flash-max-think` (reasoning='xhigh') was removed —
    # measured at $13/M src chars on OGTE for marginal quality gain. The
    # OGTE results CSV still has historical rows from earlier runs.
]

# Hybrid policy: short sentences (len < 30) use min-think; longer use low-think.
HYBRID_LENGTH_THRESHOLD = 30
HYBRID_SHORT_MODEL = "gemini-3.1-flash-lite-min-think"
HYBRID_LONG_MODEL  = "gemini-3.1-flash-lite-low-think"

PROMPT_ID = "B_xml_structured"
TGT_CODE  = "de"
OGTE_DIR  = Path(__file__).parent.parent / "ogte-dataset" / "data" / "output" / "levels_curated"
DEFAULT_PER_LEVEL = 5
DEFAULT_SEED      = 20260512


def short_hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]


# ── Sample loader ────────────────────────────────────────────────

def load_ogte_sample(per_level: int, seed: int) -> pd.DataFrame:
    """5 (or per_level) random sentences from each of the 20 OGTE levels."""
    files = sorted(OGTE_DIR.glob("ogte_*.csv"))
    if not files:
        raise FileNotFoundError(f"No ogte_*.csv files in {OGTE_DIR}")
    rng = random.Random(seed)
    rows = []
    sample_idx = 0
    for f in files:
        df = pd.read_csv(f)
        # Some CSVs may have NaN text rows — drop them.
        df = df[df["text"].notna() & (df["text"].str.len() > 0)]
        if len(df) == 0:
            print(f"[ogte_sample] {f.name}: empty after NaN filter — skipping")
            continue
        # Sample without replacement; if a level has fewer rows than per_level,
        # take everything available.
        n = min(per_level, len(df))
        picks = df.sample(n=n, random_state=rng.randint(0, 10**9))
        for _, r in picks.iterrows():
            src = str(r["text"]).strip()
            # Map OGTE columns to our metadata schema:
            # register='direct-address' → addresses_someone=True; 'descriptive' → False
            # formality: 'formal'/'informal'/'neutral' for direct-address; 'n/a' for descriptive
            addresses_someone = str(r.get("register","")).strip() == "direct-address"
            formality_raw = str(r.get("formality","")).strip().lower()
            formality = formality_raw if formality_raw in ("formal","informal","neutral") else None
            # Apply synthetic metadata for the in-prompt gender fields (deterministic per sample_idx)
            meta = metadata_for_index(sample_idx)
            rows.append({
                "sample_idx":        sample_idx,
                "ogte_id":           str(r.get("id","")),
                "level":             str(r.get("ogte_level","")),
                "src_hash":          short_hash(src),
                "src":               src,
                "src_len":           len(src),
                "addresses_someone": addresses_someone,
                "ogte_formality":    formality if addresses_someone else None,
                "speaker_gender":    meta["speaker_gender"],
                "addressee_gender":  meta["addressee_gender"] if addresses_someone else None,
                "formality":         (formality or meta["formality"]) if addresses_someone else None,
            })
            sample_idx += 1
    sample = pd.DataFrame(rows)
    print(
        f"[ogte_sample] {len(sample)} sentences total across {len(files)} levels "
        f"(per_level={per_level}, seed={seed})"
    )
    print(
        f"[ogte_sample] src_len: mean={sample['src_len'].mean():.1f}, "
        f"median={sample['src_len'].median():.0f}, "
        f"min={sample['src_len'].min()}, max={sample['src_len'].max()}"
    )
    print(
        f"[ogte_sample] direct-address: {int(sample['addresses_someone'].sum())} / "
        f"{len(sample)} ({100*sample['addresses_someone'].mean():.0f}%)"
    )
    return sample


# ── OpenRouter caller ────────────────────────────────────────────

async def translate_one(client: AsyncOpenAI, row: pd.Series, model: dict) -> dict:
    meta = TARGET_LANGUAGES[TGT_CODE]
    rendered = render_prompt(
        PROMPT_B_XML_STRUCTURED,
        tgt_lang_name=meta["name"],
        tgt_code=TGT_CODE,
        tgt_region=meta["region"],
        speaker_gender=row["speaker_gender"],
        addressee_gender=row["addressee_gender"],
        formality=row["formality"],
        src=row["src"],
    )
    extra = {"reasoning": {"effort": model["reasoning"]}} if model["reasoning"] else None
    started = time.monotonic()
    for attempt in range(4):
        try:
            resp = await client.chat.completions.create(
                model=model["slug"],
                messages=[{"role": "user", "content": rendered}],
                temperature=0,
                max_tokens=MAX_OUTPUT_TOKENS,
                extra_body=extra,
            )
            elapsed_ms = int((time.monotonic() - started) * 1000)
            choice = resp.choices[0]
            mt = (choice.message.content or "").strip()
            if len(mt) >= 2 and mt[0] == mt[-1] and mt[0] in ('"', "'", "“", "”", "‘", "’", "«", "»"):
                mt = mt[1:-1].strip()
            usage = resp.usage
            return {
                "model_id":      model["id"],
                "mt":            mt,
                "input_tokens":  int(getattr(usage, "prompt_tokens", 0) or 0),
                "output_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
                "finish_reason": choice.finish_reason or "",
                "latency_ms":    elapsed_ms,
                "error":         None,
            }
        except Exception as exc:
            if attempt == 3:
                return {
                    "model_id": model["id"], "mt": "", "input_tokens": 0, "output_tokens": 0,
                    "finish_reason": "error", "latency_ms": 0, "error": f"{type(exc).__name__}: {exc}",
                }
            await asyncio.sleep((2 ** attempt) + random.uniform(0, 0.5))
    return {"model_id": model["id"], "mt": "", "input_tokens": 0, "output_tokens": 0,
            "finish_reason": "error", "latency_ms": 0, "error": "unreachable"}


async def run_async(sample: pd.DataFrame, concurrency: int) -> pd.DataFrame:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not set")
    client = AsyncOpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key, timeout=DEFAULT_TIMEOUT_S)
    sem = asyncio.Semaphore(concurrency)
    progress = {"n": 0}
    total = len(sample) * len(MODELS)
    lock = asyncio.Lock()

    async def worker(row, model):
        async with sem:
            r = await translate_one(client, row, model)
            async with lock:
                progress["n"] += 1
                if progress["n"] % 25 == 0 or progress["n"] == total:
                    print(f"[translate] {progress['n']}/{total}")
            # Attach the source-side row info so we can emit one DataFrame row per call
            return {**row.to_dict(), **r}

    coros = [worker(row, model) for _, row in sample.iterrows() for model in MODELS]
    results = await asyncio.gather(*coros)
    return pd.DataFrame(results)


# ── Summaries ────────────────────────────────────────────────────

def summarize(df: pd.DataFrame) -> None:
    print("\n=== Cost per model (OGTE, n={} sentences × 2 models) ===".format(len(df)//2))
    print(f"{'model_id':<35} {'calls':>6} {'avg_in':>8} {'avg_out':>8} {'cost_USD':>10} {'$/M_src_chars':>15} {'$/sent':>10}")
    print("-"*100)

    for model in MODELS:
        g = df[df["model_id"] == model["id"]]
        if len(g) == 0:
            continue
        in_tok = int(g["input_tokens"].sum())
        out_tok = int(g["output_tokens"].sum())
        src = int(g["src_len"].sum())
        p = MODEL_PRICING[model["id"]]
        cost = (in_tok*p["input_per_m"] + out_tok*p["output_per_m"]) / 1_000_000
        per_m = cost/src*1_000_000 if src else float("nan")
        per_s = cost/len(g) if len(g) else float("nan")
        print(f"{model['id']:<35} {len(g):>6} {in_tok/len(g):>8.0f} {out_tok/len(g):>8.0f} "
              f"{cost:>10.4f} {per_m:>15.2f} {per_s:>10.5f}")

    print("\n=== Per-level breakdown ($/M src chars) ===")
    print(f"{'level':<6} {'n':>4} {'avg_src_len':>12}", end="")
    for m in MODELS:
        print(f" {m['id'].split('-')[-1]:>14}", end="")
    print()
    print("-"*72)

    by_level = df.groupby(["level", "model_id"])
    levels = sorted(df["level"].unique(), key=lambda x: int(x) if str(x).isdigit() else x)
    for lvl in levels:
        sub_all = df[df["level"] == lvl]
        n_per_model = len(sub_all[sub_all["model_id"] == MODELS[0]["id"]])
        avg_src_len = sub_all["src_len"].mean()
        print(f"{str(lvl):<6} {n_per_model:>4} {avg_src_len:>12.1f}", end="")
        for model in MODELS:
            try:
                g = by_level.get_group((lvl, model["id"]))
            except KeyError:
                print(f" {'—':>14}", end="")
                continue
            p = MODEL_PRICING[model["id"]]
            in_tok = int(g["input_tokens"].sum())
            out_tok = int(g["output_tokens"].sum())
            src = int(g["src_len"].sum())
            cost = (in_tok*p["input_per_m"] + out_tok*p["output_per_m"]) / 1_000_000
            per_m = cost/src*1_000_000 if src else float("nan")
            print(f" {per_m:>14.2f}", end="")
        print()

    # Hybrid blended cost: min-think for src_len < 30, low-think for src_len >= 30
    print(f"\n=== Hybrid policy (min-think if src_len<{HYBRID_LENGTH_THRESHOLD}, low-think otherwise) ===")
    short_rows = df[(df["src_len"] < HYBRID_LENGTH_THRESHOLD) & (df["model_id"] == HYBRID_SHORT_MODEL)]
    long_rows  = df[(df["src_len"] >= HYBRID_LENGTH_THRESHOLD) & (df["model_id"] == HYBRID_LONG_MODEL)]
    if len(short_rows) and len(long_rows):
        p_short = MODEL_PRICING[HYBRID_SHORT_MODEL]
        p_long  = MODEL_PRICING[HYBRID_LONG_MODEL]
        short_cost = (short_rows["input_tokens"].sum()*p_short["input_per_m"]
                      + short_rows["output_tokens"].sum()*p_short["output_per_m"]) / 1_000_000
        long_cost  = (long_rows["input_tokens"].sum()*p_long["input_per_m"]
                      + long_rows["output_tokens"].sum()*p_long["output_per_m"]) / 1_000_000
        total_cost = short_cost + long_cost
        total_src  = short_rows["src_len"].sum() + long_rows["src_len"].sum()
        blended_per_m = total_cost / total_src * 1_000_000
        print(f"  short (n={len(short_rows)}, src<{HYBRID_LENGTH_THRESHOLD}, min-think): ${short_cost:.4f}, "
              f"src_chars={int(short_rows['src_len'].sum())}, $/M={short_cost/short_rows['src_len'].sum()*1_000_000:.2f}")
        print(f"  long  (n={len(long_rows)}, src>={HYBRID_LENGTH_THRESHOLD}, low-think): ${long_cost:.4f}, "
              f"src_chars={int(long_rows['src_len'].sum())}, $/M={long_cost/long_rows['src_len'].sum()*1_000_000:.2f}")
        print(f"  BLENDED total                              : ${total_cost:.4f} | "
              f"$/M src chars: ${blended_per_m:.2f}")

    # Production projection (per user-first-home-view)
    print("\n=== Production extrapolations ===")
    unique_src_len = df.drop_duplicates("src_hash")["src_len"].mean()
    print(f"avg src chars per sentence (unique): {unique_src_len:.1f}")
    per_user_chars = 5 * 7 * unique_src_len
    for model in MODELS:
        g = df[df["model_id"] == model["id"]]
        if len(g) == 0:
            continue
        p = MODEL_PRICING[model["id"]]
        in_tok = int(g["input_tokens"].sum())
        out_tok = int(g["output_tokens"].sum())
        src = int(g["src_len"].sum())
        cost = (in_tok*p["input_per_m"] + out_tok*p["output_per_m"]) / 1_000_000
        per_m = cost/src*1_000_000 if src else float("nan")
        per_user = per_user_chars / 1_000_000 * per_m
        print(f"  {model['id']:<35} per user-first-home-view (5×7×{unique_src_len:.0f}={per_user_chars:.0f} chars): ${per_user:.4f}")
    if len(short_rows) and len(long_rows):
        per_user_hybrid = per_user_chars / 1_000_000 * blended_per_m
        print(f"  {'HYBRID (min<30, low>=30)':<35} per user-first-home-view (5×7×{unique_src_len:.0f}={per_user_chars:.0f} chars): ${per_user_hybrid:.4f}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--per-level", type=int, default=DEFAULT_PER_LEVEL,
                   help=f"sentences sampled per OGTE level (default {DEFAULT_PER_LEVEL})")
    p.add_argument("--seed", type=int, default=DEFAULT_SEED)
    p.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    p.add_argument("--out", default="data/ogte_cost_de.csv")
    args = p.parse_args(argv)

    sample = load_ogte_sample(args.per_level, args.seed)
    out_df = asyncio.run(run_async(sample, args.concurrency))

    out_path = Path(args.out)
    out_path.parent.mkdir(exist_ok=True)
    out_df.to_csv(out_path, index=False)
    print(f"[run_ogte_cost] wrote {len(out_df)} rows to {out_path}")
    summarize(out_df)
    return 0


if __name__ == "__main__":
    sys.exit(main())
