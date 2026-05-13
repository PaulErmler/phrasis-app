#!/usr/bin/env python3
"""
Run the deterministic, free OGTE pipeline steps in order (1–7 + 6b).

This produces:
  - data/output/levels/                     — frequency-ordered curated CSVs
  - data/output/levels_original_order/      — full filtered pool, sentence-id order
  - data/output/stats/                      — overview, vocab growth, missing words
  - data/output/ogte_cefr_mapping.csv

Steps 8 (LLM pedagogy scoring) and 10/11 (pedagogy-ordered + final assembly) are
PAID and run manually — see README. The agent-driven review step
(levels_pedagogy_ordered_reviewed/) is also manual.

Each script is self-contained and idempotent. Re-run individual stages
directly when iterating.
"""

import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
STEPS = [
    "1_build_vocab.py",
    "2_download_lists_export.py",
    "3_extract_ogte_sentences.py",
    "4_filter_sentences.py",
    "5_score_and_export.py",
    "6_build_stats.py",
    "6b_extra_stats.py",
    "7_export_original_order.py",
]


def main() -> int:
    python = sys.executable
    for step in STEPS:
        script = SCRIPTS_DIR / step
        print(f"\n========== {step} ==========")
        result = subprocess.run([python, str(script)], check=False)
        if result.returncode != 0:
            print(f"\n!! step {step} failed with exit code {result.returncode}", file=sys.stderr)
            return result.returncode
    print("\nAll deterministic steps completed.")
    print("Next (manual, paid):  8_pedagogy_score.py  →  10_reorder_curated_by_pedagogy.py  →  agent reviews  →  11_build_final_dataset.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
