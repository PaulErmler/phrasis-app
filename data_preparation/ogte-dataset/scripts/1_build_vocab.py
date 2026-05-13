#!/usr/bin/env python3
"""
Build the merged top-20k word vocabulary used to score sentences.

Step 1 of the OGTE pipeline.
- Tokenises every English Tatoeba sentence with regex [a-zA-Z']+, lowercased.
- Counts word frequencies and takes the top 20k.
- Pulls wordfreq.top_n_list('en', 20000).
- Intersects, preserving wordfreq's order (cleaner reference corpus).
- Writes data/intermediate/merged_vocab.csv with columns rank,word.
"""

import csv
import re
import sys
from collections import Counter
from pathlib import Path

from wordfreq import top_n_list

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_PREP = REPO_ROOT / "data_preparation"
OGTE_ROOT = DATA_PREP / "ogte-dataset"
ENGLISH_SENTENCES = DATA_PREP / "data" / "intermediate_outputs" / "english_sentences.csv"
INTERMEDIATE = OGTE_ROOT / "data" / "intermediate"

TOKEN_RE = re.compile(r"[a-zA-Z']+")
TOP_N = 20_000


def tokenize(text: str) -> list[str]:
    return [m.group(0).lower() for m in TOKEN_RE.finditer(text)]


def build_tatoeba_top_n(input_file: Path, n: int) -> list[str]:
    if not input_file.exists():
        raise FileNotFoundError(
            f"{input_file} not found. Run data_filtering.utils.read_tatoeba_dataset first."
        )
    counter: Counter[str] = Counter()
    with input_file.open(encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for i, row in enumerate(reader, 1):
            counter.update(tokenize(row["text"]))
            if i % 250_000 == 0:
                print(f"  tokenised {i:,} sentences, vocab so far {len(counter):,}")
    print(f"  total sentences: {i:,}; total unique tokens: {len(counter):,}")
    return [w for w, _ in counter.most_common(n)]


def main() -> int:
    INTERMEDIATE.mkdir(parents=True, exist_ok=True)

    print(f"[1/3] Counting Tatoeba top-{TOP_N} words from {ENGLISH_SENTENCES} ...")
    tatoeba_top = build_tatoeba_top_n(ENGLISH_SENTENCES, TOP_N)
    (INTERMEDIATE / "tatoeba_top20k.txt").write_text("\n".join(tatoeba_top), encoding="utf-8")

    print(f"[2/3] Loading wordfreq top-{TOP_N} ...")
    wordfreq_top = top_n_list("en", TOP_N)
    (INTERMEDIATE / "wordfreq_top20k.txt").write_text("\n".join(wordfreq_top), encoding="utf-8")

    print("[3/3] Intersecting (wordfreq order) ...")
    tatoeba_set = set(tatoeba_top)
    merged = [w for w in wordfreq_top if w in tatoeba_set]
    out = INTERMEDIATE / "merged_vocab.csv"
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rank", "word"])
        for rank, word in enumerate(merged, 1):
            w.writerow([rank, word])

    print()
    print(f"  Tatoeba top-{TOP_N}:  {len(tatoeba_top):,}")
    print(f"  wordfreq top-{TOP_N}: {len(wordfreq_top):,}")
    print(f"  intersection:        {len(merged):,}")
    print(f"  written: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
