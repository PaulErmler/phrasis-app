#!/usr/bin/env python3
"""
Score every filtered OGTE sentence with a pedagogy-priority score (1-10) using
google/gemini-3.1-flash-lite-preview via OpenRouter.

Two modes:
  --pilot N (default N=100): stratified sample across the 21 OGTE levels;
    output goes to data/intermediate/pedagogy_pilot.csv (overwritten each run);
    the script then prints an extrapolated full-run cost.
  --full: score every sentence not yet present in
    data/intermediate/pedagogy_scores.csv (resumable, append-only).

OpenRouter is hit directly via aiohttp (it speaks the OpenAI API). No openai
SDK needed.
"""

import argparse
import asyncio
import csv
import json
import os
import random
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import aiohttp

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_PREP = REPO_ROOT / "data_preparation"
OGTE_ROOT = DATA_PREP / "ogte-dataset"

INPUT = OGTE_ROOT / "data" / "intermediate" / "ogte_sentences_filtered.csv"
PILOT_DIR = OGTE_ROOT / "data" / "intermediate"
FULL_OUT = OGTE_ROOT / "data" / "intermediate" / "pedagogy_scores.csv"


def pilot_path_for(model: str) -> Path:
    """Per-model pilot file so re-running with a different model doesn't clobber prior output."""
    safe = model.replace("/", "__").replace(":", "_")
    return PILOT_DIR / f"pedagogy_pilot_{safe}.csv"
COST_LOG = OGTE_ROOT / "data" / "output" / "stats" / "pedagogy_cost_log.csv"
ENV_FILE = DATA_PREP / ".env"

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview"

# (input_price_per_million, output_price_per_million) — OpenRouter list prices.
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "google/gemini-3.1-flash-lite-preview": (0.25, 1.50),
    "google/gemini-2.5-flash-lite":         (0.10, 0.40),
}

BATCH_SIZE = 30
CONCURRENCY = 8
MAX_RETRIES = 3
REQUEST_TIMEOUT_S = 120

ANCHORS: list[tuple[float, str]] = [
    (10, "Hi."),
    (10, "Thank you."),
    (9,  "How are you?"),
    (9,  "I'm sorry."),
    (7,  "I work in a hospital."),
    (6,  "It's raining today."),
    (5,  "She brought her camera to the wedding."),
    (3,  "The kettle whistled in the small kitchen by the river."),
    (2,  "He pondered the existential nuance of his refrigerator."),
    (1,  "The cuneiform tablets corroborate the eclipse hypothesis."),
]

SYSTEM_PROMPT = """You score English sentences 1-10 for "how useful is it for a language learner to encounter this early in their learning journey".

10: Universal greetings, courtesy phrases, ultra-common everyday utterances a beginner needs in their first lesson.
7-9: High-frequency conversational sentences; basic factual statements; common needs, wants, opinions.
4-6: Useful but situational; some uncommon vocabulary or context that's pedagogically reasonable but not a priority.
1-3: Niche, literary, technical, or culturally narrow content; sentences whose vocabulary or framing won't help most learners.

IMPORTANT: ignore raw word-frequency. Judge pedagogical priority. "Hi" deserves a 10 even though "hi" is statistically rare in some corpora. Greetings and courtesy phrases always rank high.

Be decisive. Use the full 1-10 range. Prefer integer scores; half-integers allowed only when truly between two integer levels.

You will be given a numbered list of calibration anchors with reference scores, then a numbered list of new sentences. Return a JSON object with a single key "results", whose value is an array of {"id": <sentence_id>, "score": <1-10>} objects, one per new sentence, in the same order."""

JSON_SCHEMA = {
    "name": "pedagogy_batch",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "id": {"type": "string"},
                        "score": {"type": "number", "minimum": 1, "maximum": 10},
                    },
                    "required": ["id", "score"],
                },
            }
        },
        "required": ["results"],
    },
}


def load_env_var(name: str) -> str:
    val = os.environ.get(name)
    if val:
        return val
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == name:
                return v.strip().strip("'\"")
    raise RuntimeError(f"{name} not found in environment or {ENV_FILE}")


@dataclass
class Sentence:
    id: str
    ogte_level: str
    text: str


def load_filtered() -> list[Sentence]:
    if not INPUT.exists():
        raise FileNotFoundError(f"{INPUT} not found. Run 4_filter_sentences.py first.")
    out = []
    with INPUT.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            out.append(Sentence(row["id"], row["ogte_level"], row["text"]))
    return out


def load_from_folder(folder: Path) -> list[Sentence]:
    """Load sentences from per-level CSVs in `folder` (filename pattern ogte_NN_*.csv).
    Used to score a curated subset (e.g. data/output/levels/) instead of the full pool."""
    if not folder.exists():
        raise FileNotFoundError(f"{folder} not found.")
    out: list[Sentence] = []
    for p in sorted(folder.glob("ogte_*.csv")):
        # Filename pattern: ogte_NN_label.csv -> level = "NN"
        level = p.stem.split("_", 2)[1]
        with p.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                out.append(Sentence(row["id"], level, row["text"]))
    return out


