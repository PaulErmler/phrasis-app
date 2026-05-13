#!/usr/bin/env python3
"""
Cross-level exact-text dedup pass.

Walks each level CSV in `--folder` in OGTE order (01 → 99). Within each
level, the first occurrence of a given text wins; in later levels, any
sentence whose `text` exactly matches a sentence already kept in an
earlier level is dropped.

Same-level duplicates are also collapsed (keep first occurrence).

Use this AFTER curation passes that may add new sentences (agents writing
synthetic `x4_xx`-style IDs, manual edits, etc.) so the canonical
appearance of each sentence is in the earliest level that contains it.

Matching is on the raw `text` column, byte-for-byte. (Step 4's
`normalise_for_dedup` collapses trailing `.!?` and case at the filter
stage; this script is the post-curation safety net for anything added
later.)

Removed rows are logged to `<folder>/_dedup_removed.csv` with their
original level and the (level, id) they collided with.
"""

import argparse
import csv
import sys
from pathlib import Path

OGTE_ROOT = Path(__file__).resolve().parents[1]


def level_of(csv_path: Path) -> str:
    # ogte_NN_label.csv
    return csv_path.stem.split("_", 2)[1]


def level_sort_key(csv_path: Path) -> tuple[int, str]:
    lvl = level_of(csv_path)
    # Pad non-numeric (e.g. "99") naturally; "99" already sorts after 01-20.
    return (int(lvl) if lvl.isdigit() else 999, lvl)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--folder", default="levels_curated",
                   help="Folder under data/output/ to dedup in place (default: levels_curated).")
    p.add_argument("--dry-run", action="store_true",
                   help="Report what would be removed without rewriting the files.")
    args = p.parse_args()

    folder = OGTE_ROOT / "data" / "output" / args.folder
    if not folder.exists():
        print(f"  ! folder not found: {folder}")
        return 1

    csv_paths = sorted(folder.glob("ogte_*.csv"), key=level_sort_key)
    print(f"  scanning {len(csv_paths)} files in {folder.relative_to(OGTE_ROOT)}/")

    # text -> (kept_level, kept_id) of first occurrence
    first_seen: dict[str, tuple[str, str]] = {}
    removed_log: list[tuple[str, str, str, str, str]] = []  # (level, id, text, kept_level, kept_id)
    total_in = 0
    total_kept = 0

    # Pass 1: walk in level order, decide which rows to keep
    keep_decisions: dict[Path, list[bool]] = {}
    for csv_path in csv_paths:
        lvl = level_of(csv_path)
        with csv_path.open(encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        decisions = []
        for r in rows:
            total_in += 1
            text = r["text"]
            existing = first_seen.get(text)
            if existing is None:
                first_seen[text] = (lvl, r["id"])
                decisions.append(True)
                total_kept += 1
            else:
                decisions.append(False)
                removed_log.append((lvl, r["id"], text, existing[0], existing[1]))
        keep_decisions[csv_path] = decisions

    removed = total_in - total_kept
    print(f"  total rows in : {total_in:,}")
    print(f"  total kept    : {total_kept:,}")
    print(f"  removed dupes : {removed:,}")
    if removed:
        cross = sum(1 for l, _, _, kl, _ in removed_log if l != kl)
        same = removed - cross
        print(f"    cross-level : {cross:,}")
        print(f"    same-level  : {same:,}")

    if args.dry_run:
        print("  dry-run: no files written")
        return 0

    # Pass 2: rewrite each file with kept rows
    for csv_path in csv_paths:
        decisions = keep_decisions[csv_path]
        with csv_path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            rows = list(reader)
        kept = [r for r, k in zip(rows, decisions) if k]
        n_dropped = len(rows) - len(kept)
        if n_dropped == 0:
            continue
        with csv_path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(kept)
        print(f"  {csv_path.name}: kept {len(kept):,}/{len(rows):,} (-{n_dropped})")

    # Removed log
    if removed_log:
        log = folder / "_dedup_removed.csv"
        with log.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["removed_level", "removed_id", "text", "kept_level", "kept_id"])
            for row in removed_log:
                w.writerow(row)
        print(f"  log: {log.relative_to(OGTE_ROOT)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
