#!/usr/bin/env python3
"""
Three-stage translation pipeline using OpenRouter LLM.

  Stage 1: Normalize English + extract structured linguistic metadata
  Stage 2: Translate to 17 languages using metadata
  Stage 3: Quality verification and correction (--secure)

Usage:
    python translate_sentences.py --test                # 200 sentences, stratified
    python translate_sentences.py --test --secure       # same + verification
    python translate_sentences.py --secure --verify-passes 3  # three verification rounds per sentence
    python translate_sentences.py --limit 500           # 500 sentences, stratified
    python translate_sentences.py                       # All sentences
    python translate_sentences.py --resume              # Resume from cache
    python translate_sentences.py --sync-from-cache    # copy cache → output only (no API)

Checkpoints write both translation_cache.csv and sentences_translated.csv so the final output
is not left stale if a long run stops before the script exits normally.
"""

import argparse
import asyncio
import json
import os
import random
import time
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Optional

import pandas as pd
from openai import AsyncOpenAI
from pydantic import BaseModel
from tqdm import tqdm

try:
    from dotenv import load_dotenv
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        load_dotenv(env_file)
except ImportError:
    pass


# ── Configuration ────────────────────────────────────────────────

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "google/gemini-3-flash-preview"
DEFAULT_VERIFY_MODEL = "google/gemini-3-flash-preview"
DEFAULT_CONCURRENCY = 20
CHECKPOINT_INTERVAL = 10

TARGET_LANGUAGES = {
    "es": "Spanish (Spain / Castilian)",
    "es_latam": "Spanish (Latin America)",
    "fr": "French (France / Metropolitan)",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese (Brazil)",
    "ru": "Russian",
    "hi": "Hindi",
    "zh": "Chinese (Simplified / Mandarin)",
    "ja": "Japanese",
    "ko": "Korean",
    "vi": "Vietnamese",
    "sv": "Swedish",
    "fi": "Finnish",
    "nl": "Dutch",
    "el": "Greek",
    "ar": "Arabic (Modern Standard)",
}

LANG_CODES = list(TARGET_LANGUAGES.keys())

METADATA_FIELDS = [
    "register",
    "addressee_number",
    "speaker_gender",
    "addressee_gender",
    "tense_aspect",
    "sentence_type",
    "literal_figurative",
]


# ── Pydantic models ─────────────────────────────────────────────

class NormalizationResult(BaseModel):
    text_en: str
    en_notes: str
    register: str
    addressee_number: str
    speaker_gender: str
    addressee_gender: str
    tense_aspect: str
    sentence_type: str
    literal_figurative: str


class TranslationResult(BaseModel):
    es: str
    es_latam: str
    fr: str
    de: str
    it: str
    pt: str
    ru: str
    hi: str
    zh: str
    ja: str
    ko: str
    vi: str
    sv: str
    fi: str
    nl: str
    el: str
    ar: str


class VerificationResult(BaseModel):
    corrections_summary: str
    text_en: Optional[str] = None
    en_notes: Optional[str] = None
    es: Optional[str] = None
    es_latam: Optional[str] = None
    fr: Optional[str] = None
    de: Optional[str] = None
    it: Optional[str] = None
    pt: Optional[str] = None
    ru: Optional[str] = None
    hi: Optional[str] = None
    zh: Optional[str] = None
    ja: Optional[str] = None
    ko: Optional[str] = None
    vi: Optional[str] = None
    sv: Optional[str] = None
    fi: Optional[str] = None
    nl: Optional[str] = None
    el: Optional[str] = None
    ar: Optional[str] = None


# ── Prompts ──────────────────────────────────────────────────────

LANG_LIST = "\n".join(f"- {code}: {name}" for code, name in TARGET_LANGUAGES.items())

NORMALIZE_SYSTEM_PROMPT = """You are an expert linguist preparing English sentences for multilingual translation in a language-learning app.

Analyze the input sentence, resolve ambiguity, and produce structured metadata that will guide translators.

STEP 1 — NORMALIZE THE ENGLISH (text_en)
- Fix minor grammatical issues if any.
- Do NOT change the difficulty level or core meaning.
- Do NOT add bracket tags or annotations — all disambiguation goes into the structured metadata fields.
- Keep the sentence natural and readable.

STEP 2 — FILL IN ALL METADATA FIELDS
Determine the most natural interpretation and fill in EVERY field:

- register: "formal" | "informal" | "neutral"
  Pick the most natural reading. Default to "neutral" only if genuinely ambiguous.

- addressee_number: "singular" | "plural" | "not_applicable"
  "not_applicable" when there is no addressee (narrative, general statement).

- speaker_gender: "male" | "female" | "neutral"
  PRE-ASSIGNED VALUES are provided in the user message. Use them as a default when gender is not inferable.
  You MUST override the pre-assignment when any of these clearly indicate a different gender:
  - Pronouns or explicit words: "She said…", "his book", etc.
  - NAMES: Use typical cultural gender associations of given names. If a name is unisex, ambiguous, or fictional/unknown, do not guess—fall back to pre-assigned or neutral as appropriate. When a name identifies who is speaking or who is being addressed, set speaker_gender / addressee_gender to match that person, not the random pre-assignment.

- addressee_gender: "male" | "female" | "neutral" | "not_applicable"
  Same rules as speaker_gender: pre-assigned default, overridden by pronouns, explicit cues, or clearly gendered names of the person addressed. Use "not_applicable" when there is no addressee.

- tense_aspect: "simple_present" | "present_continuous" | "simple_past" | "past_continuous" | "present_perfect" | "past_perfect" | "simple_future" | "future_continuous" | "conditional" | "imperative" | "infinitive" | "mixed"
  Identify the primary tense/aspect of the main clause verb.

- sentence_type: "declarative" | "interrogative" | "imperative" | "exclamatory"

- literal_figurative: "literal" | "figurative"
  "figurative" if the sentence contains idioms, metaphors, similes, or non-literal language.

STEP 3 — NOTES (en_notes)
1–2 sentences explaining your disambiguation choices and any changes (e.g. if you overrode pre-assigned gender because of a name).
If nothing was ambiguous, write "No disambiguation needed."

Return a JSON object with exactly these keys: text_en, en_notes, register, addressee_number, speaker_gender, addressee_gender, tense_aspect, sentence_type, literal_figurative"""