def stratified_sample(sentences: list[Sentence], n: int, seed: int = 42) -> list[Sentence]:
    """Sample ~n sentences spread across OGTE levels. Distributes the
    n // levels remainder one-per-level to hit exactly n when possible."""
    rng = random.Random(seed)
    by_level: dict[str, list[Sentence]] = defaultdict(list)
    for s in sentences:
        by_level[s.ogte_level].append(s)
    levels = sorted(by_level)
    base, remainder = divmod(n, len(levels))
    picked: list[Sentence] = []
    for i, lvl in enumerate(levels):
        target = base + (1 if i < remainder else 0)
        bucket = by_level[lvl]
        k = min(target, len(bucket))
        picked.extend(rng.sample(bucket, k))
    rng.shuffle(picked)
    return picked[:n]


def load_processed_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    seen = set()
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            seen.add(row["id"])
    return seen


def build_user_prompt(batch: list[Sentence]) -> str:
    parts = ["CALIBRATION ANCHORS (reference, do not score):"]
    for i, (score, text) in enumerate(ANCHORS, 1):
        parts.append(f"{i}. [score={score}] {text}")
    parts.append("")
    parts.append("SCORE THESE SENTENCES (return one entry per id, in any order):")
    for s in batch:
        # Strip newlines/tabs that might confuse the model.
        clean = s.text.replace("\n", " ").replace("\r", " ").strip()
        parts.append(f"id={s.id}: {clean}")
    return "\n".join(parts)


@dataclass
class BatchResult:
    scores: dict[str, float]
    prompt_tokens: int
    completion_tokens: int


async def score_batch(
    session: aiohttp.ClientSession,
    api_key: str,
    batch: list[Sentence],
    model: str,
) -> BatchResult:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(batch)},
        ],
        "response_format": {"type": "json_schema", "json_schema": JSON_SCHEMA},
        "reasoning": {"effort": "minimal"},
        "temperature": 0,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/phrasis/ogte-dataset",
        "X-Title": "phrasis-ogte-pedagogy",
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with session.post(
                OPENROUTER_URL, json=payload, headers=headers,
                timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S),
            ) as resp:
                if resp.status >= 500 or resp.status == 429:
                    body = await resp.text()
                    last_err = f"HTTP {resp.status}: {body[:200]}"
                    await asyncio.sleep(2 ** attempt)
                    continue
                resp.raise_for_status()
                data = await resp.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            scores = {item["id"]: float(item["score"]) for item in parsed["results"]}
            usage = data.get("usage", {}) or {}
            return BatchResult(
                scores=scores,
                prompt_tokens=int(usage.get("prompt_tokens", 0)),
                completion_tokens=int(usage.get("completion_tokens", 0)),
            )
        except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError, KeyError) as e:
            last_err = f"{type(e).__name__}: {e}"
            await asyncio.sleep(2 ** attempt)
    raise RuntimeError(f"score_batch failed after {MAX_RETRIES} retries: {last_err}")


