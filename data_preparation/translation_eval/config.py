"""
Configuration for the translation-evaluation pipeline.

Single source of truth for: OpenRouter endpoint, target-language list (mirrors
the production list in convex/features and lib/languages.ts), FLORES-200 code
mapping, model grid, and prompt grid.
"""

from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────

PACKAGE_DIR = Path(__file__).parent
DATA_DIR = PACKAGE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

FLORES_SAMPLE_PATH = DATA_DIR / "flores_sample.csv"
TRANSLATIONS_CACHE_PATH = DATA_DIR / "translations_cache.csv"
RESULTS_PATH = DATA_DIR / "results.csv"
COMET_CACHE_PATH = DATA_DIR / "comet_scores.csv"


# ── OpenRouter ───────────────────────────────────────────────────

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_CONCURRENCY = 20
DEFAULT_TIMEOUT_S = 90
DEFAULT_MAX_RETRIES = 4

# Hard ceiling on output tokens per request — bounds the bill for thinking
# models that otherwise emit thousands of reasoning tokens per single-sentence
# translation. 5 000 leaves plenty of room for a complete answer with light
# reasoning; thinking-heavy models will be truncated rather than billed for
# extended deliberation. Reflected in cost-per-1M-char tracking.
MAX_OUTPUT_TOKENS = 5_000

# OpenRouter pricing snapshot (USD per million tokens). Update when models
# move to new pricing tiers — used only for the cost-tracking summary at the
# end of run_eval; no production cost decisions ride on these numbers.
# Keys are eval `id` from MODELS below.
MODEL_PRICING: dict[str, dict[str, float]] = {
    # OpenRouter listing prices (USD per million tokens), verified 2026-05-12:
    #   google/gemini-3-flash-preview            : $0.50 in / $3.00 out
    #   google/gemini-3.1-flash-lite-preview     : $0.25 in / $1.50 out
    #   google/gemini-2.5-flash-lite             : $0.10 in / $0.40 out
    "gemini-3-flash":                 {"input_per_m": 0.50, "output_per_m": 3.00},
    "gemini-3-flash-min-think":       {"input_per_m": 0.50, "output_per_m": 3.00},
    "gemini-3-flash-low-think":       {"input_per_m": 0.50, "output_per_m": 3.00},
    "gemini-3-flash-med-think":       {"input_per_m": 0.50, "output_per_m": 3.00},
    "gemini-3-flash-high-think":      {"input_per_m": 0.50, "output_per_m": 3.00},
    "gemini-3.1-flash-lite":              {"input_per_m": 0.25, "output_per_m": 1.50},
    "gemini-3.1-flash-lite-min-think":    {"input_per_m": 0.25, "output_per_m": 1.50},
    "gemini-3.1-flash-lite-low-think":    {"input_per_m": 0.25, "output_per_m": 1.50},
    "gemini-3.1-flash-lite-med-think":    {"input_per_m": 0.25, "output_per_m": 1.50},
    "gemini-3.1-flash-lite-high-think":   {"input_per_m": 0.25, "output_per_m": 1.50},
    "gemini-2.5-flash-lite-baseline":     {"input_per_m": 0.10, "output_per_m": 0.40},
    # DeepSeek V4 Flash — verified on OpenRouter 2026-05-12.
    "deepseek-v4-flash-low-think":        {"input_per_m": 0.14, "output_per_m": 0.28},
    "deepseek-v4-flash-max-think":        {"input_per_m": 0.14, "output_per_m": 0.28},
}


# ── Target languages ─────────────────────────────────────────────
# Internal-code → (display name, BCP-47 region for prompt, FLORES-200 code).
# Internal codes mirror lib/languages.ts in the app.
# FLORES-200 has no Spain/LatAm split for Spanish or BR/PT split for Portuguese,
# so both internal variants point at the same FLORES reference.

TARGET_LANGUAGES: dict[str, dict[str, str]] = {
    "es":       {"name": "Spanish",     "region": "Spain",                "flores": "spa_Latn"},
    "es_latam": {"name": "Spanish",     "region": "Latin America",        "flores": "spa_Latn"},
    "fr":       {"name": "French",      "region": "France",               "flores": "fra_Latn"},
    "de":       {"name": "German",      "region": "Germany",              "flores": "deu_Latn"},
    "it":       {"name": "Italian",     "region": "Italy",                "flores": "ita_Latn"},
    "pt":       {"name": "Portuguese",  "region": "Brazil",               "flores": "por_Latn"},
    "ru":       {"name": "Russian",     "region": "Russia",               "flores": "rus_Cyrl"},
    "hi":       {"name": "Hindi",       "region": "India",                "flores": "hin_Deva"},
    "zh":       {"name": "Chinese",     "region": "Mainland China",       "flores": "cmn_Hans"},
    "ja":       {"name": "Japanese",    "region": "Japan",                "flores": "jpn_Jpan"},
    "ko":       {"name": "Korean",      "region": "South Korea",          "flores": "kor_Hang"},
    "vi":       {"name": "Vietnamese",  "region": "Vietnam",              "flores": "vie_Latn"},
    "sv":       {"name": "Swedish",     "region": "Sweden",               "flores": "swe_Latn"},
    "fi":       {"name": "Finnish",     "region": "Finland",              "flores": "fin_Latn"},
    "nl":       {"name": "Dutch",       "region": "Netherlands",          "flores": "nld_Latn"},
    "el":       {"name": "Greek",       "region": "Greece",               "flores": "ell_Grek"},
    "ar":       {"name": "Arabic",      "region": "MSA / pan-Arab",       "flores": "arb_Arab"},
}

