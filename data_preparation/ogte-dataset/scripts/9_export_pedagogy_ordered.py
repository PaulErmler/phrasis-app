#!/usr/bin/env python3
"""
Build per-level CSVs ordered by LLM-derived pedagogy score.

For each OGTE level that has 100% pedagogy coverage in
data/intermediate/pedagogy_scores.csv:

  1. Load all filtered sentences for the level (from
     ogte_sentences_filtered.csv) and compute max_wfs / rarest_word /
     word_count using the merged vocab (same logic as 5_score_and_export.py).
  2. Group by max_wfs. Within each bucket, sort by pedagogy DESC
     (tiebreak: word_count ASC, id ASC) and keep the top MAX_PER_BUCKET.
  3. Coverage augmentation: re-admit any dropped sentence that introduces
     an in-vocab word the level doesn't yet cover (mirrors step 5).
  4. Final per-level sort: pedagogy DESC, max_wfs ASC, word_count ASC, id ASC.
  5. Write to data/output/levels_pedagogy_ordered/ogte_NN_label.csv.

Levels with partial pedagogy coverage are skipped with a warning so the
folder always reflects fully-scored levels only.
"""

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

OGTE_ROOT = Path(__file__).resolve().parents[1]
SCORES = OGTE_ROOT / "data" / "intermediate" / "pedagogy_scores.csv"
FILTERED = OGTE_ROOT / "data" / "intermediate" / "ogte_sentences_filtered.csv"
VOCAB = OGTE_ROOT / "data" / "intermediate" / "merged_vocab.csv"
MAPPING_CSV = OGTE_ROOT / "data" / "output" / "ogte_cefr_mapping.csv"

TOKEN_RE = re.compile(r"[a-zA-Z']+")
DEFAULT_BUCKET_CAP = 2
DEFAULT_BUCKET_HARD_CAP = 3  # -1 = unlimited (legacy)
DEFAULT_NOVELTY_THRESHOLD = 2  # candidates adding >= this many NEW in-vocab words bypass the bucket cap
DEFAULT_MIN_WORD_OCCURRENCES = 2  # final pass: keep each in-vocab word in >= N kept sentences (0 = off)
DEFAULT_VOCAB_COMPLETION_RANK = 10_000  # candidates adding a new in-vocab word with rank <= this also bypass the bucket cap (0 = off)

LABEL_SLUG = {
    "01": "alphabet", "02": "early_beginner", "03": "mid_beginner", "04": "high_beginner",
    "05": "early_elementary", "06": "mid_elementary", "07": "high_elementary",
    "08": "early_intermediate", "09": "mid_intermediate", "10": "high_intermediate",
    "11": "early_upper_intermediate", "12": "mid_upper_intermediate", "13": "high_upper_intermediate",
    "14": "early_advanced", "15": "mid_advanced", "16": "high_advanced",
    "17": "early_near_native", "18": "mid_near_native", "19": "high_near_native",
    "20": "native", "99": "unlisted",
}


def load_vocab(path: Path) -> dict[str, int]:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run 1_build_vocab.py first.")
    out: dict[str, int] = {}
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["word"]] = int(r["rank"])
    return out


def load_scores(path: Path) -> dict[str, float]:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run 8_pedagogy_score.py --full first.")
    out: dict[str, float] = {}
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["id"]] = float(r["score"])
    return out


