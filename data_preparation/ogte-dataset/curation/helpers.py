"""Shared helpers for OGTE level curation + review."""

from __future__ import annotations

import csv
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent
INPUT_DIR = ROOT / "data" / "output" / "levels_final"
OUTPUT_DIR = ROOT / "data" / "output" / "levels_curated"
VOCAB_FILE = ROOT / "data" / "intermediate" / "merged_vocab.csv"
MANIFEST_FILE = OUTPUT_DIR / "curation_manifest.json"

LEVEL_FILES = {
    1: "ogte_01_alphabet.csv",
    2: "ogte_02_early_beginner.csv",
    3: "ogte_03_mid_beginner.csv",
    4: "ogte_04_high_beginner.csv",
    5: "ogte_05_early_elementary.csv",
    6: "ogte_06_mid_elementary.csv",
    7: "ogte_07_high_elementary.csv",
    8: "ogte_08_early_intermediate.csv",
    9: "ogte_09_mid_intermediate.csv",
    10: "ogte_10_high_intermediate.csv",
    11: "ogte_11_early_upper_intermediate.csv",
    12: "ogte_12_mid_upper_intermediate.csv",
    13: "ogte_13_high_upper_intermediate.csv",
    14: "ogte_14_early_advanced.csv",
    15: "ogte_15_mid_advanced.csv",
    16: "ogte_16_high_advanced.csv",
    17: "ogte_17_early_near_native.csv",
    18: "ogte_18_mid_near_native.csv",
    19: "ogte_19_high_near_native.csv",
    20: "ogte_20_native.csv",
}

CSV_FIELDS = [
    "id", "text", "pedagogy", "max_wfs", "rarest_word",
    "word_count", "added_for", "register", "formality", "ogte_level",
]
CURATED_FIELDS = CSV_FIELDS + ["arc_id"]

REORDER_BUDGET = 300  # max |new_index - original_index|

STOPWORDS_FOR_REPETITION = {
    "the", "a", "an", "is", "are", "was", "were", "am", "be", "been", "being",
    "to", "of", "in", "on", "at",
    "and", "or", "but", "i", "you", "he", "she", "it", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
    "this", "that", "these", "those", "what", "who", "where", "when", "why", "how",
    "do", "does", "did", "have", "has", "had",
    "will", "would", "shall", "should", "can", "could", "may", "might", "must",
    "for", "with", "from", "by", "as",
    "no", "yes", "not", "so", "too", "very", "just", "all", "any", "some",
    # contractions of stopword pronouns / aux verbs
    "i'm", "i'd", "i've", "i'll",
    "you're", "you'd", "you've", "you'll",
    "he's", "he'd", "he'll",
    "she's", "she'd", "she'll",
    "it's", "it'd", "it'll",
    "we're", "we'd", "we've", "we'll",
    "they're", "they'd", "they've", "they'll",
    "that's", "that'd", "that'll",
    "what's", "where's", "how's", "who's", "there's", "here's", "one's",
    "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
    "haven't", "hasn't", "hadn't", "won't", "wouldn't", "shouldn't", "can't",
    "how'd", "what're",
}


def tokenize(text: str) -> list[str]:
    """Lowercase word tokens, keeping internal apostrophes."""
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())


def content_tokens(text: str) -> list[str]:
    """Tokens minus stopwords — used for the adjacent-word-repetition check."""
    return [t for t in tokenize(text) if t not in STOPWORDS_FOR_REPETITION]


def load_vocab(path: Path = VOCAB_FILE) -> dict[str, int]:
    """Return {word: rank} from the merged vocab CSV."""
    vocab: dict[str, int] = {}
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            vocab[row["word"].strip().lower()] = int(row["rank"])
    return vocab


def compute_metadata(text: str, vocab: dict[str, int]) -> tuple[int, str, int]:
    """Return (word_count, rarest_word, max_wfs) for a new sentence."""
    tokens = tokenize(text)
    word_count = len(tokens)
    rarest_word = ""
    max_wfs = 0
    for t in tokens:
        rank = vocab.get(t)
        if rank is not None and rank > max_wfs:
            max_wfs = rank
            rarest_word = t
    return word_count, rarest_word, max_wfs


