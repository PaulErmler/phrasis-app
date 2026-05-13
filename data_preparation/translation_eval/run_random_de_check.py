#!/usr/bin/env python3
"""
Sanity-check the production cost of `gemini-3.1-flash-lite-med-think`
on 100 *uniformly random* FLORES-200 devtest sentences translated into
German with Prompt B. The main `flores_sample.csv` is biased toward the
hard tertile (long, complex sentences); production traffic in Phrasis is
mostly short OGTE-curated learner sentences, so cost estimates from the
hard sample over-state production billing.

Output:
  data/random_sample_de_medthink.csv  — one row per sentence with src,
    ref, mt, comet (n/a here), tokens, latency, per-row cost
  Stdout: aggregate $/M source-character estimate.

Usage:
  python run_random_de_check.py
  python run_random_de_check.py --limit 20      # smoke
  python run_random_de_check.py --seed 12345    # different sample
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
from typing import Optional

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


MODEL_ID    = "gemini-3.1-flash-lite-med-think"
MODEL_SLUG  = "google/gemini-3.1-flash-lite-preview"
REASONING   = "medium"
PROMPT_ID   = "B_xml_structured"
TGT_CODE    = "de"
DEFAULT_SAMPLE_SIZE = 100
DEFAULT_SEED        = 20260512_2


def short_hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]


def load_random_pairs(n: int, seed: int) -> pd.DataFrame:
    """Uniformly random English+German pairs from FLORES-200 devtest.

    Aligned by `id` (the per-language row index). No length/difficulty filter.
    """
    from datasets import load_dataset

    print(f"[random_sample] loading FLORES devtest (eng_Latn + deu_Latn)…")
    ds = load_dataset("openlanguagedata/flores_plus", split="devtest")

    en_by_id: dict[int, str] = {}
    de_by_id: dict[int, str] = {}
    for row in ds:
        if row["iso_639_3"] == "eng" and row["iso_15924"] == "Latn":
            en_by_id[row["id"]] = row["text"]
        elif row["iso_639_3"] == "deu" and row["iso_15924"] == "Latn":
            de_by_id[row["id"]] = row["text"]

    ids = sorted(set(en_by_id) & set(de_by_id))
    print(f"[random_sample]   {len(ids)} aligned sentences")

    rng = random.Random(seed)
    sampled = sorted(rng.sample(ids, n))

    rows = []
    for sample_idx, sid in enumerate(sampled):
        src = en_by_id[sid]
        meta = metadata_for_index(sample_idx)
        rows.append({
            "sample_idx":          sample_idx,
            "flores_devtest_id":   sid,
            "src_hash":            short_hash(src),
            "src":                 src,
            "src_len":             len(src),
            "ref_de":              de_by_id[sid],
            "speaker_gender":      meta["speaker_gender"],
            "addressee_gender":    meta["addressee_gender"],
            "formality":           meta["formality"],
        })
    return pd.DataFrame(rows)


async def translate_one(
    client: AsyncOpenAI, row: pd.Series,
) -> dict:
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
    started = time.monotonic()
    for attempt in range(4):
        try:
            resp = await client.chat.completions.create(
                model=MODEL_SLUG,
                messages=[{"role": "user", "content": rendered}],
                temperature=0,
                max_tokens=MAX_OUTPUT_TOKENS,
                extra_body={"reasoning": {"effort": REASONING}},
            )
            elapsed_ms = int((time.monotonic() - started) * 1000)
            choice = resp.choices[0]
            mt = (choice.message.content or "").strip()
            # strip a wrapping quote pair if present
            if len(mt) >= 2 and mt[0] == mt[-1] and mt[0] in ('"', "'", "“", "”", "‘", "’", "«", "»"):
                mt = mt[1:-1].strip()
            usage = resp.usage
            return {
                "mt":             mt,
                "input_tokens":   int(getattr(usage, "prompt_tokens", 0) or 0),
                "output_tokens":  int(getattr(usage, "completion_tokens", 0) or 0),
                "finish_reason":  choice.finish_reason or "",
                "latency_ms":     elapsed_ms,
                "error":          None,
            }
        except Exception as exc:
            if attempt == 3:
                return {
                    "mt": "", "input_tokens": 0, "output_tokens": 0,
                    "finish_reason": "error", "latency_ms": 0,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            await asyncio.sleep((2 ** attempt) + random.uniform(0, 0.5))
    return {"mt": "", "input_tokens": 0, "output_tokens": 0,
            "finish_reason": "error", "latency_ms": 0, "error": "unreachable"}


async def run_async(sample: pd.DataFrame, concurrency: int) -> pd.DataFrame:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not set")
    client = AsyncOpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key, timeout=DEFAULT_TIMEOUT_S)
    sem = asyncio.Semaphore(concurrency)
    done = {"n": 0}
    lock = asyncio.Lock()

    async def worker(row):
        async with sem:
            r = await translate_one(client, row)
            async with lock:
                done["n"] += 1
                if done["n"] % 20 == 0 or done["n"] == len(sample):
                    print(f"[translate] {done['n']}/{len(sample)}")
            return r

    results = await asyncio.gather(*[worker(row) for _, row in sample.iterrows()])
    res_df = pd.DataFrame(results)
    return pd.concat([sample.reset_index(drop=True), res_df.reset_index(drop=True)], axis=1)


def summarize(df: pd.DataFrame) -> None:
    p = MODEL_PRICING[MODEL_ID]
    in_tok = int(df["input_tokens"].sum())
    out_tok = int(df["output_tokens"].sum())
    src_chars = int(df["src_len"].sum())
    cost = (in_tok * p["input_per_m"] + out_tok * p["output_per_m"]) / 1_000_000
    per_m_src = cost / src_chars * 1_000_000 if src_chars else float("nan")
    avg_src = src_chars / len(df)
    avg_in = in_tok / len(df)
    avg_out = out_tok / len(df)

    print()
    print(f"=== {MODEL_ID} + Prompt B + de (uniformly random sample, n={len(df)}) ===")
    print(f"  src chars total     : {src_chars:>10}")
    print(f"  src chars / sentence: {avg_src:>10.1f}")
    print(f"  input tokens total  : {in_tok:>10}")
    print(f"  output tokens total : {out_tok:>10}")
    print(f"  avg in/out per call : {avg_in:.1f} / {avg_out:.1f}")
    print(f"  total cost          : ${cost:>8.4f}")
    print(f"  $/M source chars    : ${per_m_src:>8.2f}")
    print(f"  cost / sentence     : ${cost/len(df):>8.5f}")

    # Production extrapolation: 5 sentences × 7 collections × 1 target lang
    # × ~avg_src per sentence per user-first-home-view.
    per_user_chars = 5 * 7 * avg_src
    per_user_cost = per_user_chars / 1_000_000 * per_m_src
    print(f"  est per user-first-home-view (5 sent × 7 coll × {avg_src:.0f} chars/sent): ${per_user_cost:.4f}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--limit", type=int, default=DEFAULT_SAMPLE_SIZE)
    p.add_argument("--seed",  type=int, default=DEFAULT_SEED)
    p.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    p.add_argument("--out", default="data/random_sample_de_medthink.csv")
    args = p.parse_args(argv)

    sample = load_random_pairs(args.limit, args.seed)
    print(f"[random_sample] {len(sample)} rows; src_len mean={sample['src_len'].mean():.1f}, "
          f"median={sample['src_len'].median():.0f}, min={sample['src_len'].min()}, max={sample['src_len'].max()}")

    out_df = asyncio.run(run_async(sample, args.concurrency))

    out_path = Path(args.out)
    out_path.parent.mkdir(exist_ok=True)
    out_df.to_csv(out_path, index=False)
    print(f"[random_sample] wrote {len(out_df)} rows to {out_path}")
    summarize(out_df)
    return 0


if __name__ == "__main__":
    sys.exit(main())