TRANSLATE_SYSTEM_PROMPT = f"""You are an expert multilingual translator for a language-learning app. You will receive a normalized English sentence with explicit linguistic metadata as a JSON object.

Translate the sentence into all 17 target languages, strictly respecting the metadata.

METADATA FIELDS:
- "register": formal / informal / neutral
- "addressee_number": singular / plural / not_applicable
- "speaker_gender": male / female / neutral (the person speaking)
- "addressee_gender": male / female / neutral / not_applicable (the person addressed)
- "tense_aspect": the tense and aspect to use
- "sentence_type": declarative / interrogative / imperative / exclamatory
- "literal_figurative": literal translation or find a natural equivalent idiom

TRANSLATION RULES:

1. NATURALNESS — Translate meaning, not words. Every translation must sound like it was written by a native speaker. Match the length and complexity of the original.

2. REGISTER — Follow the "register" field strictly:
   - "formal": usted / Sie / vous / Вы / आप / 합쇼체 / أنتَ-أنتِ with formal phrasing / …
   - "informal": tú / du / tu / ты / तुम / 반말 / bạn (casual) / …
   - "neutral": most natural default for the target language

3. GENDER — Reflect "speaker_gender" and "addressee_gender" in every language where grammatically relevant. Maintain gender agreement consistently across all translations.
   Read "text_en" for named people: use grammatical agreement that matches culturally typical gender for those names when the language marks gender (including for the speaker, addressee, or others mentioned). The metadata fields encode who is speaking / addressed; names in the sentence should agree with those roles and genders.

4. CONSISTENCY — All 17 translations must express the exact same meaning, register, gender, number, and aspect. No translation may add or remove nuance.

5. REGIONAL VARIANTS (use exactly these):
   - es: Castilian Spanish as spoken in Spain (vosotros for informal plural, peninsular vocabulary)
   - es_latam: Latin American Spanish (ustedes for plural, avoid country-specific slang)
   - fr: Metropolitan French (France)
   - pt: Brazilian Portuguese
   - zh: Simplified Chinese (Mandarin)
   - ar: Modern Standard Arabic (MSA / fuṣḥā)

6. LANGUAGE-SPECIFIC:
   - Japanese: informal → plain form (だ / する), formal → polite form (です / ます)
   - Korean: informal → 반말, formal → 해요체 or 합쇼체 as appropriate
   - Hindi: informal → तुम form, formal → आप form
   - Arabic: MSA grammar; masculine/feminine as specified by metadata
   - Finnish: formal/informal distinction is minimal; focus on naturalness

{LANG_LIST}

Return a JSON object with exactly these keys: {", ".join(LANG_CODES)}"""


VERIFY_SYSTEM_PROMPT = f"""You are a senior multilingual proofreader and translation-quality auditor. You will receive a normalized English sentence with linguistic metadata and 17 translations.

For EVERY translation, check against the metadata:
1. GRAMMAR — Grammatically correct in the target language?
2. GENDER — Agreement matches speaker_gender and addressee_gender, AND matches clearly gendered names in the original or normalized English (e.g. a female name for the subject should not be translated with masculine agreement). If metadata conflicts with an unambiguous name-based gender, correct the translations (and text_en / en_notes if needed) to align with the name, and explain in corrections_summary.
3. REGISTER — T/V register matches the "register" field?
4. NUMBER — Addressee number matches "addressee_number"?
5. NATURALNESS — Sounds native, not translationese?
6. ACCURACY — Meaning faithfully preserved?
7. VARIANT — Correct regional variant?
   - es: Castilian Spanish (Spain)
   - es_latam: Latin American Spanish
   - fr: Metropolitan French (France)
   - pt: Brazilian Portuguese
   - zh: Simplified Chinese (Mandarin)
   - ar: Modern Standard Arabic (MSA)

Also review the normalized English (text_en): is it natural and faithful to the original? Do named people’s genders in the sentence match speaker_gender / addressee_gender?

RESPONSE FORMAT — return a JSON object:

1. "corrections_summary" (REQUIRED): list every correction as "LANG: what was wrong → what you fixed". If nothing needed fixing, write "No corrections needed".

2. ONLY include language keys that need correction. OMIT any field that is already correct.
   Example — only French and Japanese had issues:
   {{"corrections_summary": "fr: wrong register → fixed to formal, ja: unnatural phrasing → rephrased", "fr": "corrected French", "ja": "corrected Japanese"}}

   If everything was correct:
   {{"corrections_summary": "No corrections needed"}}

   If the English also needs fixing, include "text_en" and/or "en_notes".

Valid keys: corrections_summary, text_en, en_notes, {", ".join(LANG_CODES)}

{LANG_LIST}"""


