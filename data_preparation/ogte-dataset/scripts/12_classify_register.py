#!/usr/bin/env python3
"""
Joint classification of two attributes per sentence:

1. REGISTER (direct-address | descriptive): would translating into a
   T/V-pronoun or honorific language (French/German/Spanish/Italian/
   Chinese/Korean/Japanese/Arabic/...) force a register choice
   (tu/vous, du/Sie, honorific levels) or is the translation form
   stable?

2. FORMALITY (formal | informal | neutral | n/a): for direct-address
   sentences, what formality would the translator default to? n/a for
   descriptive sentences (formality doesn't apply).

Run AFTER curation (e.g. after levels_final/ is assembled). With
`--from-folder levels_final` the script will:
  1. Read every sentence in that folder.
  2. Classify any IDs not yet in data/intermediate/register_classifications.csv
     (resumable — re-runs after curation changes only score new IDs).
  3. (Default) Patch the target folder's CSVs in place to add/refresh both
     `register` and `formality` columns. Disable with `--no-apply`.

Structure mirrors 8_pedagogy_score.py. Outputs:
  - pilot mode: `data/intermediate/register_pilot_<model>.csv`
  - full mode:  `data/intermediate/register_classifications.csv` (append-only)
  - applied:    `data/output/<folder>/ogte_*.csv` get register + formality columns
  - always:     `data/output/stats/register_cost_log.csv`
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

FILTERED_INPUT = OGTE_ROOT / "data" / "intermediate" / "ogte_sentences_filtered.csv"
PILOT_DIR = OGTE_ROOT / "data" / "intermediate"
FULL_OUT = OGTE_ROOT / "data" / "intermediate" / "register_classifications.csv"
COST_LOG = OGTE_ROOT / "data" / "output" / "stats" / "register_cost_log.csv"
ENV_FILE = DATA_PREP / ".env"

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview"

# Prices match step 8's table.
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "google/gemini-3.1-flash-lite-preview": (0.25, 1.50),
    "google/gemini-2.5-flash-lite":         (0.10, 0.40),
}

BATCH_SIZE = 30
CONCURRENCY = 8
MAX_RETRIES = 3
REQUEST_TIMEOUT_S = 120

ANCHORS: list[tuple[str, str, str]] = [
    # (register, formality, text)
    ("direct-address", "informal", "Hi."),
    ("direct-address", "informal", "What's up?"),
    ("direct-address", "informal", "Don't worry."),
    ("direct-address", "informal", "Listen."),
    ("direct-address", "neutral",  "Thank you."),
    ("direct-address", "neutral",  "Where do you live?"),
    ("direct-address", "formal",   "Thank you for your prompt reply."),
    ("direct-address", "formal",   "Would you kindly review the attached document?"),
    ("descriptive",    "n/a",      "The sun rises in the east."),
    ("descriptive",    "n/a",      "I like coffee."),
]

SYSTEM_PROMPT = """You classify English sentences by TWO attributes, for use in a language-learning dataset that translates into T/V-pronoun or honorific languages (French, German, Spanish, Italian, Chinese, Korean, Japanese, Arabic, ...).

1. REGISTER — does the sentence directly engage the listener?
   - direct-address: 2nd-person pronouns (you/your/yours/yourself), imperatives or commands, direct questions to the listener, or social formulas with register variants (greetings, thanks, apologies, requests). Translator MUST pick a register (tu/vous, du/Sie, honorific level, ...).
       "How are you?", "Where do you live?"     (2nd person)
       "Listen.", "Be careful.", "Don't worry." (imperative)
       "Hi.", "Hello!", "Thank you."            (social formula)
   - descriptive: pure description, narration, factual statement, or first-person observation with NO listener engagement. Translation form is stable across social registers.
       "The sun rises in the east.", "Cats love fish."  (description)
       "Lincoln was president.", "It rained yesterday." (factual)
       "I am tired.", "I like coffee."                   (1st person, no listener)

2. FORMALITY — ONLY applies when register=direct-address.
   - formal: would translate with the polite/respectful form (vous, Sie, usted, 您, keigo). Business letters, court, formal requests, ceremonial speech.
   - informal: would translate with the casual/familiar form (tu, du, tú, 你, plain speech). Friends, family, casual conversation, slang.
   - neutral: either register works — polite-but-friendly phrasing where the translator decides based on context.
   - n/a: ONLY when register=descriptive. Formality does not apply.

