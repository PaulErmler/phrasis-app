#!/usr/bin/env python3
"""
Async batch translator against OpenRouter.

Public entry point: `translate_grid(...)`. For one (prompt × model) cell,
translates the FLORES sample into every requested target language and writes
results into the resumable CSV cache at `data/translations_cache.csv`.

Cache key: (prompt_id, model_id, src_hash, tgt_code). Re-running skips any
key that already has a non-null translation column.
"""

from __future__ import annotations
import asyncio
import os
import random
import time
from dataclasses import dataclass
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
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT_S,
    MAX_OUTPUT_TOKENS,
    OPENROUTER_BASE_URL,
    TARGET_LANGUAGES,
    TRANSLATIONS_CACHE_PATH,
)
from prompts import render_prompt


# ── Types ────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TranslationKey:
    prompt_id: str
    model_id: str
    src_hash: str
    tgt_code: str


@dataclass
class TranslationRow:
    key: TranslationKey
    mt: str
    latency_ms: int
    input_tokens: int
    output_tokens: int
    finish_reason: str
    error: Optional[str] = None


CACHE_COLUMNS = [
    "prompt_id", "model_id", "src_hash", "tgt_code",
    "mt", "latency_ms", "input_tokens", "output_tokens",
    "finish_reason", "error", "created_at",
]


# ── Cache I/O ────────────────────────────────────────────────────

def load_cache() -> pd.DataFrame:
    if not TRANSLATIONS_CACHE_PATH.exists():
        return pd.DataFrame(columns=CACHE_COLUMNS)
    return pd.read_csv(TRANSLATIONS_CACHE_PATH)


def write_cache(df: pd.DataFrame) -> None:
    df.to_csv(TRANSLATIONS_CACHE_PATH, index=False)


def completed_keys(df: pd.DataFrame) -> set[tuple[str, str, str, str]]:
    """Return the set of cache keys that already have a non-empty `mt`."""
    if df.empty:
        return set()
    ok = df[df["mt"].notna() & (df["mt"] != "")]
    return set(zip(ok["prompt_id"], ok["model_id"], ok["src_hash"], ok["tgt_code"]))


# ── OpenRouter client ────────────────────────────────────────────

def _make_client() -> AsyncOpenAI:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY not set. Export it or add it to "
            "data_preparation/translation_eval/.env or data_preparation/.env."
        )
    return AsyncOpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key, timeout=DEFAULT_TIMEOUT_S)


# ── Single-call worker ───────────────────────────────────────────

async def _one_call(
    client: AsyncOpenAI,
    *,
    prompt_id: str,
    prompt_template: str,
    model_id: str,
    model_slug: str,
    reasoning: Optional[str],
    sample_idx: int,
    src: str,
    src_hash: str,
    tgt_code: str,
    speaker_gender: Optional[str],
    addressee_gender: Optional[str],
    formality: Optional[str],
    max_retries: int,
) -> TranslationRow:
    meta = TARGET_LANGUAGES[tgt_code]
    rendered = render_prompt(
        prompt_template,
        tgt_lang_name=meta["name"],
        tgt_code=tgt_code,
        tgt_region=meta["region"],
        speaker_gender=speaker_gender,
        addressee_gender=addressee_gender,
        formality=formality,
        src=src,
    )

    extra: dict = {}
    if reasoning:
        # OpenRouter normalizes reasoning across providers — Gemini 3 honours
        # `effort`, others silently ignore it.
        extra["reasoning"] = {"effort": reasoning}

    key = TranslationKey(prompt_id, model_id, src_hash, tgt_code)

    started = time.monotonic()
    for attempt in range(max_retries):
        try:
            resp = await client.chat.completions.create(
                model=model_slug,
                messages=[{"role": "user", "content": rendered}],
                temperature=0,
                max_tokens=MAX_OUTPUT_TOKENS,
                extra_body=extra if extra else None,
            )
            elapsed_ms = int((time.monotonic() - started) * 1000)
            choice = resp.choices[0]
            raw = (choice.message.content or "").strip()
            mt = _strip_wrapping_quotes(raw)
            usage = resp.usage
            return TranslationRow(
                key=key,
                mt=mt,
                latency_ms=elapsed_ms,
                input_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
                output_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
                finish_reason=choice.finish_reason or "",
                error=None if mt else "empty_response",
            )
        except Exception as exc:
            if attempt == max_retries - 1:
                elapsed_ms = int((time.monotonic() - started) * 1000)
                return TranslationRow(
                    key=key, mt="", latency_ms=elapsed_ms,
                    input_tokens=0, output_tokens=0, finish_reason="error",
                    error=f"{type(exc).__name__}: {exc}",
                )
            # exponential backoff with jitter; covers 429 and 5xx
            sleep_s = (2 ** attempt) + random.uniform(0, 0.5)
            await asyncio.sleep(sleep_s)

    # Unreachable, but type-checkers don't know that.
    return TranslationRow(
        key=key, mt="", latency_ms=0, input_tokens=0, output_tokens=0,
        finish_reason="error", error="unreachable",
    )


