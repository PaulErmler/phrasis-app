#!/usr/bin/env python3
"""
Assemble the final per-level dataset from the right source for each level.

Source priority for each OGTE level NN:
  1. data/output/levels_pedagogy_ordered_reviewed/ogte_NN_*.csv  (preferred)
  2. data/output/levels_pedagogy_ordered/ogte_NN_*.csv           (pedagogy-ordered, unreviewed)
  3. data/output/levels/ogte_NN_*.csv                          (frequency-ordered, the
                                                               curated baseline)

L20 (Native) and L99 (Unlisted) are merged into a single output:
  data/output/levels_final/ogte_20_native.csv

The output column set is normalised so all files share the same header. If a
source has a `pedagogy` column it is preserved; otherwise that column is empty.

The final folder is `levels_final/` by default.
"""

import argparse
import csv
import re
import sys
from pathlib import Path

OGTE_ROOT = Path(__file__).resolve().parents[1]
LEVELS = OGTE_ROOT / "data" / "output" / "levels"
PEDAGOGY = OGTE_ROOT / "data" / "output" / "levels_pedagogy_ordered"
REVIEWED = OGTE_ROOT / "data" / "output" / "levels_pedagogy_ordered_reviewed"
VOCAB = OGTE_ROOT / "data" / "intermediate" / "merged_vocab.csv"
REGISTER_CLASSIFICATIONS = OGTE_ROOT / "data" / "intermediate" / "register_classifications.csv"

TOKEN_RE = re.compile(r"[a-zA-Z']+")

# Levels in canonical order. L20 + L99 are merged, output filename is for L20.
LEVELS_ORDER = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
                "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "99"]

LABEL_SLUG = {
    "01": "alphabet", "02": "early_beginner", "03": "mid_beginner", "04": "high_beginner",
    "05": "early_elementary", "06": "mid_elementary", "07": "high_elementary",
    "08": "early_intermediate", "09": "mid_intermediate", "10": "high_intermediate",
    "11": "early_upper_intermediate", "12": "mid_upper_intermediate", "13": "high_upper_intermediate",
    "14": "early_advanced", "15": "mid_advanced", "16": "high_advanced",
    "17": "early_near_native", "18": "mid_near_native", "19": "high_near_native",
    "20": "native", "99": "unlisted",
}

OUT_COLS = ["id", "text", "pedagogy", "max_wfs", "rarest_word", "word_count", "added_for", "register", "formality", "ogte_level"]


def find_source(level: str) -> Path | None:
    """Pick the best available source for a level (reviewed > pedagogy-ordered > frequency-curated)."""
    for folder in (REVIEWED, PEDAGOGY, LEVELS):
        slug = LABEL_SLUG.get(level)
        if slug is None:
            continue
        candidate = folder / f"ogte_{level}_{slug}.csv"
        if candidate.exists():
            return candidate
    return None


def normalise_row(row: dict, level: str) -> dict:
    """Map any of the three input schemas into OUT_COLS, defaulting empty strings."""
    return {
        "id": row.get("id", ""),
        "text": row.get("text", ""),
        "pedagogy": row.get("pedagogy", ""),
        "max_wfs": row.get("max_wfs", ""),
        "rarest_word": row.get("rarest_word", ""),
        "word_count": row.get("word_count", ""),
        "added_for": row.get("added_for", ""),
        "register": row.get("register", ""),
        "formality": row.get("formality", ""),
        "ogte_level": level,
    }


def load_register_classifications(path: Path) -> dict[str, tuple[str, str]]:
    """Return id -> (register, formality). Empty dict if file missing.
    Handles older schemas (no formality column) by leaving formality blank."""
    if not path.exists():
        return {}
    out: dict[str, tuple[str, str]] = {}
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["id"]] = (r.get("register", ""), r.get("formality", ""))
    return out


def read_csv_normalised(path: Path, level: str) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [normalise_row(r, level) for r in csv.DictReader(f)]


_REVIEW_ID_RE = re.compile(r"^-\s+(\d+)[,\s]")


def read_reviewer_removed_ids(review_path: Path) -> set[str]:
    """Parse a reviewer's '*.review.md' file and extract the IDs the reviewer
    explicitly removed (sexist + near-duplicate). Lines look like:
        - 2221008, "Be a man.", invokes gender stereotype ...
        - 1256839, "Do whatever you like." -> kept 70894, ...
    Anything matching `- <digits>[,\\s]` at the start of a line is treated as
    a removal id. Robust to small format variations."""
    if not review_path.exists():
        return set()
    removed: set[str] = set()
    in_removal_section = False
    for line in review_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            in_removal_section = "removal" in stripped.lower()
            continue
        if in_removal_section:
            m = _REVIEW_ID_RE.match(stripped)
            if m:
                removed.add(m.group(1))
    return removed