# ── Utilities ────────────────────────────────────────────────────

def fetch_model_pricing(model: str) -> tuple[float, float]:
    """Fetch per-token pricing from OpenRouter. Returns (input_price, output_price) per token."""
    try:
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/models",
            headers={"HTTP-Referer": "https://github.com/phrasis", "X-Title": "Phrasis Translation"},
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read())
            for m in data.get("data", []):
                if m.get("id") == model:
                    pricing = m.get("pricing", {})
                    return float(pricing.get("prompt", "0")), float(pricing.get("completion", "0"))
    except Exception as e:
        print(f"  Warning: Could not fetch pricing: {e}")
    return 1.25 / 1_000_000, 10.0 / 1_000_000


def format_time(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    if seconds < 3600:
        return f"{seconds / 60:.1f}m"
    return f"{seconds / 3600:.1f}h"


def save_checkpoint(results: list[dict], path: Path, columns: list[str]):
    if not results:
        return
    df = pd.DataFrame(results)
    available = [c for c in columns if c in df.columns]
    df[available].to_csv(path, index=False)


def save_dual_checkpoint(
    results: list[dict],
    output_path: Path,
    cache_path: Path,
    columns: list[str],
) -> None:
    """Write the same snapshot to cache and final output so both stay in sync during long runs."""
    save_checkpoint(results, cache_path, columns)
    save_checkpoint(results, output_path, columns)


def stratified_sample(df: pd.DataFrame, n: int) -> pd.DataFrame:
    """Sample n rows with proportional representation from each difficulty level."""
    if "difficulty" not in df.columns or n >= len(df):
        return df.sample(n=min(n, len(df)), random_state=42).reset_index(drop=True)

    total = len(df)
    levels = df["difficulty"].unique()
    allocations: dict[str, int] = {}

    for level in levels:
        group_size = len(df[df["difficulty"] == level])
        allocations[level] = max(2, round(n * group_size / total))

    allocated = sum(allocations.values())
    sorted_levels = sorted(levels, key=lambda lv: len(df[df["difficulty"] == lv]), reverse=True)
    if allocated > n:
        for lv in sorted_levels:
            if allocated <= n:
                break
            reduction = min(allocations[lv] - 2, allocated - n)
            allocations[lv] -= reduction
            allocated -= reduction
    elif allocated < n:
        for lv in sorted_levels:
            if allocated >= n:
                break
            space = len(df[df["difficulty"] == lv]) - allocations[lv]
            addition = min(space, n - allocated)
            allocations[lv] += addition
            allocated += addition

    parts = []
    for lv, count in allocations.items():
        group = df[df["difficulty"] == lv]
        parts.append(group.sample(n=min(count, len(group)), random_state=42))

    result = pd.concat(parts).reset_index(drop=True)
    desc = ", ".join(f"{lv}: {allocations[lv]}" for lv in sorted(allocations))
    print(f"  Stratified sample: {desc}")
    return result


def _is_empty(v) -> bool:
    if v is None or v == "":
        return True
    if isinstance(v, float) and pd.isna(v):
        return True
    return False


def _needs_normalization(r: dict) -> bool:
    if _is_empty(r.get("text_en")):
        return True
    return any(_is_empty(r.get(f)) for f in METADATA_FIELDS)


def _needs_translation(r: dict) -> bool:
    if _needs_normalization(r):
        return False
    return any(_is_empty(r.get(code)) for code in LANG_CODES)


def _verification_passes_done(r: dict) -> int:
    """How many successful verification passes are recorded for this row."""
    v = r.get("verification_passes")
    if v is not None and not _is_empty(v):
        try:
            return max(0, int(float(v)))
        except (ValueError, TypeError):
            pass
    summary = r.get("corrections_summary")
    if summary == "VERIFICATION FAILED":
        return 0
    if not _is_empty(summary):
        return 1  # legacy rows: summary set but no explicit counter
    return 0


def _needs_verification(r: dict, target_passes: int) -> bool:
    if target_passes <= 0:
        return False
    if _needs_normalization(r) or _needs_translation(r):
        return False
    return _verification_passes_done(r) < target_passes


# ── API calls ────────────────────────────────────────────────────

GENDER_OPTIONS = ["male", "female", "neutral"]


def assign_random_genders() -> tuple[str, str]:
    """Pre-assign random speaker and addressee genders for balanced distribution."""
    return random.choice(GENDER_OPTIONS), random.choice(GENDER_OPTIONS)


async def normalize_sentence(
    client: AsyncOpenAI,
    model: str,
    sentence: str,
    semaphore: asyncio.Semaphore,
    assigned_speaker_gender: str = "neutral",
    assigned_addressee_gender: str = "neutral",
    max_retries: int = 3,
    timeout: float = 120,
) -> tuple[NormalizationResult | None, dict]:
    usage = {"prompt_tokens": 0, "completion_tokens": 0}

    user_prompt = (
        f'Analyze and normalize this sentence:\n\n"{sentence}"\n\n'
        f"Pre-assigned gender defaults (for balance when the sentence does not imply gender). "
        f"You may override them using pronouns, explicit cues, or culturally typical gender of people's names:\n"
        f"- speaker_gender default: {assigned_speaker_gender}\n"
        f"- addressee_gender default: {assigned_addressee_gender}"
    )

    for attempt in range(max_retries):
        async with semaphore:
            try:
                completion = await asyncio.wait_for(
                    client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": NORMALIZE_SYSTEM_PROMPT},
                            {"role": "user", "content": user_prompt},
                        ],
                        response_format={"type": "json_object"},
                        temperature=0.3,
                    ),
                    timeout=timeout,
                )
                content = completion.choices[0].message.content
                if not content:
                    raise ValueError("Empty response")
                parsed = NormalizationResult.model_validate_json(content)
                if completion.usage:
                    usage["prompt_tokens"] = completion.usage.prompt_tokens
                    usage["completion_tokens"] = completion.usage.completion_tokens
                return parsed, usage
            except asyncio.TimeoutError:
                if attempt < max_retries - 1:
                    tqdm.write(f"  Normalize timeout attempt {attempt + 1}: \"{sentence[:50]}...\"")
                else:
                    tqdm.write(f"  Normalize FAILED (timeout): \"{sentence[:50]}...\"")
                    return None, usage
            except Exception as e:
                if attempt < max_retries - 1:
                    wait = 2 ** (attempt + 1) + 1
                    tqdm.write(f"  Normalize retry {attempt + 1}: {str(e)[:100]}")
                    await asyncio.sleep(wait)
                else:
                    tqdm.write(f"  Normalize FAILED: \"{sentence[:50]}...\" — {str(e)[:120]}")
                    return None, usage
    return None, usage