SOURCE_FLORES_CODE = "eng_Latn"


# ── Sampling ─────────────────────────────────────────────────────
# 100 source sentences from FLORES-200 devtest. "Hard" = highest character-length
# tertile (proxy for sentence complexity) plus a deterministic random shuffle.
# Replaceable: see flores_loader.py.

SAMPLE_SIZE = 100
FLORES_SPLIT = "devtest"     # 1012 sentences; "dev" has 997. Both are aligned across all langs.
SAMPLE_RANDOM_SEED = 20260512


# ── Models under test ────────────────────────────────────────────
# Each entry is one cell in the eval grid. `reasoning` is sent as
# `reasoning: {effort: ...}` per OpenRouter docs (only Gemini 3 honours it).

MODELS: list[dict] = [
    {
        "id":        "gemini-3-flash",
        "model":     "google/gemini-3-flash-preview",
        "reasoning": None,
    },
    {
        # Explicit minimal-thinking variant for cost/quality comparison against
        # the default-thinking cell above. OpenRouter maps `effort` levels to
        # each provider's thinking-budget knob.
        "id":        "gemini-3-flash-min-think",
        "model":     "google/gemini-3-flash-preview",
        "reasoning": "minimal",
    },
    {
        "id":        "gemini-3-flash-low-think",
        "model":     "google/gemini-3-flash-preview",
        "reasoning": "low",
    },
    {
        "id":        "gemini-3-flash-med-think",
        "model":     "google/gemini-3-flash-preview",
        "reasoning": "medium",
    },
    {
        # Note: with MAX_OUTPUT_TOKENS=5000, high thinking will frequently be
        # truncated mid-reasoning and yield empty/partial translations. Useful
        # to keep in the grid so the failure mode shows up in the leaderboard.
        "id":        "gemini-3-flash-high-think",
        "model":     "google/gemini-3-flash-preview",
        "reasoning": "high",
    },
    {
        "id":        "gemini-3.1-flash-lite",
        "model":     "google/gemini-3.1-flash-lite-preview",
        "reasoning": None,
    },
    {
        "id":        "gemini-3.1-flash-lite-min-think",
        "model":     "google/gemini-3.1-flash-lite-preview",
        "reasoning": "minimal",
    },
    {
        "id":        "gemini-3.1-flash-lite-low-think",
        "model":     "google/gemini-3.1-flash-lite-preview",
        "reasoning": "low",
    },
    {
        "id":        "gemini-3.1-flash-lite-med-think",
        "model":     "google/gemini-3.1-flash-lite-preview",
        "reasoning": "medium",
    },
    {
        "id":        "gemini-3.1-flash-lite-high-think",
        "model":     "google/gemini-3.1-flash-lite-preview",
        "reasoning": "high",
    },
    {
        "id":        "gemini-2.5-flash-lite-baseline",
        "model":     "google/gemini-2.5-flash-lite",
        "reasoning": None,
    },
    {
        # DeepSeek V4 Flash — MoE reasoning model from DeepSeek. Significantly
        # cheaper than Gemini 3.1 Flash Lite ($0.14 in / $0.28 out vs $0.25/$1.50).
        # OpenRouter passes `effort` through; DeepSeek accepts 'low'/'high'/'xhigh'.
        # NB: max-think (reasoning='xhigh') was tested and removed — averaged
        # ~1100 output tokens per call (vs 305 for low-think) on OGTE, pushing
        # $/M src chars to $13 with negligible quality lift. See history.
        "id":        "deepseek-v4-flash-low-think",
        "model":     "deepseek/deepseek-v4-flash",
        "reasoning": "low",
    },
]


# ── Prompts under test ───────────────────────────────────────────
# Imported from prompts.py to keep the long strings out of this file.

from prompts import PROMPT_A_PURE_PROSE, PROMPT_B_XML_STRUCTURED  # noqa: E402

PROMPTS: list[dict] = [
    {"id": "A_pure_prose",      "template": PROMPT_A_PURE_PROSE},
    {"id": "B_xml_structured",  "template": PROMPT_B_XML_STRUCTURED},
]


# ── Metadata injection ───────────────────────────────────────────
# FLORES sentences are pure prose with no speaker/addressee/register annotation.
# We assign deterministic metadata per source-sentence index so that:
#   - Prompts A and B see the same metadata for the same source (apples-to-apples)
#   - The distribution covers all combinations (gender × register) roughly evenly
#   - Future re-runs with the same SAMPLE_RANDOM_SEED produce identical metadata

SPEAKER_GENDERS = ("male", "female", "neutral")
ADDRESSEE_GENDERS = ("male", "female", "neutral")
FORMALITIES = ("formal", "informal", "neutral")


def metadata_for_index(idx: int) -> dict[str, str]:
    """Deterministic metadata assignment from sentence index.

    Uses three coprime moduli so combinations spread out across 100 sentences.
    """
    return {
        "speaker_gender":   SPEAKER_GENDERS[idx % 3],
        "addressee_gender": ADDRESSEE_GENDERS[(idx // 3) % 3],
        "formality":        FORMALITIES[(idx // 9) % 3],
    }
