#!/usr/bin/env python3
"""
Inner-join sentences_in_lists.csv with english_sentences.csv to produce a single
table of OGTE-graded English sentences (id, ogte_level, text).
"""

import csv
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_PREP = REPO_ROOT / "data_preparation"
OGTE_ROOT = DATA_PREP / "ogte-dataset"
ENGLISH_SENTENCES = DATA_PREP / "data" / "intermediate_outputs" / "english_sentences.csv"
LISTS_EXPORT = OGTE_ROOT / "data" / "raw" / "sentences_in_lists.csv"
OUT = OGTE_ROOT / "data" / "intermediate" / "ogte_sentences_raw.csv"

# OGTE list_id -> (ogte_level, label) per https://www.manythings.org/tatoeba/ogte.html
LIST_TO_OGTE: dict[int, tuple[str, str]] = {
    7407: ("01", "alphabet"),
    7408: ("02", "early_beginner"),
    7409: ("03", "mid_beginner"),
    7410: ("04", "high_beginner"),
    7411: ("05", "early_elementary"),
    7412: ("06", "mid_elementary"),
    7413: ("07", "high_elementary"),
    7414: ("08", "early_intermediate"),
    7415: ("09", "mid_intermediate"),
    7416: ("10", "high_intermediate"),
    7417: ("11", "early_upper_intermediate"),
    7418: ("12", "mid_upper_intermediate"),
    7419: ("13", "high_upper_intermediate"),
    7426: ("14", "early_advanced"),
    7420: ("15", "mid_advanced"),
    7421: ("16", "high_advanced"),
    7422: ("17", "early_near_native"),
    7423: ("18", "mid_near_native"),
    7424: ("19", "high_near_native"),
    7425: ("20", "native"),
    7427: ("99", "unlisted"),
}


def load_id_to_level(lists_export: Path) -> dict[str, str]:
    if not lists_export.exists():
        raise FileNotFoundError(
            f"{lists_export} not found. Run 2_download_lists_export.py first."
        )
    id_to_level: dict[str, str] = {}
    collisions = 0
    with lists_export.open(encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="\t")
        for row in reader:
            if len(row) < 2:
                continue
            try:
                list_id = int(row[0])
            except ValueError:
                continue
            mapping = LIST_TO_OGTE.get(list_id)
            if mapping is None:
                continue
            level = mapping[0]
            sid = row[1]
            existing = id_to_level.get(sid)
            if existing is not None and existing != level:
                collisions += 1
                # Lowest OGTE level wins (more constrained vocab is the safer label).
                id_to_level[sid] = min(existing, level)
            else:
                id_to_level[sid] = level
    if collisions:
        print(f"  warning: {collisions:,} sentence ids appeared in multiple OGTE lists; kept lowest level")
    return id_to_level


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if not ENGLISH_SENTENCES.exists():
        raise FileNotFoundError(f"{ENGLISH_SENTENCES} not found.")

    print(f"[1/2] Loading list memberships from {LISTS_EXPORT} ...")
    id_to_level = load_id_to_level(LISTS_EXPORT)
    print(f"  {len(id_to_level):,} sentence ids across {len(LIST_TO_OGTE)} OGTE lists")

    print(f"[2/2] Joining with {ENGLISH_SENTENCES} -> {OUT} ...")
    written = 0
    per_level: Counter[str] = Counter()
    with ENGLISH_SENTENCES.open(encoding="utf-8") as fin, OUT.open("w", encoding="utf-8", newline="") as fout:
        reader = csv.DictReader(fin, delimiter="\t")
        writer = csv.writer(fout, delimiter="\t")
        writer.writerow(["id", "ogte_level", "text"])
        for row in reader:
            level = id_to_level.get(row["id"])
            if level is None:
                continue
            writer.writerow([row["id"], level, row["text"]])
            written += 1
            per_level[level] += 1

    matched_ids = {row_id for row_id in id_to_level}
    written_ids_estimate = written
    missing = len(matched_ids) - written_ids_estimate
    print(f"  joined: {written:,} sentences")
    print(f"  missing from english_sentences.csv: {missing:,}")
    print()
    print("  per-level counts:")
    for level in sorted(per_level):
        label = next((lab for lid, (lvl, lab) in LIST_TO_OGTE.items() if lvl == level), "?")
        print(f"    {level} {label:30s} {per_level[level]:>8,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
