#!/usr/bin/env python3
"""
Reorder a CURATED level set by pedagogy score WITHOUT re-curating.

Reads curated levels/ogte_NN_*.csv (already cap-pruned-augmented) and joins with
data/intermediate/pedagogy_scores.csv. Writes to levels_pedagogy_ordered/ sorted
by pedagogy DESC, then max_wfs ASC, then word_count ASC, then id ASC.

Unlike 9_export_pedagogy_ordered.py, this script does NO cap, augmentation, or
pruning — the input is treated as the final selection. Use this when you want
the user-facing pedagogical ordering on top of an already-curated dataset.

Levels missing scores for any sentence are skipped with a warning.
"""

import argparse
import csv
import sys
from pathlib import Path

OGTE_ROOT = Path(__file__).resolve().parents[1]
SCORES = OGTE_ROOT / "data" / "intermediate" / "pedagogy_scores.csv"

DEFAULT_IN = "levels"
DEFAULT_OUT = "levels_pedagogy_ordered"


def load_scores(path: Path) -> dict[str, float]:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run 8_pedagogy_score.py first.")
    out: dict[str, float] = {}
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["id"]] = float(r["score"])
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--levels", default=None,
                   help="Comma-separated OGTE levels to process (e.g. '01,02,...,08'). "
                        "Default: every level in --in-dir.")
    p.add_argument("--in-dir", default=DEFAULT_IN,
                   help=f"Curated input folder under data/output/ (default: {DEFAULT_IN}).")
    p.add_argument("--out-dir", default=DEFAULT_OUT,
                   help=f"Output folder under data/output/ (default: {DEFAULT_OUT}).")
    args = p.parse_args()

    in_dir = OGTE_ROOT / "data" / "output" / args.in_dir
    out_dir = OGTE_ROOT / "data" / "output" / args.out_dir
    if not in_dir.exists():
        raise FileNotFoundError(f"{in_dir} not found.")
    out_dir.mkdir(parents=True, exist_ok=True)

    wanted: set[str] | None = None
    if args.levels:
        wanted = {lv.strip() for lv in args.levels.split(",") if lv.strip()}

    scores = load_scores(SCORES)
    print(f"  pedagogy scores loaded: {len(scores):,}")
    print(f"  reading from: {in_dir.relative_to(OGTE_ROOT)}")
    print(f"  writing to:   {out_dir.relative_to(OGTE_ROOT)}")

    written = 0
    for src in sorted(in_dir.glob("ogte_*.csv")):
        # Filename pattern: ogte_NN_label.csv
        parts = src.stem.split("_", 2)  # ['ogte', 'NN', 'label']
        if len(parts) < 3:
            continue
        level = parts[1]
        if wanted is not None and level not in wanted:
            continue

        with src.open(encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        if not rows:
            print(f"  {level}: empty input, skipping")
            continue

        missing = [r["id"] for r in rows if r["id"] not in scores]
        if missing:
            print(f"  {level}: SKIP — {len(missing):,}/{len(rows):,} sentences have no pedagogy score "
                  f"(first missing id: {missing[0]})")
            continue

        for r in rows:
            r["pedagogy"] = f"{scores[r['id']]:.2f}"
        # Sort: pedagogy DESC, max_wfs ASC, word_count ASC, id ASC.
        rows.sort(key=lambda r: (-float(r["pedagogy"]), int(r["max_wfs"]), int(r["word_count"]), int(r["id"])))

        out = out_dir / src.name
        with out.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["id", "text", "pedagogy", "max_wfs", "rarest_word", "word_count", "added_for"])
            for r in rows:
                w.writerow([r["id"], r["text"], r["pedagogy"], r["max_wfs"],
                            r["rarest_word"], r["word_count"], r.get("added_for", "")])
        print(f"  {level}: wrote {len(rows):,} rows -> {out.name}")
        written += 1

    print()
    print(f"  total levels written: {written}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