def _load_added_for_map(path: Path) -> dict[str, str]:
    """Return id -> added_for from a CSV. Empty dict if the file is missing or
    has no added_for column."""
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if "added_for" in r and r.get("added_for"):
                out[r["id"]] = r["added_for"]
    return out


def read_level(level: str) -> tuple[Path | None, list[dict]]:
    """Return (preferred_source, rows from that source).

    If the preferred source is the REVIEWED folder, also:
      (a) backfill any empty `added_for` from the corresponding `levels/` file
          (older reviewed CSVs were written before that column existed), and
      (b) merge in any rows from the PEDAGOGY folder that aren't in the
          reviewed file AND aren't in the reviewer's explicit removal list
          (parsed from the matching `.review.md`).
    Reviewers' work is preserved exactly; only genuinely-new additions are
    tacked on at the end.
    """
    src = find_source(level)
    if src is None:
        return None, []
    rows = read_csv_normalised(src, level)

    if src.parent == REVIEWED:
        slug = LABEL_SLUG.get(level)
        levels_path = LEVELS / f"ogte_{level}_{slug}.csv" if slug else None
        pedagogy_path = PEDAGOGY / f"ogte_{level}_{slug}.csv" if slug else None
        review_md = src.with_suffix(".review.md")

        # (a) Backfill added_for from the corresponding levels/ row map.
        if levels_path:
            added_map = _load_added_for_map(levels_path)
            for r in rows:
                if not r.get("added_for") and r["id"] in added_map:
                    r["added_for"] = added_map[r["id"]]

        # (b) Merge in new sentences from pedagogy_ordered that the reviewer
        # never saw, skipping anything the reviewer explicitly removed.
        reviewer_removed = read_reviewer_removed_ids(review_md)
        if pedagogy_path and pedagogy_path.exists():
            seen_ids = {r["id"] for r in rows}
            extra = [r for r in read_csv_normalised(pedagogy_path, level)
                     if r["id"] not in seen_ids and r["id"] not in reviewer_removed]
            rows.extend(extra)
    return src, rows


def load_vocab(path: Path) -> set[str]:
    if not path.exists():
        return set()
    out: set[str] = set()
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.add(r["word"])
    return out


def in_vocab_tokens(text: str, vocab: set[str]) -> set[str]:
    return {t for t in (m.group(0).lower() for m in TOKEN_RE.finditer(text)) if t in vocab}