def _strip_wrapping_quotes(s: str) -> str:
    """Some models return the translation wrapped in straight or smart quotes
    despite explicit instructions. Strip one matched pair if present."""
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'", "“", "”", "‘", "’", "«", "»"):
        return s[1:-1].strip()
    return s


# ── Public entry point ──────────────────────────────────────────

async def translate_grid_async(
    sample: pd.DataFrame,
    *,
    prompts: list[dict],
    models: list[dict],
    target_codes: list[str],
    concurrency: int = DEFAULT_CONCURRENCY,
    max_retries: int = DEFAULT_MAX_RETRIES,
    checkpoint_every: int = 50,
) -> pd.DataFrame:
    """Run the full (prompt × model × sentence × target) grid; resume-safe.

    `sample` must have columns: sample_idx, src_hash, src, speaker_gender,
    addressee_gender, formality (the output of flores_loader.build_sample).
    """
    cache = load_cache()
    done = completed_keys(cache)
    client = _make_client()

    sem = asyncio.Semaphore(concurrency)
    new_rows: list[TranslationRow] = []
    lock = asyncio.Lock()

    todo: list[tuple] = []
    for prompt in prompts:
        for model in models:
            for _, row in sample.iterrows():
                for tgt_code in target_codes:
                    k = (prompt["id"], model["id"], row["src_hash"], tgt_code)
                    if k in done:
                        continue
                    todo.append((prompt, model, row, tgt_code))

    total = len(todo)
    if total == 0:
        print("[translate] nothing to do — cache fully covers the grid.")
        return cache

    print(
        f"[translate] {total} calls pending "
        f"(prompts={len(prompts)}, models={len(models)}, "
        f"sentences={len(sample)}, langs={len(target_codes)}, concurrency={concurrency})"
    )

    progress = {"done": 0}

    async def _wrapped(prompt, model, row, tgt_code):
        async with sem:
            result = await _one_call(
                client,
                prompt_id=prompt["id"],
                prompt_template=prompt["template"],
                model_id=model["id"],
                model_slug=model["model"],
                reasoning=model.get("reasoning"),
                sample_idx=int(row["sample_idx"]),
                src=str(row["src"]),
                src_hash=str(row["src_hash"]),
                tgt_code=tgt_code,
                speaker_gender=str(row.get("speaker_gender") or "") or None,
                addressee_gender=str(row.get("addressee_gender") or "") or None,
                formality=str(row.get("formality") or "") or None,
                max_retries=max_retries,
            )
            async with lock:
                new_rows.append(result)
                progress["done"] += 1
                if progress["done"] % checkpoint_every == 0 or progress["done"] == total:
                    _flush(new_rows)
                    print(
                        f"[translate]   {progress['done']}/{total} "
                        f"(latest: {result.key.prompt_id}/{result.key.model_id}/{result.key.tgt_code})"
                    )

    await asyncio.gather(*[_wrapped(*t) for t in todo])
    _flush(new_rows)
    return load_cache()


def _flush(new_rows: list[TranslationRow]) -> None:
    """Merge in-memory results into the on-disk cache atomically (rewrite).

    Re-reads the cache from disk every flush so previously-checkpointed batches
    are preserved — otherwise each flush would overwrite the file with only
    the most recent batch.
    """
    if not new_rows:
        return
    existing = load_cache()
    records = [{
        "prompt_id":      r.key.prompt_id,
        "model_id":       r.key.model_id,
        "src_hash":       r.key.src_hash,
        "tgt_code":       r.key.tgt_code,
        "mt":             r.mt,
        "latency_ms":     r.latency_ms,
        "input_tokens":   r.input_tokens,
        "output_tokens":  r.output_tokens,
        "finish_reason":  r.finish_reason,
        "error":          r.error or "",
        "created_at":     int(time.time()),
    } for r in new_rows]
    additions = pd.DataFrame(records, columns=CACHE_COLUMNS)
    combined = pd.concat([existing, additions], ignore_index=True)
    # Deduplicate: keep the most-recent row per key.
    combined = combined.drop_duplicates(
        subset=["prompt_id", "model_id", "src_hash", "tgt_code"], keep="last"
    )
    write_cache(combined)
    # Clear the new_rows list so subsequent flushes don't double-write.
    new_rows.clear()


def translate_grid(*args, **kwargs) -> pd.DataFrame:
    """Sync wrapper around `translate_grid_async`."""
    return asyncio.run(translate_grid_async(*args, **kwargs))