def chunk(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def append_cost_log(row: dict, in_price: float, out_price: float) -> None:
    COST_LOG.parent.mkdir(parents=True, exist_ok=True)
    new = not COST_LOG.exists()
    with COST_LOG.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow([
                "timestamp", "mode", "model", "sentences_scored", "batches",
                "prompt_tokens", "completion_tokens", "cost_usd",
                "duration_seconds", "cost_per_1k_sentences",
                "input_price_per_million", "output_price_per_million",
            ])
        w.writerow([
            row["timestamp"], row["mode"], row["model"], row["sentences_scored"],
            row["batches"], row["prompt_tokens"], row["completion_tokens"],
            f"{row['cost_usd']:.6f}", f"{row['duration_seconds']:.1f}",
            f"{row['cost_per_1k_sentences']:.4f}",
            in_price, out_price,
        ])


async def run(mode: str, sentences: list[Sentence], out_path: Path, model: str) -> None:
    api_key = load_env_var("OPENROUTER_API_KEY")
    in_price, out_price = MODEL_PRICING.get(model, (0.0, 0.0))
    if (in_price, out_price) == (0.0, 0.0):
        print(f"  ! warning: no pricing for {model}; cost will be reported as $0")
    sem = asyncio.Semaphore(CONCURRENCY)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    file_existed = out_path.exists()
    f_out = out_path.open("a" if (mode == "full" and file_existed) else "w",
                          encoding="utf-8", newline="")
    writer = csv.writer(f_out)
    if not (mode == "full" and file_existed):
        writer.writerow(["id", "score", "ogte_level"])
        f_out.flush()

    batches = list(chunk(sentences, BATCH_SIZE))
    print(f"  scoring {len(sentences):,} sentences in {len(batches)} batches "
          f"(batch_size={BATCH_SIZE}, concurrency={CONCURRENCY})")

    total_prompt = 0
    total_completion = 0
    completed_batches = 0
    completed_sentences = 0
    failed_sentence_ids: list[str] = []
    start = time.time()

    async def worker(batch: list[Sentence]):
        nonlocal total_prompt, total_completion, completed_batches, completed_sentences
        async with sem:
            try:
                result = await score_batch(session, api_key, batch, model)
            except Exception as e:
                print(f"    !! batch failed ({len(batch)} sentences): {e}")
                failed_sentence_ids.extend(s.id for s in batch)
                return
            id_to_level = {s.id: s.ogte_level for s in batch}
            for sid, score in result.scores.items():
                writer.writerow([sid, f"{score:.2f}", id_to_level.get(sid, "")])
            f_out.flush()
            total_prompt += result.prompt_tokens
            total_completion += result.completion_tokens
            completed_batches += 1
            completed_sentences += len(result.scores)
            elapsed = time.time() - start
            rate = completed_sentences / elapsed if elapsed > 0 else 0
            eta = (len(sentences) - completed_sentences) / rate if rate > 0 else 0
            print(f"    [{completed_batches}/{len(batches)}] +{len(result.scores)} scored, "
                  f"{completed_sentences:,}/{len(sentences):,} done, "
                  f"rate={rate:.1f}/s, eta={eta:.0f}s")

    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*(worker(b) for b in batches))

    f_out.close()
    duration = time.time() - start

    cost = (total_prompt / 1_000_000) * in_price + \
           (total_completion / 1_000_000) * out_price
    cost_per_1k = (cost / completed_sentences * 1000) if completed_sentences else 0

    print()
    print(f"  scored: {completed_sentences:,}")
    print(f"  failed: {len(failed_sentence_ids):,}")
    print(f"  prompt tokens:     {total_prompt:,}")
    print(f"  completion tokens: {total_completion:,}")
    print(f"  cost (USD):        ${cost:.4f}")
    print(f"  cost / 1k sents:   ${cost_per_1k:.4f}")
    print(f"  duration:          {duration:.1f}s")
    if mode == "pilot" and completed_sentences:
        full_n = 160_716
        extrapolated = (cost / completed_sentences) * full_n
        print()
        print(f"  --- EXTRAPOLATION FOR FULL RUN ({full_n:,} sentences) ---")
        print(f"    estimated cost:     ${extrapolated:.2f}")
        print(f"    estimated duration: {(duration / completed_sentences) * full_n / 60:.1f} min "
              f"(at current concurrency={CONCURRENCY})")

    append_cost_log({
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "mode": mode,
        "model": model,
        "sentences_scored": completed_sentences,
        "batches": completed_batches,
        "prompt_tokens": total_prompt,
        "completion_tokens": total_completion,
        "cost_usd": cost,
        "duration_seconds": duration,
        "cost_per_1k_sentences": cost_per_1k,
    }, in_price, out_price)

    if failed_sentence_ids:
        retry_path = out_path.with_suffix(".failed_ids.txt")
        retry_path.write_text("\n".join(failed_sentence_ids), encoding="utf-8")
        print(f"  failed ids written to {retry_path}")


def main() -> int:
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group()
    g.add_argument("--pilot", type=int, nargs="?", const=100, default=None,
                   help="run pilot on N stratified sentences (default 100)")
    g.add_argument("--full", action="store_true", help="score every filtered sentence")
    p.add_argument("--model", default=DEFAULT_MODEL,
                   help=f"OpenRouter model id (default: {DEFAULT_MODEL}). "
                        f"Known prices: {sorted(MODEL_PRICING)}")
    p.add_argument("--levels", default=None,
                   help="Comma-separated OGTE levels to score (e.g. '01,02'). "
                        "Applies to --full mode; ignored in --pilot mode.")
    p.add_argument("--from-folder", default=None,
                   help="Read sentences from CSVs in this folder (relative to data/output/, e.g. 'levels') "
                        "instead of ogte_sentences_filtered.csv. Use to score a curated subset.")
    args = p.parse_args()

    if args.pilot is None and not args.full:
        args.pilot = 100  # default to pilot

    if args.from_folder:
        folder = OGTE_ROOT / "data" / "output" / args.from_folder
        sentences = load_from_folder(folder)
        print(f"  loaded {len(sentences):,} sentences from {folder.relative_to(OGTE_ROOT)}/")
    else:
        sentences = load_filtered()
        print(f"  loaded {len(sentences):,} filtered sentences")
    print(f"  model: {args.model}")

    if args.pilot is not None:
        picked = stratified_sample(sentences, args.pilot)
        pilot_out = pilot_path_for(args.model)
        print(f"  pilot: {len(picked)} stratified sentences ({args.pilot} requested)")
        asyncio.run(run("pilot", picked, pilot_out, args.model))
        print(f"  pilot output: {pilot_out}")
    else:
        already = load_processed_ids(FULL_OUT)
        pool = sentences
        if args.levels:
            wanted = {lv.strip() for lv in args.levels.split(",") if lv.strip()}
            pool = [s for s in sentences if s.ogte_level in wanted]
            print(f"  filtering to levels {sorted(wanted)}: {len(pool):,} sentences in scope")
        remaining = [s for s in pool if s.id not in already]
        print(f"  full: {len(already):,} already scored (all-time), {len(remaining):,} remaining in scope")
        if not remaining:
            print("  nothing to do.")
            return 0
        asyncio.run(run("full", remaining, FULL_OUT, args.model))
        print(f"  full output: {FULL_OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
