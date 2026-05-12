#!/usr/bin/env python3
"""
Write per-level CSVs preserving the order sentences appear in Tatoeba's
sentences_in_lists.csv bulk export.

That export sorts (list_id, sentence_id) ascending — i.e. the "Sentence ID
Numbers" ordering linked from the OGTE page (https://www.manythings.org/tatoeba/ogte.html).
This is NOT the same as "Order Added" (chronological list-membership), which
would require scraping per-list pages — explicitly out of scope per the
user's instruction.

Output: data/output/levels_original_order/ogte_NN_label.csv

Same columns as data/output/levels/, no 3-per-bucket cap. Score columns are
included so the file is still useful for review without re-tokenising.
"""

import csv
import re
import sys
from pathlib import Path

OGTE_ROOT = Path(__file__).resolve().parents[1]
LISTS_EXPORT = OGTE_ROOT / "data" / "raw" / "sentences_in_lists.csv"
FILTERED = OGTE_ROOT / "data" / "intermediate" / "ogte_sentences_filtered.csv"
VOCAB = OGTE_ROOT / "data" / "intermediate" / "merged_vocab.csv"
OUT_DIR = OGTE_ROOT / "data" / "output" / "levels_original_order"

# Mirror the mapping in 3_extract_ogte_sentences.py + 5_score_and_export.py.
LIST_TO_OGTE: dict[int, str] = {
    7407: "01", 7408: "02", 7409: "03", 7410: "04", 7411: "05",
    7412: "06", 7413: "07", 7414: "08", 7415: "09", 7416: "10",
    7417: "11", 7418: "12", 7419: "13", 7426: "14", 7420: "15",
    7421: "16", 7422: "17", 7423: "18", 7424: "19", 7425: "20",
    7427: "99",
}
LABEL_SLUG = {
    "01": "alphabet", "02": "early_beginner", "03": "mid_beginner", "04": "high_beginner",
    "05": "early_elementary", "06": "mid_elementary", "07": "high_elementary",
    "08": "early_intermediate", "09": "mid_intermediate", "10": "high_intermediate",
    "11": "early_upper_intermediate", "12": "mid_upper_intermediate", "13": "high_upper_intermediate",
    "14": "early_advanced", "15": "mid_advanced", "16": "high_advanced",
    "17": "early_near_native", "18": "mid_near_native", "19": "high_near_native",
    "20": "native", "99": "unlisted",
}

TOKEN_RE = re.compile(r"[a-zA-Z']+")


def load_vocab(path: Path) -> dict[str, int]:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run 1_build_vocab.py first.")
    vocab: dict[str, int] = {}
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            vocab[row["word"]] = int(row["rank"])
    return vocab


def score(text: str, vocab: dict[str, int], penalty: int) -> tuple[int, str, int]:
    tokens = [m.group(0).lower() for m in TOKEN_RE.finditer(text)]
    if not tokens:
        return penalty, "", 0
    ranks = [vocab.get(t, penalty) for t in tokens]
    i = max(range(len(ranks)), key=lambda j: ranks[j])
    return ranks[i], tokens[i], len(tokens)


def main() -> int:
    for required in (LISTS_EXPORT, FILTERED, VOCAB):
        if not required.exists():
            raise FileNotFoundError(f"{required} not found.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    vocab = load_vocab(VOCAB)
    penalty = len(vocab) + 1

    print(f"[1/3] Loading filtered sentence texts ({FILTERED.name}) ...")
    text_by_id: dict[str, str] = {}
    with FILTERED.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            text_by_id[row["id"]] = row["text"]
    print(f"  {len(text_by_id):,} filtered sentences available")

    print(f"[2/3] Reading {LISTS_EXPORT.name} in export order ...")
    # Step 3 assigns each sentence_id its lowest OGTE level when it appears in
    # multiple OGTE lists. Mirror that here so the original-order folder agrees
    # with levels/ on level membership.
    canonical_level: dict[str, str] = {}
    raw_pairs: list[tuple[str, str]] = []  # (level, sid) in export order
    with LISTS_EXPORT.open(encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t"):
            if len(row) < 2:
                continue
            try:
                list_id = int(row[0])
            except ValueError:
                continue
            level = LIST_TO_OGTE.get(list_id)
            if level is None:
                continue
            sid = row[1]
            existing = canonical_level.get(sid)
            if existing is None or level < existing:
                canonical_level[sid] = level
            raw_pairs.append((level, sid))

    ordered_ids: dict[str, list[str]] = {ogte: [] for ogte in LIST_TO_OGTE.values()}
    written: set[str] = set()
    for level, sid in raw_pairs:
        if canonical_level[sid] != level:
            continue
        if sid in written:
            continue
        written.add(sid)
        ordered_ids[level].append(sid)

    print(f"[3/3] Writing per-level CSVs in original (Sentence ID) order ...")
    grand_total = 0
    for ogte, ids in ordered_ids.items():
        slug = LABEL_SLUG[ogte]
        out = OUT_DIR / f"ogte_{ogte}_{slug}.csv"
        kept = 0
        with out.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["id", "text", "max_wfs", "rarest_word", "word_count"])
            for sid in ids:
                text = text_by_id.get(sid)
                if text is None:
                    continue  # filtered out earlier (length/banned/Tom/profanity) or absent from english_sentences.csv
                mw, rarest, wc = score(text, vocab, penalty)
                w.writerow([sid, text, mw, rarest, wc])
                kept += 1
        grand_total += kept
        print(f"  {ogte}: {len(ids):>7,} ids -> {kept:>6,} kept  ({out.name})")

    print()
    print(f"  total sentences written: {grand_total:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