async def translate_sentence(
    client: AsyncOpenAI,
    model: str,
    row_data: dict,
    semaphore: asyncio.Semaphore,
    max_retries: int = 3,
    timeout: float = 180,
) -> tuple[TranslationResult | None, dict]:
    usage = {"prompt_tokens": 0, "completion_tokens": 0}

    metadata = {
        "text_en": row_data.get("text_en", ""),
        "register": row_data.get("register", "neutral"),
        "addressee_number": row_data.get("addressee_number", "singular"),
        "speaker_gender": row_data.get("speaker_gender", "neutral"),
        "addressee_gender": row_data.get("addressee_gender", "neutral"),
        "tense_aspect": row_data.get("tense_aspect", "simple_present"),
        "sentence_type": row_data.get("sentence_type", "declarative"),
        "literal_figurative": row_data.get("literal_figurative", "literal"),
    }
    user_prompt = f"Translate this sentence using the metadata:\n\n{json.dumps(metadata, indent=2, ensure_ascii=False)}"

    for attempt in range(max_retries):
        async with semaphore:
            try:
                completion = await asyncio.wait_for(
                    client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": TRANSLATE_SYSTEM_PROMPT},
                            {"role": "user", "content": user_prompt},
                        ],
                        response_format={"type": "json_object"},
                        temperature=0.3,
                    ),
                    timeout=timeout,
                )
                content = completion.choices[0].message.content
                if not content:
                    raise ValueError("Empty response")
                parsed = TranslationResult.model_validate_json(content)
                if completion.usage:
                    usage["prompt_tokens"] = completion.usage.prompt_tokens
                    usage["completion_tokens"] = completion.usage.completion_tokens
                return parsed, usage
            except asyncio.TimeoutError:
                if attempt < max_retries - 1:
                    tqdm.write(f"  Translate timeout attempt {attempt + 1}: \"{metadata['text_en'][:50]}...\"")
                else:
                    tqdm.write(f"  Translate FAILED (timeout): \"{metadata['text_en'][:50]}...\"")
                    return None, usage
            except Exception as e:
                if attempt < max_retries - 1:
                    wait = 2 ** (attempt + 1) + 1
                    tqdm.write(f"  Translate retry {attempt + 1}: {str(e)[:100]}")
                    await asyncio.sleep(wait)
                else:
                    tqdm.write(f"  Translate FAILED: \"{metadata['text_en'][:50]}...\" — {str(e)[:120]}")
                    return None, usage
    return None, usage