@dataclass
class Row:
    """One row of either an original CSV or a curated CSV."""

    id: str
    text: str
    pedagogy: str
    max_wfs: str
    rarest_word: str
    word_count: str
    added_for: str
    ogte_level: str
    register: str = "direct-address"  # default for new/added rows
    formality: str = ""  # default for new/added rows
    arc_id: int = 0
    original_index: int | None = None  # 0-based position in original CSV; None for added

    @classmethod
    def from_csv(cls, raw: dict[str, str], original_index: int) -> "Row":
        return cls(
            id=raw["id"],
            text=raw["text"],
            pedagogy=raw.get("pedagogy", ""),
            max_wfs=raw.get("max_wfs", ""),
            rarest_word=raw.get("rarest_word", ""),
            word_count=raw.get("word_count", ""),
            added_for=raw.get("added_for", ""),
            register=raw.get("register", "direct-address"),
            formality=raw.get("formality", ""),
            ogte_level=raw.get("ogte_level", ""),
            original_index=original_index,
        )

    @classmethod
    def new_added(
        cls,
        level: int,
        added_id: str,
        text: str,
        added_for: str,
        vocab: dict[str, int],
        register: str = "direct-address",
        formality: str = "",
    ) -> "Row":
        wc, rw, mw = compute_metadata(text, vocab)
        return cls(
            id=added_id,
            text=text,
            pedagogy="",
            max_wfs=str(mw),
            rarest_word=rw,
            word_count=str(wc),
            added_for=added_for,
            register=register,
            formality=formality,
            ogte_level=f"{level:02d}",
            original_index=None,
        )

    def as_csv_dict(self) -> dict[str, str]:
        return {
            "id": self.id,
            "text": self.text,
            "pedagogy": self.pedagogy,
            "max_wfs": self.max_wfs,
            "rarest_word": self.rarest_word,
            "word_count": self.word_count,
            "added_for": self.added_for,
            "register": self.register,
            "ogte_level": self.ogte_level,
            "arc_id": str(self.arc_id),
        }


def read_original_level(level: int) -> list[Row]:
    """Read original CSV for the given level."""
    path = INPUT_DIR / LEVEL_FILES[level]
    rows: list[Row] = []
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        for idx, raw in enumerate(reader):
            rows.append(Row.from_csv(raw, original_index=idx))
    return rows


def read_curated_level(level: int) -> list[Row]:
    """Read curated CSV (must include arc_id) for the given level."""
    path = OUTPUT_DIR / LEVEL_FILES[level]
    rows: list[Row] = []
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            row = Row(
                id=raw["id"],
                text=raw["text"],
                pedagogy=raw.get("pedagogy", ""),
                max_wfs=raw.get("max_wfs", ""),
                rarest_word=raw.get("rarest_word", ""),
                word_count=raw.get("word_count", ""),
                added_for=raw.get("added_for", ""),
                register=raw.get("register", "direct-address"),
                ogte_level=raw.get("ogte_level", ""),
                arc_id=int(raw.get("arc_id", "0") or 0),
            )
            rows.append(row)
    # Backfill original_index by id from the originals file
    originals = {r.id: r.original_index for r in read_original_level(level)}
    for row in rows:
        row.original_index = originals.get(row.id)
    return rows


def write_curated_level(level: int, rows: list[Row]) -> Path:
    """Write the curated CSV for a level."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / LEVEL_FILES[level]
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CURATED_FIELDS)
        writer.writeheader()
        for r in rows:
            writer.writerow(r.as_csv_dict())
    return path


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


# ---------- validation ----------


@dataclass
class CheckResult:
    name: str
    passed: bool
    details: list[str] = field(default_factory=list)


def check_vocab_monotonicity(
    original: list[Row], curated: list[Row]
) -> CheckResult:
    """Every word in the original must appear somewhere in the curated set."""
    orig_words: set[str] = set()
    for r in original:
        orig_words.update(tokenize(r.text))
    cur_words: set[str] = set()
    for r in curated:
        cur_words.update(tokenize(r.text))
    missing = sorted(orig_words - cur_words)
    return CheckResult(
        name="vocab_monotonicity",
        passed=len(missing) == 0,
        details=[f"{len(missing)} missing word(s): {missing[:20]}"] if missing else [],
    )


def check_reorder_budget(curated: list[Row], budget: int = REORDER_BUDGET) -> CheckResult:
    """No kept/moved row may travel more than `budget` positions from its original index."""
    offenders: list[str] = []
    for new_idx, r in enumerate(curated):
        if r.original_index is None:
            continue
        if abs(new_idx - r.original_index) > budget:
            offenders.append(
                f"{r.id} ('{r.text[:40]}') moved {r.original_index} → {new_idx} (Δ={new_idx - r.original_index})"
            )
    return CheckResult(
        name="reorder_budget",
        passed=len(offenders) == 0,
        details=offenders,
    )


def check_adjacent_repetition(curated: list[Row], window: int = 4) -> CheckResult:
    """No content word may appear in `window` consecutive curated rows (default 4 = max 3 in a row OK)."""
    offenders: list[str] = []
    token_sets = [set(content_tokens(r.text)) for r in curated]
    for i in range(window - 1, len(token_sets)):
        shared = set.intersection(*(token_sets[i - k] for k in range(window)))
        if shared:
            offenders.append(
                f"row {i} ('{curated[i].text[:40]}') repeats {sorted(shared)} across {window} consecutive rows"
            )
    return CheckResult(
        name="adjacent_repetition",
        passed=len(offenders) == 0,
        details=offenders[:50],
    )


def run_all_checks(level: int) -> list[CheckResult]:
    original = read_original_level(level)
    curated = read_curated_level(level)
    return [
        check_vocab_monotonicity(original, curated),
        check_reorder_budget(curated),
        check_adjacent_repetition(curated),
    ]