def load_label_for(level: str) -> str:
    if not MAPPING_CSV.exists():
        return ""
    with MAPPING_CSV.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["ogte_level"] == level:
                return r["label"]
    return ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket-cap", type=int, default=DEFAULT_BUCKET_CAP)
    parser.add_argument("--bucket-hard-cap", type=int, default=DEFAULT_BUCKET_HARD_CAP,
                        help="Max picks per bucket including augmentation. -1 = unlimited (legacy).")
    parser.add_argument("--augment-novelty-threshold", type=int, default=DEFAULT_NOVELTY_THRESHOLD,
                        help="Candidates contributing >= this many new in-vocab words bypass the bucket cap.")
    parser.add_argument("--min-word-occurrences", type=int, default=DEFAULT_MIN_WORD_OCCURRENCES,
                        help=f"Final pass: keep each in-vocab word in >= N sentences per level "
                             f"(default {DEFAULT_MIN_WORD_OCCURRENCES}). 0 = off.")
    parser.add_argument("--vocab-completion-rank", type=int, default=DEFAULT_VOCAB_COMPLETION_RANK,
                        help=f"Bypass cap for candidates adding a new in-vocab word with rank <= this "
                             f"(default {DEFAULT_VOCAB_COMPLETION_RANK}). 0 = off.")
    parser.add_argument("--out-dir", default="levels_pedagogy_ordered")
    args = parser.parse_args()

    out_dir = OGTE_ROOT / "data" / "output" / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    vocab = load_vocab(VOCAB)
    penalty = len(vocab) + 1
    scores = load_scores(SCORES)
    cap, hard_cap, novelty = args.bucket_cap, args.bucket_hard_cap, args.augment_novelty_threshold
    min_occ = args.min_word_occurrences
    completion_rank = args.vocab_completion_rank
    print(f"  vocab: {len(vocab):,}, penalty: {penalty}, pedagogy scores loaded: {len(scores):,}")
    print(f"  bucket cap: {cap}  hard cap: {hard_cap}  novelty bypass >= {novelty}  "
          f"vocab-completion rank <= {completion_rank}  min word occ: {min_occ}  out: {out_dir.relative_to(OGTE_ROOT)}")

    # Group filtered sentences by level and compute max_wfs etc.
    by_level: dict[str, list[dict]] = defaultdict(list)
    if not FILTERED.exists():
        raise FileNotFoundError(f"{FILTERED} not found.")
    with FILTERED.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            tokens = [m.group(0).lower() for m in TOKEN_RE.finditer(row["text"])]
            if not tokens:
                continue
            ranks = [vocab.get(t, penalty) for t in tokens]
            i = max(range(len(ranks)), key=lambda j: ranks[j])
            by_level[row["ogte_level"]].append({
                "id": row["id"],
                "text": row["text"],
                "max_wfs": ranks[i],
                "rarest_word": tokens[i],
                "word_count": len(tokens),
                "added_for": "",  # populated by augmentation phase if applicable
            })

    out_dir.mkdir(parents=True, exist_ok=True)
    written_levels = 0
    for level in sorted(by_level):
        items = by_level[level]
        scored = [r for r in items if r["id"] in scores]
        coverage = len(scored) / len(items) if items else 0
        if coverage < 1.0:
            print(f"  {level}: SKIP — pedagogy coverage {len(scored):,}/{len(items):,} ({100*coverage:.1f}%)")
            continue

        for r in scored:
            r["pedagogy"] = scores[r["id"]]

        # Pre-tokenise in-vocab token sets.
        def in_vocab_tokens(text: str) -> frozenset[str]:
            return frozenset(t for t in (m.group(0).lower() for m in TOKEN_RE.finditer(text)) if t in vocab)
        tokens_of: dict[str, frozenset[str]] = {r["id"]: in_vocab_tokens(r["text"]) for r in scored}

        # Phase 1 cap: top `cap` per max_wfs bucket by pedagogy DESC. For each
        # cap pick, populate added_for with the new in-vocab words it brings
        # (or, if all are already covered, the sentence's full in-vocab token
        # set) so every kept row has a non-empty added_for value.
        scored.sort(key=lambda r: (r["max_wfs"], -r["pedagogy"], r["word_count"], int(r["id"])))
        capped: list[dict] = []
        bucket_count: Counter[int] = Counter()
        covered: set[str] = set()
        for r in scored:
            if bucket_count[r["max_wfs"]] < cap:
                capped.append(r)
                bucket_count[r["max_wfs"]] += 1
                new = tokens_of[r["id"]] - covered
                contribution = new if new else tokens_of[r["id"]]
                r["added_for"] = "|".join(sorted(contribution))
                covered |= tokens_of[r["id"]]
        capped_ids = {r["id"] for r in capped}

        augmented = 0
        if hard_cap == -1:
            for r in scored:
                if r["id"] in capped_ids:
                    continue
                new = tokens_of[r["id"]] - covered
                if new:
                    capped.append(r)
                    covered |= new
                    augmented += 1
        else:
            # Greedy max-coverage with novelty + vocab-completion bypasses
            # (mirrors 5_score_and_export.py).
            available = [r for r in scored if r["id"] not in capped_ids]
            while True:
                best = None
                best_new_count = 0
                best_new_set: frozenset[str] = frozenset()
                best_tb = None
                for r in available:
                    new_set = tokens_of[r["id"]] - covered
                    if not new_set:
                        continue
                    is_novelty = (len(new_set) >= novelty)
                    is_completion = (completion_rank > 0
                                     and any(vocab.get(tok, penalty) <= completion_rank for tok in new_set))
                    is_bypass = is_novelty or is_completion
                    if not is_bypass and bucket_count[r["max_wfs"]] >= hard_cap:
                        continue
                    # Pedagogy DESC then word_count ASC then id ASC tiebreak.
                    tb = (-r["pedagogy"], r["word_count"], int(r["id"]))
                    if (len(new_set) > best_new_count) or \
                       (len(new_set) == best_new_count and (best_tb is None or tb < best_tb)):
                        best = r
                        best_new_count = len(new_set)
                        best_new_set = new_set
                        best_tb = tb
                if best is None:
                    break
                best["added_for"] = "|".join(sorted(best_new_set))
                capped.append(best)
                covered |= tokens_of[best["id"]]
                bucket_count[best["max_wfs"]] += 1
                available = [r for r in available
                             if r["id"] != best["id"]
                             and not (tokens_of[r["id"]] <= covered)]
                augmented += 1

        # Min-word-occurrences pruning: iteratively drop redundant sentences while
        # keeping every in-vocab word in >= min_occ kept sentences. Removal order:
        # lowest pedagogy first, then longest word_count, then highest id (drop weakest first).
        pruned = 0
        if min_occ > 0:
            from collections import Counter as _C
            freq = _C()
            for r in capped:
                for tok in tokens_of[r["id"]]:
                    freq[tok] += 1
            order = sorted(capped, key=lambda r: (r["pedagogy"], -r["word_count"], -int(r["id"])))
            keep_set = {r["id"] for r in capped}
            changed = True
            while changed:
                changed = False
                for r in order:
                    if r["id"] not in keep_set:
                        continue
                    toks = tokens_of[r["id"]]
                    if not toks:
                        continue
                    if all(freq[tok] - 1 >= min_occ for tok in toks):
                        keep_set.discard(r["id"])
                        for tok in toks:
                            freq[tok] -= 1
                        pruned += 1
                        changed = True
                        break
            capped = [r for r in capped if r["id"] in keep_set]

        # Final ordering: pedagogy DESC, max_wfs ASC, word_count ASC, id ASC.
        capped.sort(key=lambda r: (-r["pedagogy"], r["max_wfs"], r["word_count"], int(r["id"])))

        slug = LABEL_SLUG.get(level, "unknown")
        label = load_label_for(level)
        out = out_dir / f"ogte_{level}_{slug}.csv"
        with out.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["id", "text", "pedagogy", "max_wfs", "rarest_word", "word_count", "added_for"])
            for r in capped:
                w.writerow([r["id"], r["text"], f"{r['pedagogy']:.2f}",
                            r["max_wfs"], r["rarest_word"], r["word_count"],
                            r.get("added_for", "")])
        written_levels += 1
        suffix = f"  (-{pruned} pruned)" if pruned else ""
        print(f"  {level} {label:25s} {len(items):>6,} scored -> {len(capped):>5,} kept "
              f"(+{augmented:>4} for coverage){suffix}  ({out.name})")

    print()
    print(f"  wrote {written_levels} levels to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