EXAMPLES
  "Hi."                                  → direct-address / informal
  "What's up?"                           → direct-address / informal
  "Listen."                              → direct-address / informal
  "Where do you live?"                   → direct-address / neutral
  "Thank you."                           → direct-address / neutral
  "Thank you for your prompt reply."     → direct-address / formal
  "Would you kindly review this?"        → direct-address / formal
  "I like coffee."                       → descriptive    / n/a
  "The sun rises in the east."           → descriptive    / n/a
  "Lincoln was president."               → descriptive    / n/a

IMPORTANT: classify register on LINGUISTIC FORM, not English-side formality cues. "Thank you for your prompt reply." is direct-address even though it's formal. "I like coffee." is descriptive even though it's casual.

You will be given calibration anchors with reference labels, then new sentences. Return JSON of the form {"results": [{"id": "<sentence_id>", "register": "direct-address" | "descriptive", "formality": "formal" | "informal" | "neutral" | "n/a"}, ...]} — one entry per new sentence, with the same `id` strings you received.

When register is "descriptive", formality MUST be "n/a". When register is "direct-address", formality MUST be one of formal / informal / neutral (never n/a)."""

JSON_SCHEMA = {
    "name": "register_batch",
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
                        "register": {"type": "string", "enum": ["direct-address", "descriptive"]},
                        "formality": {"type": "string", "enum": ["formal", "informal", "neutral", "n/a"]},
                    },
                    "required": ["id", "register", "formality"],
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
            if not line or line.startswith("#") or "=" not in line:
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
    if not FILTERED_INPUT.exists():
        raise FileNotFoundError(f"{FILTERED_INPUT} not found.")
    out = []
    with FILTERED_INPUT.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            out.append(Sentence(row["id"], row["ogte_level"], row["text"]))
    return out


def load_from_folder(folder: Path) -> list[Sentence]:
    if not folder.exists():
        raise FileNotFoundError(f"{folder} not found.")
    out: list[Sentence] = []
    for p in sorted(folder.glob("ogte_*.csv")):
        level = p.stem.split("_", 2)[1]
        with p.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                out.append(Sentence(row["id"], row.get("ogte_level", level), row["text"]))
    return out


def stratified_sample(sentences: list[Sentence], n: int, seed: int = 42) -> list[Sentence]:
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
    parts = ["CALIBRATION ANCHORS (reference, do not classify):"]
    for i, (reg, form, text) in enumerate(ANCHORS, 1):
        parts.append(f"{i}. [register={reg}, formality={form}] {text}")
    parts.append("")
    parts.append("CLASSIFY THESE SENTENCES (return one entry per id, in any order):")
    for s in batch:
        clean = s.text.replace("\n", " ").replace("\r", " ").strip()
        parts.append(f"id={s.id}: {clean}")
    return "\n".join(parts)


@dataclass
class BatchResult:
    # id -> (register, formality)
    labels: dict[str, tuple[str, str]]
    prompt_tokens: int
    completion_tokens: int


async def classify_batch(session: aiohttp.ClientSession, api_key: str,
                         batch: list[Sentence], model: str) -> BatchResult:
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
        "X-Title": "phrasis-ogte-register",
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with session.post(OPENROUTER_URL, json=payload, headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S)) as resp:
                if resp.status >= 500 or resp.status == 429:
                    body = await resp.text()
                    last_err = f"HTTP {resp.status}: {body[:200]}"
                    await asyncio.sleep(2 ** attempt)
                    continue
                resp.raise_for_status()
                data = await resp.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            labels = {item["id"]: (item["register"], item["formality"]) for item in parsed["results"]}
            usage = data.get("usage", {}) or {}
            return BatchResult(
                labels=labels,
                prompt_tokens=int(usage.get("prompt_tokens", 0)),
                completion_tokens=int(usage.get("completion_tokens", 0)),
            )
        except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError, KeyError) as e:
            last_err = f"{type(e).__name__}: {e}"
            await asyncio.sleep(2 ** attempt)
    raise RuntimeError(f"classify_batch failed after {MAX_RETRIES} retries: {last_err}")


def chunk(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def pilot_path_for(model: str) -> Path:
    safe = model.replace("/", "__").replace(":", "_")
    return PILOT_DIR / f"register_pilot_{safe}.csv"


def append_cost_log(row: dict, in_price: float, out_price: float) -> None:
    COST_LOG.parent.mkdir(parents=True, exist_ok=True)
    new = not COST_LOG.exists()
    with COST_LOG.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["timestamp", "mode", "model", "sentences_classified", "batches",
                        "prompt_tokens", "completion_tokens", "cost_usd",
                        "duration_seconds", "cost_per_1k_sentences",
                        "input_price_per_million", "output_price_per_million"])
        w.writerow([
            row["timestamp"], row["mode"], row["model"], row["sentences_classified"],
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
    # Detect old schema (id, register, ogte_level) on full output; if it lacks
    # a `formality` column, force a clean rewrite so we don't mix schemas.
    schema_outdated = False
    if mode == "full" and file_existed:
        with out_path.open(encoding="utf-8") as f:
            try:
                header = next(csv.reader(f))
            except StopIteration:
                header = []
        if "formality" not in header:
            schema_outdated = True
            print(f"  ! existing {out_path.name} uses old schema (no formality column); "
                  f"rewriting from scratch.")
    open_mode = "a" if (mode == "full" and file_existed and not schema_outdated) else "w"
    f_out = out_path.open(open_mode, encoding="utf-8", newline="")
    writer = csv.writer(f_out)
    if open_mode == "w":
        writer.writerow(["id", "register", "formality", "ogte_level"])
        f_out.flush()

    batches = list(chunk(sentences, BATCH_SIZE))
    print(f"  classifying {len(sentences):,} sentences in {len(batches)} batches "
          f"(batch_size={BATCH_SIZE}, concurrency={CONCURRENCY})")

    total_prompt = 0
    total_completion = 0
    completed_batches = 0
    completed_sentences = 0
    failed_ids: list[str] = []
    register_counts: dict[str, int] = defaultdict(int)
    formality_counts: dict[str, int] = defaultdict(int)
    start = time.time()

    async def worker(batch):
        nonlocal total_prompt, total_completion, completed_batches, completed_sentences
        async with sem:
            try:
                result = await classify_batch(session, api_key, batch, model)
            except Exception as e:
                print(f"    !! batch failed ({len(batch)} sentences): {e}")
                failed_ids.extend(s.id for s in batch)
                return
            id_to_level = {s.id: s.ogte_level for s in batch}
            for sid, (reg, form) in result.labels.items():
                writer.writerow([sid, reg, form, id_to_level.get(sid, "")])
                register_counts[reg] += 1
                formality_counts[form] += 1
            f_out.flush()
            total_prompt += result.prompt_tokens
            total_completion += result.completion_tokens
            completed_batches += 1
            completed_sentences += len(result.labels)
            elapsed = time.time() - start
            rate = completed_sentences / elapsed if elapsed > 0 else 0
            eta = (len(sentences) - completed_sentences) / rate if rate > 0 else 0
            print(f"    [{completed_batches}/{len(batches)}] +{len(result.labels)}, "
                  f"{completed_sentences:,}/{len(sentences):,}, rate={rate:.1f}/s, eta={eta:.0f}s")

    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*(worker(b) for b in batches))

    f_out.close()
    duration = time.time() - start

    cost = (total_prompt / 1_000_000) * in_price + (total_completion / 1_000_000) * out_price
    cost_per_1k = (cost / completed_sentences * 1000) if completed_sentences else 0

    print()
    print(f"  classified: {completed_sentences:,}")
    print(f"  failed:     {len(failed_ids):,}")
    print(f"  prompt tokens:     {total_prompt:,}")
    print(f"  completion tokens: {total_completion:,}")
    print(f"  cost (USD):        ${cost:.4f}")
    print(f"  cost / 1k sents:   ${cost_per_1k:.4f}")
    print(f"  duration:          {duration:.1f}s")
    print()
    total_reg = sum(register_counts.values()) or 1
    print(f"  register distribution:")
    for label in ("direct-address", "descriptive"):
        cnt = register_counts.get(label, 0)
        print(f"    {label:>16}: {cnt:>5,}  ({100*cnt/total_reg:.1f}%)")
    total_form = sum(formality_counts.values()) or 1
    print(f"  formality distribution:")
    for label in ("informal", "neutral", "formal", "n/a"):
        cnt = formality_counts.get(label, 0)
        print(f"    {label:>16}: {cnt:>5,}  ({100*cnt/total_form:.1f}%)")
    if mode == "pilot" and completed_sentences:
        # Extrapolate to a ~22k final dataset by default; can tune.
        target_n = 21_776
        extrapolated = (cost / completed_sentences) * target_n
        print()
        print(f"  --- EXTRAPOLATION FOR FULL DATASET ({target_n:,} sentences) ---")
        print(f"    estimated cost: ${extrapolated:.2f}")

    append_cost_log({
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "mode": mode,
        "model": model,
        "sentences_classified": completed_sentences,
        "batches": completed_batches,
        "prompt_tokens": total_prompt,
        "completion_tokens": total_completion,
        "cost_usd": cost,
        "duration_seconds": duration,
        "cost_per_1k_sentences": cost_per_1k,
    }, in_price, out_price)

    if failed_ids:
        retry_path = out_path.with_suffix(".failed_ids.txt")
        retry_path.write_text("\n".join(failed_ids), encoding="utf-8")
        print(f"  failed ids -> {retry_path}")


def main() -> int:
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group()
    g.add_argument("--pilot", type=int, nargs="?", const=100, default=None,
                   help="pilot run on N stratified sentences (default 100)")
    g.add_argument("--full", action="store_true", help="classify every sentence")
    p.add_argument("--model", default=DEFAULT_MODEL,
                   help=f"OpenRouter model id (default: {DEFAULT_MODEL}).")
    p.add_argument("--levels", default=None,
                   help="Comma-separated OGTE levels to restrict to (e.g. '01,02').")
    p.add_argument("--from-folder", default=None,
                   help="Read sentences from data/output/<folder>/ogte_*.csv instead of the full pool.")
    p.add_argument("--no-apply", action="store_true",
                   help="With --from-folder, only update the intermediate classifications file; "
                        "do NOT patch the folder's CSVs with the register column. Default is to apply.")
    args = p.parse_args()

    if args.pilot is None and not args.full:
        args.pilot = 100

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
            pool = [s for s in pool if s.ogte_level in wanted]
            print(f"  filtering to levels {sorted(wanted)}: {len(pool):,} in scope")
        remaining = [s for s in pool if s.id not in already]
        print(f"  full: {len(already):,} already classified (all-time), {len(remaining):,} remaining")
        if remaining:
            asyncio.run(run("full", remaining, FULL_OUT, args.model))
            print(f"  full output: {FULL_OUT}")
        else:
            print("  classifier nothing to do (every id already classified).")

        # Patch the target folder's CSVs with the register column. This is the
        # canonical "register" step — after curation finishes, running this
        # script produces a folder whose CSVs all carry an up-to-date register
        # column. Disable with --no-apply.
        if args.from_folder and not args.no_apply:
            folder = OGTE_ROOT / "data" / "output" / args.from_folder
            apply_register_column(folder, FULL_OUT)
    return 0


def apply_register_column(folder: Path, classifications_csv: Path) -> None:
    """Patch every CSV in `folder` so each row carries an up-to-date `register`
    AND `formality` column. Missing columns are inserted (before ogte_level);
    existing values are overwritten from `classifications_csv`. Files are
    rewritten in place."""
    if not folder.exists():
        print(f"  ! apply skipped: {folder} not found")
        return
    if not classifications_csv.exists():
        print(f"  ! apply skipped: {classifications_csv} not found")
        return
    # id -> (register, formality)
    reg: dict[str, tuple[str, str]] = {}
    with classifications_csv.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            reg[r["id"]] = (r.get("register", ""), r.get("formality", ""))
    print(f"  applying register + formality columns to {folder.relative_to(OGTE_ROOT)}/ "
          f"({len(reg):,} classifications loaded) ...")
    total_rows = 0
    total_set = 0
    total_blank = 0
    for csv_path in sorted(folder.glob("ogte_*.csv")):
        with csv_path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            fieldnames = list(reader.fieldnames or [])
            rows = list(reader)
        for col in ("register", "formality"):
            if col not in fieldnames:
                if "ogte_level" in fieldnames:
                    fieldnames.insert(fieldnames.index("ogte_level"), col)
                else:
                    fieldnames.append(col)
        for r in rows:
            total_rows += 1
            entry = reg.get(r["id"])
            if entry:
                r["register"], r["formality"] = entry
                total_set += 1
            else:
                r["register"] = ""
                r["formality"] = ""
                total_blank += 1
        with csv_path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(rows)
    pct = (100 * total_set / total_rows) if total_rows else 0
    print(f"  patched: {total_set:,}/{total_rows:,} rows ({pct:.2f}%) "
          f"{'(no blanks)' if total_blank == 0 else f'— {total_blank:,} blank'}")


if __name__ == "__main__":
    sys.exit(main())
