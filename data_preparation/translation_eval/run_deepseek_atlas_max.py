#!/usr/bin/env python3
"""
One-off test: 100 OGTE sentences × DeepSeek V4 Flash with HIGH thinking
(reasoning effort='high'), routed via OpenRouter's atlas-cloud/fp8 provider,
output capped at 10k tokens (instead of the standard 5k).

Same 100 sentences as `run_ogte_cost_check.py` (deterministic seed) so results
are directly comparable to the existing low/med Gemini and low/max DeepSeek
runs already in `data/ogte_cost_de.csv`.

Output:
  data/ogte_deepseek_atlas_high.csv  — one row per sentence with src, level,
    src_len, mt, input_tokens, output_tokens, latency_ms, finish_reason
  stdout — cost summary + total spend
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
    MODEL_PRICING,
    OPENROUTER_BASE_URL,
    TARGET_LANGUAGES,
    metadata_for_index,
)
from prompts import PROMPT_B_XML_STRUCTURED, render_prompt


MODEL_ID    = "deepseek-v4-flash-high-think"
MODEL_SLUG  = "deepseek/deepseek-v4-flash"
REASONING   = "high"                        # DeepSeek's high (not xhigh/max) thinking
PROMPT_ID   = "B_xml_structured"
TGT_CODE    = "de"
PROVIDER_PREF = "atlas-cloud/fp8"           # OpenRouter routing preference
MAX_OUTPUT_TOKENS_OVERRIDE = 10_000          # NB: higher than the standard 5k cap

OGTE_DIR = Path(__file__).parent.parent / "ogte-dataset" / "data" / "output" / "levels_curated"
DEFAULT_PER_LEVEL = 5
DEFAULT_SEED      = 20260512


def short_hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]


def load_ogte_sample(per_level: int, seed: int) -> pd.DataFrame:
    """Same sampling logic as run_ogte_cost_check.py — same seed → same 100 sentences."""
    files = sorted(OGTE_DIR.glob("ogte_*.csv"))
    rng = random.Random(seed)
    rows = []
    sample_idx = 0
    for f in files:
        df = pd.read_csv(f)
        df = df[df["text"].notna() & (df["text"].str.len() > 0)]
        if len(df) == 0:
            continue
        n = min(per_level, len(df))
        picks = df.sample(n=n, random_state=rng.randint(0, 10**9))
        for _, r in picks.iterrows():
            src = str(r["text"]).strip()
            addresses_someone = str(r.get("register","")).strip() == "direct-address"
            formality_raw = str(r.get("formality","")).strip().lower()
            formality = formality_raw if formality_raw in ("formal","informal","neutral") else None
            meta = metadata_for_index(sample_idx)
            rows.append({
                "sample_idx":        sample_idx,
                "ogte_id":           str(r.get("id","")),
                "level":             str(r.get("ogte_level","")),
                "src_hash":          short_hash(src),
                "src":               src,
                "src_len":           len(src),
                "addresses_someone": addresses_someone,
                "speaker_gender":    meta["speaker_gender"],
                "addressee_gender":  meta["addressee_gender"] if addresses_someone else None,
                "formality":         (formality or meta["formality"]) if addresses_someone else None,
            })
            sample_idx += 1
    return pd.DataFrame(rows)


async def translate_one(client: AsyncOpenAI, row: pd.Series) -> dict:
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
    extra = {
        "reasoning": {"effort": REASONING},
        # OpenRouter provider-routing preference. `order` lists providers the
        # router should try first; `allow_fallbacks` lets it fall through to
        # other providers if atlas-cloud/fp8 isn't reachable. See:
        # https://openrouter.ai/docs/provider-routing
        "provider": {
            "order": [PROVIDER_PREF],
            "allow_fallbacks": True,
        },
    }
    started = time.monotonic()
    for attempt in range(4):
        try:
            resp = await client.chat.completions.create(
                model=MODEL_SLUG,
                messages=[{"role": "user", "content": rendered}],
                temperature=0,
                max_tokens=MAX_OUTPUT_TOKENS_OVERRIDE,
                extra_body=extra,
            )
            elapsed_ms = int((time.monotonic() - started) * 1000)
            choice = resp.choices[0]
            mt = (choice.message.content or "").strip()
            if len(mt) >= 2 and mt[0] == mt[-1] and mt[0] in ('"', "'", "“", "”", "‘", "’", "«", "»"):
                mt = mt[1:-1].strip()
            usage = resp.usage
            # OpenRouter sometimes includes the resolved provider in the JSON;
            # capture it if available so we can verify atlas-cloud/fp8 served us.
            actual_provider = getattr(resp, "provider", None) or ""
            return {
                "mt":              mt,
                "input_tokens":    int(getattr(usage, "prompt_tokens", 0) or 0),
                "output_tokens":   int(getattr(usage, "completion_tokens", 0) or 0),
                "finish_reason":   choice.finish_reason or "",
                "latency_ms":      elapsed_ms,
                "actual_provider": actual_provider,
                "error":           None,
            }
        except Exception as exc:
            if attempt == 3:
                return {
                    "mt": "", "input_tokens": 0, "output_tokens": 0,
                    "finish_reason": "error", "latency_ms": 0,
                    "actual_provider": "", "error": f"{type(exc).__name__}: {exc}",
                }
            await asyncio.sleep((2 ** attempt) + random.uniform(0, 0.5))
    return {"mt": "", "input_tokens": 0, "output_tokens": 0,
            "finish_reason": "error", "latency_ms": 0,
            "actual_provider": "", "error": "unreachable"}


async def run_async(sample: pd.DataFrame, concurrency: int) -> pd.DataFrame:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not set")
    client = AsyncOpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key, timeout=DEFAULT_TIMEOUT_S)
    sem = asyncio.Semaphore(concurrency)
    progress = {"n": 0}
    lock = asyncio.Lock()

    async def worker(row):
        async with sem:
            r = await translate_one(client, row)
            async with lock:
                progress["n"] += 1
                if progress["n"] % 10 == 0 or progress["n"] == len(sample):
                    print(f"[translate] {progress['n']}/{len(sample)}")
            return {**row.to_dict(), **r}

    coros = [worker(row) for _, row in sample.iterrows()]
    results = await asyncio.gather(*coros)
    return pd.DataFrame(results)


def summarize(df: pd.DataFrame) -> None:
    p = MODEL_PRICING[MODEL_ID]
    valid = df[df["error"].isna() | (df["error"] == "") | (df["error"].astype(str) == "None")]
    in_tok = int(valid["input_tokens"].sum())
    out_tok = int(valid["output_tokens"].sum())
    src = int(valid["src_len"].sum())
    cost = (in_tok * p["input_per_m"] + out_tok * p["output_per_m"]) / 1_000_000
    per_m = cost / src * 1_000_000 if src else float("nan")
    per_sent = cost / len(valid) if len(valid) else float("nan")
    avg_in = in_tok / len(valid) if len(valid) else 0
    avg_out = out_tok / len(valid) if len(valid) else 0
    avg_latency = valid["latency_ms"].mean() if len(valid) else 0

    print("\n" + "=" * 80)
    print(f"Model: {MODEL_ID} (reasoning={REASONING}), provider preference: {PROVIDER_PREF}")
    print(f"max_tokens override: {MAX_OUTPUT_TOKENS_OVERRIDE} (vs standard 5k cap)")
    print("=" * 80)
    print(f"  calls (successful)            : {len(valid)} / {len(df)}")
    print(f"  src chars total               : {src}")
    print(f"  input tokens (total / avg)    : {in_tok} / {avg_in:.1f}")
    print(f"  output tokens (total / avg)   : {out_tok} / {avg_out:.1f}")
    print(f"  avg latency / call            : {avg_latency:.0f} ms")
    print(f"  total cost                    : ${cost:.4f}")
    print(f"  $ / M source chars            : ${per_m:.2f}")
    print(f"  cost / sentence               : ${per_sent:.5f}")

    # Truncation rate — important when max_tokens is in play.
    truncated = (valid["finish_reason"] == "length").sum()
    print(f"  truncated (finish=length)     : {truncated} / {len(valid)}")

    # Provider routing: did atlas-cloud/fp8 actually serve us?
    provider_counts = valid["actual_provider"].fillna("").value_counts()
    print(f"  provider routing:")
    for prov, cnt in provider_counts.items():
        label = prov if prov else "(not reported by API)"
        print(f"    {label}: {cnt}")

    # Per-level breakdown
    print("\n=== Per-level cost ===")
    print(f"{'level':<6} {'n':>4} {'avg_src_len':>12} {'avg_out_tok':>12} {'$/M src':>10}")
    print("-" * 50)
    for lvl in sorted(valid["level"].unique(), key=lambda x: int(x) if str(x).isdigit() else 99):
        g = valid[valid["level"] == lvl]
        gs = int(g["src_len"].sum())
        gout = int(g["output_tokens"].sum())
        gin = int(g["input_tokens"].sum())
        gcost = (gin * p["input_per_m"] + gout * p["output_per_m"]) / 1_000_000
        gper_m = gcost / gs * 1_000_000 if gs else float("nan")
        print(f"{str(lvl):<6} {len(g):>4} {g['src_len'].mean():>12.1f} {g['output_tokens'].mean():>12.0f} {gper_m:>10.2f}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--per-level", type=int, default=DEFAULT_PER_LEVEL)
    p.add_argument("--seed", type=int, default=DEFAULT_SEED)
    p.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    p.add_argument("--out", default="data/ogte_deepseek_atlas_high.csv")
    args = p.parse_args(argv)

    sample = load_ogte_sample(args.per_level, args.seed)
    print(f"[deepseek_atlas_max] {len(sample)} sentences "
          f"(src_len mean={sample['src_len'].mean():.1f}, "
          f"min={sample['src_len'].min()}, max={sample['src_len'].max()})")
    print(f"[deepseek_atlas_max] model={MODEL_SLUG} reasoning={REASONING} "
          f"max_tokens={MAX_OUTPUT_TOKENS_OVERRIDE} provider_pref={PROVIDER_PREF}")

    out_df = asyncio.run(run_async(sample, args.concurrency))

    out_path = Path(args.out)
    out_path.parent.mkdir(exist_ok=True)
    out_df.to_csv(out_path, index=False)
    print(f"[deepseek_atlas_max] wrote {len(out_df)} rows to {out_path}")
    summarize(out_df)
    return 0


if __name__ == "__main__":
    sys.exit(main())