async def verify_sentence(
    client: AsyncOpenAI,
    model: str,
    row: dict,
    semaphore: asyncio.Semaphore,
    max_retries: int = 2,
    timeout: float = 180,
) -> tuple[VerificationResult | None, dict]:
    usage = {"prompt_tokens": 0, "completion_tokens": 0}

    metadata = {
        "text_en": row.get("text_en", ""),
        "register": row.get("register", ""),
        "addressee_number": row.get("addressee_number", ""),
        "speaker_gender": row.get("speaker_gender", ""),
        "addressee_gender": row.get("addressee_gender", ""),
        "tense_aspect": row.get("tense_aspect", ""),
        "sentence_type": row.get("sentence_type", ""),
        "literal_figurative": row.get("literal_figurative", ""),
    }

    lines = [
        f'Original English: "{row.get("text", "")}"',
        f"Normalized English & metadata:\n{json.dumps(metadata, indent=2, ensure_ascii=False)}",
        f'Notes: {row.get("en_notes", "")}',
        "",
        "Translations to verify:",
    ]
    for code, name in TARGET_LANGUAGES.items():
        lines.append(f'  {code} ({name}): "{row.get(code, "")}"')
    user_prompt = "\n".join(lines)

    for attempt in range(max_retries):
        async with semaphore:
            try:
                completion = await asyncio.wait_for(
                    client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": VERIFY_SYSTEM_PROMPT},
                            {"role": "user", "content": user_prompt},
                        ],
                        response_format={"type": "json_object"},
                        temperature=0.2,
                    ),
                    timeout=timeout,
                )
                content = completion.choices[0].message.content
                if not content:
                    raise ValueError("Empty response")
                parsed = VerificationResult.model_validate_json(content)
                if completion.usage:
                    usage["prompt_tokens"] = completion.usage.prompt_tokens
                    usage["completion_tokens"] = completion.usage.completion_tokens
                return parsed, usage
            except asyncio.TimeoutError:
                if attempt < max_retries - 1:
                    tqdm.write(f"  Verify timeout: \"{row.get('text', '')[:50]}...\"")
                else:
                    tqdm.write(f"  Verify FAILED (timeout): \"{row.get('text', '')[:50]}...\"")
                    return None, usage
            except Exception as e:
                if attempt < max_retries - 1:
                    wait = 2 ** (attempt + 1) + 1
                    tqdm.write(f"  Verify retry {attempt + 1}: {str(e)[:100]}")
                    await asyncio.sleep(wait)
                else:
                    tqdm.write(f"  Verify FAILED: \"{row.get('text', '')[:50]}...\" — {str(e)[:120]}")
                    return None, usage
    return None, usage


async def normalize_one(client, model, sent_dict, semaphore):
    spk, addr = assign_random_genders()
    result, usage = await normalize_sentence(
        client, model, sent_dict["text"], semaphore,
        assigned_speaker_gender=spk,
        assigned_addressee_gender=addr,
    )
    return sent_dict, result, usage


async def translate_one(client, model, row_data, semaphore):
    result, usage = await translate_sentence(client, model, row_data, semaphore)
    return row_data, result, usage


async def verify_one(client, model, row, semaphore):
    result, usage = await verify_sentence(client, model, row, semaphore)
    return row, result, usage