def cross_level_prune(rows: list[dict], seen_earlier: set[str], vocab: set[str]) -> tuple[list[dict], int]:
    """Drop sentences whose every in-vocab token is already in seen_earlier
    (vocabulary from PRIOR levels). All sentences in this level are evaluated
    against the SAME snapshot of seen_earlier — within-level reuse is fine.
    Sentences with no in-vocab tokens at all are also dropped.

    `seen_earlier` is mutated after the level is fully processed so the next
    level sees this level's vocabulary as already-learned.

    Returns (kept_rows, dropped_count)."""
    kept: list[dict] = []
    dropped = 0
    new_added: set[str] = set()
    for r in rows:
        v = in_vocab_tokens(r["text"], vocab)
        if not v or v <= seen_earlier:
            dropped += 1
            continue
        kept.append(r)
        new_added |= v
    seen_earlier |= new_added
    return kept, dropped


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--out-dir", default="levels_final")
    p.add_argument("--drop-no-new-vocab", action="store_true",
                   help="Drop sentences whose in-vocab tokens are fully covered by earlier "
                        "levels' vocabulary. Pedagogically targeted at upper levels with "
                        "high cross-level redundancy. Off by default.")
    args = p.parse_args()

    out_dir = OGTE_ROOT / "data" / "output" / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    vocab = load_vocab(VOCAB)
    if args.drop_no_new_vocab and not vocab:
        print("  warning: --drop-no-new-vocab set but merged_vocab.csv missing; skipping prune")
        args.drop_no_new_vocab = False

    # Register column is intentionally NOT populated here. Run
    # 12_classify_register.py after this step to classify + apply registers.
    # We still preload classifications (if present) as a convenience for rebuilds:
    # if a row was already classified, populate its register; otherwise leave
    # the column empty until step 12 runs.
    register_map = load_register_classifications(REGISTER_CLASSIFICATIONS)
    if register_map:
        print(f"  register classifications loaded: {len(register_map):,} (column will be pre-populated; step 12 is canonical)")

    sources_used: dict[str, str] = {}
    grand_total = 0
    grand_pruned = 0
    seen_earlier: set[str] = set()  # in-vocab tokens accumulated across earlier levels

    # Standard levels 01-19
    for level in LEVELS_ORDER:
        if level in ("20", "99"):
            continue
        src, rows = read_level(level)
        if src is None:
            print(f"  {level}: SKIP — no source found")
            continue
        original_count = len(rows)
        pruned = 0
        if args.drop_no_new_vocab:
            rows, pruned = cross_level_prune(rows, seen_earlier, vocab)
        # Final fallback: any row still missing added_for (e.g. reviewed rows
        # that no longer exist in levels/) gets its full in-vocab token set.
        if vocab:
            for r in rows:
                if not r.get("added_for"):
                    toks = sorted(in_vocab_tokens(r["text"], vocab))
                    if toks:
                        r["added_for"] = "|".join(toks)
        # Attach register + formality classifications (if available).
        if register_map:
            for r in rows:
                entry = register_map.get(r["id"])
                if entry:
                    r["register"], r["formality"] = entry
        slug = LABEL_SLUG[level]
        out = out_dir / f"ogte_{level}_{slug}.csv"
        with out.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=OUT_COLS)
            w.writeheader()
            w.writerows(rows)
        rel = src.relative_to(OGTE_ROOT)
        sources_used[level] = str(rel)
        grand_total += len(rows)
        grand_pruned += pruned
        suffix_parts = []
        if pruned:
            suffix_parts.append(f"-{pruned} no-new-vocab")

        # Detect whether read_level merged in extras from PEDAGOGY (only when src is REVIEWED).
        if src.parent == REVIEWED:
            ped_path = PEDAGOGY / f"ogte_{level}_{slug}.csv"
            if ped_path.exists():
                with src.open() as f1:
                    reviewed_count = sum(1 for _ in csv.DictReader(f1))
                merged_extra = original_count - reviewed_count
                if merged_extra > 0:
                    suffix_parts.append(f"+{merged_extra} merged from pedagogy_ordered/")
        suffix = ("  (" + ", ".join(suffix_parts) + ")") if suffix_parts else ""
        print(f"  {level}: {len(rows):>5,}/{original_count:,} rows from {rel.parents[0].name}/{suffix}")

    # Merge L20 + L99 into a single 'native' file
    src20, rows20 = read_level("20")
    src99, rows99 = read_level("99")
    merged = rows20 + rows99
    merged_pre = len(merged)
    # Dedup by id (paranoia — should already be unique).
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in merged:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        deduped.append(r)
    if args.drop_no_new_vocab:
        deduped, native_pruned = cross_level_prune(deduped, seen_earlier, vocab)
        grand_pruned += native_pruned
    # Final fallback for the merged native file: backfill any empty added_for.
    if vocab:
        for r in deduped:
            if not r.get("added_for"):
                toks = sorted(in_vocab_tokens(r["text"], vocab))
                if toks:
                    r["added_for"] = "|".join(toks)
    if register_map:
        for r in deduped:
            entry = register_map.get(r["id"])
            if entry:
                r["register"], r["formality"] = entry
    # Sort: pedagogy DESC if present, else max_wfs ASC, then word_count ASC, id ASC.
    def sort_key(r):
        try:
            ped = -float(r["pedagogy"]) if r["pedagogy"] else 0.0
        except ValueError:
            ped = 0.0
        try:
            mw = int(r["max_wfs"]) if r["max_wfs"] else 0
        except ValueError:
            mw = 0
        try:
            wc = int(r["word_count"]) if r["word_count"] else 0
        except ValueError:
            wc = 0
        return (ped, mw, wc, int(r["id"]))
    deduped.sort(key=sort_key)
    out_native = out_dir / "ogte_20_native.csv"
    with out_native.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLS)
        w.writeheader()
        w.writerows(deduped)
    grand_total += len(deduped)
    if src20 and src99:
        print(f"  20: {len(deduped):>5,} rows merged from L20 ({src20.parents[0].name}/, {len(rows20)}) "
              f"+ L99 ({src99.parents[0].name}/, {len(rows99)})")
    elif src20:
        print(f"  20: {len(deduped):>5,} rows from L20 ({src20.parents[0].name}/, {len(rows20)}) "
              f"[L99 source missing]")
    elif src99:
        print(f"  20: {len(deduped):>5,} rows from L99 ({src99.parents[0].name}/, {len(rows99)}) "
              f"[L20 source missing]")
    else:
        print("  20: SKIP — neither L20 nor L99 source found")
    sources_used["20+99"] = "merged"

    # Manifest with provenance per level
    manifest = out_dir / "_sources.csv"
    with manifest.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ogte_level", "source"])
        for k in sorted(sources_used):
            w.writerow([k, sources_used[k]])

    print()
    print(f"  total rows in final dataset: {grand_total:,}")
    if args.drop_no_new_vocab:
        print(f"  cross-level pruned (no new in-vocab vs earlier levels): {grand_pruned:,}")
    print(f"  manifest: {manifest.relative_to(OGTE_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