# ── Main ─────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(
        description="Three-stage translation pipeline: normalize → translate → verify"
    )
    parser.add_argument("--input", type=str, default=None, help="Path to input CSV")
    parser.add_argument("--output", type=str, default=None, help="Path to output CSV")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL,
                        help=f"OpenRouter model (default: {DEFAULT_MODEL})")
    parser.add_argument("--test", action="store_true", help="Run on 200 sentences, stratified by difficulty")
    parser.add_argument("--limit", type=int, default=None, help="Run on N sentences (stratified)")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY,
                        help=f"Max parallel API calls (default: {DEFAULT_CONCURRENCY})")
    parser.add_argument("--resume", action="store_true",
                        help="Resume from cache (auto-detected if cache exists)")
    parser.add_argument("--secure", action="store_true",
                        help="Run Stage 3 verification pass for QA and correction")
    parser.add_argument("--verify-model", type=str, default=DEFAULT_VERIFY_MODEL,
                        help=f"OpenRouter model for Stage 3 verification (default: same as --model)")
    parser.add_argument("--verify-passes", type=int, default=1,
                        help="How many verification passes to run per sentence (Stage 3; requires --secure). Default 1.")
    parser.add_argument(
        "--sync-from-cache",
        action="store_true",
        help="Copy translation_cache.csv to the output CSV and exit (no API calls, no pipeline stages).",
    )
    args = parser.parse_args()

    if args.verify_model == DEFAULT_VERIFY_MODEL and args.model != DEFAULT_MODEL:
        args.verify_model = args.model
    if args.verify_passes < 1:
        print("  Warning: --verify-passes must be >= 1; using 1.")
        args.verify_passes = 1

    script_dir = Path(__file__).parent
    data_dir = script_dir / "data" / "output"

    input_path = Path(args.input) if args.input else data_dir / "sentences.csv"
    output_path = Path(args.output) if args.output else data_dir / "sentences_translated.csv"
    cache_path = output_path.with_name("translation_cache.csv")

    if args.sync_from_cache:
        if not cache_path.exists():
            print(f"Error: Cache not found: {cache_path}")
            return
        cache_df = pd.read_csv(cache_path)
        all_results = cache_df.to_dict("records")
        if input_path.exists():
            df_cols = pd.read_csv(input_path, nrows=0)
            original_columns = list(df_cols.columns)
            output_columns = (
                original_columns
                + ["text_en", "en_notes"]
                + METADATA_FIELDS
                + LANG_CODES
                + ["corrections_summary", "verification_passes"]
            )
            save_checkpoint(all_results, output_path, output_columns)
        else:
            save_checkpoint(all_results, output_path, list(cache_df.columns))
        print("=" * 64)
        print("  SYNC FROM CACHE (no API)")
        print("=" * 64)
        print(f"  Source:  {cache_path}")
        print(f"  Wrote:   {output_path}")
        print(f"  Rows:    {len(all_results):,}")
        return

    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}")
        return

    limit = args.limit
    if args.test:
        limit = 200

    # ── Load input ──────────────────────────────────────────────
    df = pd.read_csv(input_path)
    total_sentences = len(df)
    original_columns = list(df.columns)

    if limit:
        df = stratified_sample(df, limit)

    if "rank" in df.columns:
        df = df.sort_values("rank", ascending=True).reset_index(drop=True)

    output_columns = (
        original_columns
        + ["text_en", "en_notes"]
        + METADATA_FIELDS
        + LANG_CODES
        + ["corrections_summary", "verification_passes"]
    )

    print("=" * 64)
    print("  TRANSLATION PIPELINE (3-stage)")
    print("=" * 64)
    print(f"  Input:       {input_path}")
    print(f"               {total_sentences:,} total sentences in file")
    print(f"  Output:      {output_path}")
    print(f"  Model:       {args.model}")
    if args.secure and args.verify_model != args.model:
        print(f"  Verify model:{args.verify_model}")
    print(f"  Concurrency: {args.concurrency}")
    print(f"  Languages:   {len(TARGET_LANGUAGES)} targets")
    mode = "TEST (200)" if args.test else f"LIMITED ({limit})" if limit else "FULL"
    print(f"  Mode:        {mode} — {len(df):,} sentences")
    print(f"  Secure:      {'YES (Stage 3 verification)' if args.secure else 'no'}")
    if args.secure:
        print(f"  Verify passes:{args.verify_passes}")
    print()

    # ── Load cache + merge ──────────────────────────────────────
    all_results: list[dict] = []
    known_ids: set = set()

    if cache_path.exists():
        try:
            cache_df = pd.read_csv(cache_path)
            for _, row in cache_df.iterrows():
                all_results.append(row.to_dict())
                known_ids.add(row["id"])
            print(f"  Cache:       {len(known_ids):,} sentences loaded")
        except Exception as e:
            print(f"  Warning: Could not load cache: {e}")

    new_count = 0
    for _, row in df.iterrows():
        if row["id"] not in known_ids:
            all_results.append(row.to_dict())
            known_ids.add(row["id"])
            new_count += 1

    if new_count:
        print(f"  New:         {new_count:,} sentences added from input")

    all_results.sort(key=lambda r: (int(r.get("rank", 0) if not _is_empty(r.get("rank")) else 0), str(r.get("difficulty", ""))))

    need_norm = sum(1 for r in all_results if _needs_normalization(r))
    need_trans = sum(1 for r in all_results if _needs_translation(r))
    need_verify = (
        sum(1 for r in all_results if _needs_verification(r, args.verify_passes))
        if args.secure else 0
    )
    print(f"  Need Stage 1 (normalize):  {need_norm:,}")
    print(f"  Need Stage 2 (translate):  {need_trans:,}")
    if args.secure:
        print(f"  Need Stage 3 (verify):     {need_verify:,}")
    print()

    if need_norm == 0 and need_trans == 0 and (not args.secure or need_verify == 0):
        print("  Nothing to process — all sentences up to date.")
        save_dual_checkpoint(all_results, output_path, cache_path, output_columns)
        return

    # ── Initialize client ───────────────────────────────────────
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("Error: OPENROUTER_API_KEY not set in environment")
        return

    client = AsyncOpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)
    semaphore = asyncio.Semaphore(args.concurrency)

    print("  Fetching model pricing...")
    input_price, output_price = fetch_model_pricing(args.model)
    print(f"  Pricing: ${input_price * 1_000_000:.2f} / M input, ${output_price * 1_000_000:.2f} / M output")
    print()

    start_time = time.time()
    s1 = {"processed": 0, "failed": 0, "prompt_tokens": 0, "completion_tokens": 0}
    s2 = {"processed": 0, "failed": 0, "prompt_tokens": 0, "completion_tokens": 0}
    s3 = {"verified": 0, "corrected": 0, "failed": 0, "prompt_tokens": 0, "completion_tokens": 0}
    lang_correction_counts: Counter = Counter()
    correction_log: list[dict] = []

    # ── STAGE 1: Normalization ──────────────────────────────────
    rows_for_s1 = [r for r in all_results if _needs_normalization(r)]

    if rows_for_s1:
        print("-" * 64)
        print(f"  STAGE 1: Normalizing {len(rows_for_s1):,} sentences")
        print("-" * 64)

        since_ckpt = 0
        tasks = [asyncio.create_task(normalize_one(client, args.model, r, semaphore)) for r in rows_for_s1]

        with tqdm(total=len(tasks), desc="S1 Normalize", unit="sent",
                  bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}, {rate_fmt}] {postfix}") as pbar:
            for future in asyncio.as_completed(tasks):
                sent_dict, normalization, usage = await future

                s1["prompt_tokens"] += usage["prompt_tokens"]
                s1["completion_tokens"] += usage["completion_tokens"]

                if normalization:
                    sent_dict["text_en"] = normalization.text_en
                    sent_dict["en_notes"] = normalization.en_notes
                    for field in METADATA_FIELDS:
                        sent_dict[field] = getattr(normalization, field)
                    # Invalidate downstream stages
                    for lang in LANG_CODES:
                        sent_dict[lang] = ""
                    sent_dict["corrections_summary"] = ""
                    sent_dict["verification_passes"] = 0
                    s1["processed"] += 1
                else:
                    s1["failed"] += 1

                pbar.update(1)
                since_ckpt += 1

                cost = (s1["prompt_tokens"] * input_price + s1["completion_tokens"] * output_price)
                pbar.set_postfix(cost=f"${cost:.4f}", fail=s1["failed"])

                if since_ckpt >= CHECKPOINT_INTERVAL:
                    save_dual_checkpoint(all_results, output_path, cache_path, output_columns)
                    since_ckpt = 0

        save_dual_checkpoint(all_results, output_path, cache_path, output_columns)
        print(f"  Stage 1 done: {s1['processed']} normalized, {s1['failed']} failed")
        print()

    # ── STAGE 2: Translation ────────────────────────────────────
    rows_for_s2 = [r for r in all_results if _needs_translation(r)]

    if rows_for_s2:
        print("-" * 64)
        print(f"  STAGE 2: Translating {len(rows_for_s2):,} sentences → {len(TARGET_LANGUAGES)} languages")
        print("-" * 64)

        since_ckpt = 0
        tasks = [asyncio.create_task(translate_one(client, args.model, r, semaphore)) for r in rows_for_s2]

        with tqdm(total=len(tasks), desc="S2 Translate", unit="sent",
                  bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}, {rate_fmt}] {postfix}") as pbar:
            for future in asyncio.as_completed(tasks):
                row_data, translation, usage = await future

                s2["prompt_tokens"] += usage["prompt_tokens"]
                s2["completion_tokens"] += usage["completion_tokens"]

                if translation:
                    for lang in LANG_CODES:
                        row_data[lang] = getattr(translation, lang)
                    row_data["corrections_summary"] = ""
                    row_data["verification_passes"] = 0
                    s2["processed"] += 1
                else:
                    s2["failed"] += 1

                pbar.update(1)
                since_ckpt += 1

                cost = ((s1["prompt_tokens"] + s2["prompt_tokens"]) * input_price
                        + (s1["completion_tokens"] + s2["completion_tokens"]) * output_price)
                pbar.set_postfix(cost=f"${cost:.4f}", fail=s2["failed"])

                if since_ckpt >= CHECKPOINT_INTERVAL:
                    save_dual_checkpoint(all_results, output_path, cache_path, output_columns)
                    since_ckpt = 0

        save_dual_checkpoint(all_results, output_path, cache_path, output_columns)
        print(f"  Stage 2 done: {s2['processed']} translated, {s2['failed']} failed")
        print()

    # ── STAGE 3: Verification (--secure) ────────────────────────
    if args.secure:
        print("-" * 64)
        print("  STAGE 3: Verification")
        already_done = sum(
            1
            for r in all_results
            if not _needs_normalization(r)
            and not _needs_translation(r)
            and _verification_passes_done(r) >= args.verify_passes
        )
        if already_done:
            print(f"  Fully verified:  {already_done:,} sentences ({args.verify_passes} pass(es) each)")
        print("-" * 64)

        for pass_num in range(1, args.verify_passes + 1):
            rows_for_s3 = [r for r in all_results if _needs_verification(r, args.verify_passes)]

            if not rows_for_s3:
                if pass_num == 1:
                    print("  Nothing to verify — all translations already checked.")
                break

            print(f"  Pass {pass_num}/{args.verify_passes}: {len(rows_for_s3):,} sentence(s)")

            since_ckpt = 0
            tasks = [
                asyncio.create_task(verify_one(client, args.verify_model, r, semaphore))
                for r in rows_for_s3
            ]

            with tqdm(
                total=len(tasks),
                desc=f"S3 Verify {pass_num}/{args.verify_passes}",
                unit="sent",
                bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}, {rate_fmt}] {postfix}",
            ) as pbar:
                for future in asyncio.as_completed(tasks):
                    original_row, verification, usage = await future

                    s3["prompt_tokens"] += usage["prompt_tokens"]
                    s3["completion_tokens"] += usage["completion_tokens"]

                    if verification:
                        s3["verified"] += 1
                        summary = verification.corrections_summary
                        had_corrections = summary and summary.lower() != "no corrections needed"

                        corrected_fields: list[str] = []

                        if verification.text_en is not None:
                            original_row["text_en"] = verification.text_en
                            corrected_fields.append("text_en")
                            lang_correction_counts["text_en"] += 1
                        if verification.en_notes is not None:
                            original_row["en_notes"] = verification.en_notes
                        for lang in LANG_CODES:
                            corrected = getattr(verification, lang)
                            if corrected is not None:
                                original_row[lang] = corrected
                                corrected_fields.append(lang)
                                lang_correction_counts[lang] += 1
                        # Increment before updating summary so count isn't double-counted via legacy rule
                        new_pass_count = _verification_passes_done(original_row) + 1
                        original_row["corrections_summary"] = summary
                        original_row["verification_passes"] = new_pass_count

                        if had_corrections:
                            s3["corrected"] += 1
                            tqdm.write(
                                f"  Corrected [pass {pass_num}]: \"{original_row.get('text', '')[:40]}…\" — {summary[:120]}"
                            )
                            correction_log.append({
                                "verification_pass": pass_num,
                                "verification_passes_after": new_pass_count,
                                "id": original_row.get("id"),
                                "text": original_row.get("text", ""),
                                "corrected_fields": corrected_fields,
                                "summary": summary,
                            })
                    else:
                        s3["failed"] += 1
                        original_row["corrections_summary"] = "VERIFICATION FAILED"

                    pbar.update(1)
                    since_ckpt += 1

                    total_pt = s1["prompt_tokens"] + s2["prompt_tokens"] + s3["prompt_tokens"]
                    total_ct = s1["completion_tokens"] + s2["completion_tokens"] + s3["completion_tokens"]
                    cost = total_pt * input_price + total_ct * output_price
                    pbar.set_postfix(cost=f"${cost:.4f}", corrected=s3["corrected"], fail=s3["failed"])

                    if since_ckpt >= CHECKPOINT_INTERVAL:
                        save_dual_checkpoint(all_results, output_path, cache_path, output_columns)
                        since_ckpt = 0

            save_dual_checkpoint(all_results, output_path, cache_path, output_columns)

        if correction_log:
            log_path = output_path.with_name("verification_log.json")
            existing_log: list = []
            if log_path.exists():
                try:
                    with open(log_path, "r", encoding="utf-8") as f:
                        existing_log = json.load(f)
                except Exception:
                    pass
            existing_log.extend(correction_log)
            with open(log_path, "w", encoding="utf-8") as f:
                json.dump(existing_log, f, ensure_ascii=False, indent=2)
            print(f"\n  Corrections log: {log_path} ({len(existing_log)} total entries)")

    # ── Save final output (also refreshes cache if stages were skipped) ──
    save_dual_checkpoint(all_results, output_path, cache_path, output_columns)

    # ── Summary ─────────────────────────────────────────────────
    elapsed = time.time() - start_time
    total_pt = s1["prompt_tokens"] + s2["prompt_tokens"] + s3["prompt_tokens"]
    total_ct = s1["completion_tokens"] + s2["completion_tokens"] + s3["completion_tokens"]
    total_cost = total_pt * input_price + total_ct * output_price
    sentences_processed = max(s1["processed"], s2["processed"])

    print()
    print("=" * 64)
    print("  SUMMARY")
    print("=" * 64)

    if s1["processed"] or s1["failed"]:
        s1_cost = s1["prompt_tokens"] * input_price + s1["completion_tokens"] * output_price
        print(f"  Stage 1 (Normalize): {s1['processed']} done, {s1['failed']} failed")
        print(f"    Tokens: {s1['prompt_tokens']:,} in / {s1['completion_tokens']:,} out — ${s1_cost:.4f}")

    if s2["processed"] or s2["failed"]:
        s2_cost = s2["prompt_tokens"] * input_price + s2["completion_tokens"] * output_price
        print(f"  Stage 2 (Translate): {s2['processed']} done, {s2['failed']} failed")
        print(f"    Tokens: {s2['prompt_tokens']:,} in / {s2['completion_tokens']:,} out — ${s2_cost:.4f}")

    if args.secure and (s3["verified"] or s3["failed"]):
        s3_cost = s3["prompt_tokens"] * input_price + s3["completion_tokens"] * output_price
        pct = 100 * s3["corrected"] / max(1, s3["verified"])
        print(f"  Stage 3 (Verify):    {s3['verified']} verified, {s3['corrected']} corrected ({pct:.1f}%), {s3['failed']} failed")
        print(f"    Tokens: {s3['prompt_tokens']:,} in / {s3['completion_tokens']:,} out — ${s3_cost:.4f}")

        if lang_correction_counts:
            print()
            print("  Per-field correction counts:")
            print(f"  {'Field':<30} {'Count':>6} {'Rate':>7}")
            print(f"  {'-'*30} {'-'*6} {'-'*7}")
            for field in ["text_en"] + LANG_CODES:
                count = lang_correction_counts.get(field, 0)
                if count > 0:
                    rate = 100 * count / max(1, s3["verified"])
                    label = f"{field} ({TARGET_LANGUAGES[field]})" if field in TARGET_LANGUAGES else field
                    print(f"  {label:<30} {count:>6} {rate:>6.1f}%")
            total_fc = sum(lang_correction_counts.values())
            print(f"  {'Total':<30} {total_fc:>6}")
            if s3["corrected"]:
                print(f"  Avg corrections/sentence: {total_fc / s3['corrected']:.1f}")

    print()
    print(f"  Total time:        {format_time(elapsed)}")
    if elapsed > 0 and sentences_processed > 0:
        print(f"  Rate:              {sentences_processed / elapsed:.2f} sentences/sec")
    print(f"  Total tokens:      {total_pt:,} in / {total_ct:,} out")
    print(f"  Total cost:        ${total_cost:.4f}")
    if sentences_processed > 0:
        cost_per = total_cost / sentences_processed
        print(f"  Cost/sentence:     ${cost_per:.6f}")
    print(f"  Output:            {output_path}")
    print(f"  Cache:             {cache_path}")

    if limit and total_sentences > (limit or 0) and sentences_processed > 0:
        cost_per = total_cost / sentences_processed
        ext_cost = cost_per * total_sentences
        ext_time = (elapsed / sentences_processed) * total_sentences
        print()
        print(f"  --- Extrapolation to full dataset ({total_sentences:,} sentences) ---")
        stages = "S1+S2" + ("+S3" if args.secure else "")
        print(f"  Estimated cost ({stages}): ${ext_cost:.2f}")
        print(f"  Estimated time:            {format_time(ext_time)}")


if __name__ == "__main__":
    asyncio.run(main())
