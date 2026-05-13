#!/usr/bin/env python3
"""
Score every filtered sentence by max(word-rank), sort easiest-first per OGTE
level, cap at 3 sentences per max_wfs value, and write one CSV per level.

Also writes data/output/ogte_cefr_mapping.csv with the OGTE → CEFR table the
user provided.
"""

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

OGTE_ROOT = Path(__file__).resolve().parents[1]
INPUT = OGTE_ROOT / "data" / "intermediate" / "ogte_sentences_filtered.csv"
VOCAB = OGTE_ROOT / "data" / "intermediate" / "merged_vocab.csv"
OUT_MAPPING = OGTE_ROOT / "data" / "output" / "ogte_cefr_mapping.csv"

TOKEN_RE = re.compile(r"[a-zA-Z']+")
DEFAULT_BUCKET_CAP = 2          # initial picks per (level, max_wfs) bucket
DEFAULT_BUCKET_HARD_CAP = 3     # max picks per bucket via coverage augmentation; -1 = unlimited (legacy)
DEFAULT_NOVELTY_THRESHOLD = 2   # candidates adding >= this many NEW in-vocab words bypass the bucket cap
DEFAULT_MIN_WORD_OCCURRENCES = 2  # final pass: drop redundant sentences while keeping each in-vocab word in >=N kept sentences (0 = off)
DEFAULT_VOCAB_COMPLETION_RANK = 10_000  # candidates adding >= 1 new in-vocab word with rank <= this also bypass the bucket cap (0 = off)

# (ogte, label, headwords_min, headwords_max, cefr_approx) — single source of truth.
OGTE_TABLE: list[tuple[str, str, int, int, str]] = [
    ("01", "Alphabet",                1,    50,    "pre-A1"),
    ("02", "Early-beginner",          51,   100,   "A1-"),
    ("03", "Mid-beginner",            101,  200,   "A1"),
    ("04", "High-beginner",           201,  300,   "A1+"),
    ("05", "Early-elementary",        301,  400,   "A2-"),
    ("06", "Mid-elementary",          401,  600,   "A2"),
    ("07", "High-elementary",         601,  800,   "A2+"),
    ("08", "Early-intermediate",      801,  1000,  "B1-"),
    ("09", "Mid-intermediate",        1001, 1250,  "B1"),
    ("10", "High-intermediate",       1251, 1500,  "B1+"),
    ("11", "Early-upper-int.",        1501, 1800,  "B2-"),
    ("12", "Mid-upper-int.",          1801, 2100,  "B2"),
    ("13", "High-upper-int.",         2101, 2400,  "B2+"),
    ("14", "Early-advanced",          2401, 3000,  "C1-"),
    ("15", "Mid-advanced",             3001, 3600,  "C1"),
    ("16", "High-advanced",           3601, 4500,  "C1+"),
    ("17", "Early-near-native",       4501, 6000,  "C2-"),
    ("18", "Mid-near-native",         6001, 8000,  "C2"),
    ("19", "High-near-native",        8001, 12000, "C2+"),
    ("20", "Native",                  12001, 18000, "native"),
    ("99", "Unlisted",                0,    0,     "native"),  # treated as native per user instruction
]

LABEL_SLUG = {
    "01": "alphabet", "02": "early_beginner", "03": "mid_beginner", "04": "high_beginner",
    "05": "early_elementary", "06": "mid_elementary", "07": "high_elementary",
    "08": "early_intermediate", "09": "mid_intermediate", "10": "high_intermediate",
    "11": "early_upper_intermediate", "12": "mid_upper_intermediate", "13": "high_upper_intermediate",
    "14": "early_advanced", "15": "mid_advanced", "16": "high_advanced",
    "17": "early_near_native", "18": "mid_near_native", "19": "high_near_native",
    "20": "native", "99": "unlisted",
}


def cefr_simple(cefr_approx: str) -> str:
    """Strip +/- to get the bare CEFR band."""
    if cefr_approx in ("pre-A1", "native"):
        return cefr_approx
    return cefr_approx.replace("+", "").replace("-", "")


def load_vocab(path: Path) -> dict[str, int]:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run 1_build_vocab.py first.")
    vocab: dict[str, int] = {}
    with path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            vocab[row["word"]] = int(row["rank"])
    return vocab


def write_mapping_csv() -> None:
    OUT_MAPPING.parent.mkdir(parents=True, exist_ok=True)
    with OUT_MAPPING.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ogte_level", "label", "headwords_min", "headwords_max", "cefr_approx", "cefr_simple"])
        for ogte, label, hmin, hmax, cefr in OGTE_TABLE:
            w.writerow([ogte, label, hmin, hmax, cefr, cefr_simple(cefr)])
    print(f"  wrote mapping: {OUT_MAPPING}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket-cap", type=int, default=DEFAULT_BUCKET_CAP,
                        help=f"Initial picks per (level, max_wfs) bucket "
                             f"(default {DEFAULT_BUCKET_CAP}).")
    parser.add_argument("--bucket-hard-cap", type=int, default=DEFAULT_BUCKET_HARD_CAP,
                        help=f"Max picks per bucket via coverage augmentation "
                             f"(default {DEFAULT_BUCKET_HARD_CAP}). -1 = unlimited "
                             f"(legacy: any sentence with a new in-vocab word is added).")
    parser.add_argument("--augment-novelty-threshold", type=int, default=DEFAULT_NOVELTY_THRESHOLD,
                        help=f"Candidates contributing >= this many NEW in-vocab words "
                             f"bypass the bucket hard cap (default {DEFAULT_NOVELTY_THRESHOLD}). "
                             f"Lower values approach legacy behaviour; higher values approach strict cap.")
    parser.add_argument("--min-word-occurrences", type=int, default=DEFAULT_MIN_WORD_OCCURRENCES,
                        help=f"Final pass: iteratively drop redundant sentences while "
                             f"keeping each in-vocab word in >= N kept sentences per level "
                             f"(default {DEFAULT_MIN_WORD_OCCURRENCES}). 0 = off.")
    parser.add_argument("--vocab-completion-rank", type=int, default=DEFAULT_VOCAB_COMPLETION_RANK,
                        help=f"Candidates contributing a new in-vocab word with rank <= this "
                             f"also bypass the bucket hard cap (default {DEFAULT_VOCAB_COMPLETION_RANK}). "
                             f"0 = disable.")
    parser.add_argument("--out-dir", default="levels",
                        help="Output subfolder under data/output/ (default: levels).")
    args = parser.parse_args()

    if not INPUT.exists():
        raise FileNotFoundError(f"{INPUT} not found. Run 4_filter_sentences.py first.")

    out_levels = OGTE_ROOT / "data" / "output" / args.out_dir
    out_levels.mkdir(parents=True, exist_ok=True)
    print(f"  bucket cap: {args.bucket_cap}  hard cap: {args.bucket_hard_cap}  out: {out_levels.relative_to(OGTE_ROOT)}")
    write_mapping_csv()

    print(f"[1/3] Loading vocab ...")
    vocab = load_vocab(VOCAB)
    penalty = len(vocab) + 1
    print(f"  vocab: {len(vocab):,}, penalty rank: {penalty}")

    print(f"[2/3] Scoring sentences ...")
    # by_level: ogte_level -> list of (max_wfs, word_count, sid, text, rarest_word)
    by_level: dict[str, list[tuple[int, int, str, str, str]]] = defaultdict(list)
    n = 0
    with INPUT.open(encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            tokens = [m.group(0).lower() for m in TOKEN_RE.finditer(row["text"])]
            if not tokens:
                continue
            ranks = [vocab.get(t, penalty) for t in tokens]
            max_idx = max(range(len(ranks)), key=lambda i: ranks[i])
            max_wfs = ranks[max_idx]
            rarest_word = tokens[max_idx]
            by_level[row["ogte_level"]].append(
                (max_wfs, len(tokens), row["id"], row["text"], rarest_word)
            )
            n += 1
    print(f"  scored: {n:,}")

    cap = args.bucket_cap
    hard_cap = args.bucket_hard_cap
    novelty = args.augment_novelty_threshold
    min_occ = args.min_word_occurrences
    completion_rank = args.vocab_completion_rank
    legacy = (hard_cap == -1)
    augment_label = ("legacy unbounded" if legacy
                     else f"greedy coverage <= {hard_cap}/bucket, novelty bypass >= {novelty}"
                          + (f", vocab-completion bypass for rank <= {completion_rank}"
                             if completion_rank > 0 else ""))
    pass_label = "" if min_occ <= 0 else f", min-word-occurrences pass (>= {min_occ}/word)"
    print(f"[3/3] Capping at {cap}/bucket, augmenting ({augment_label}){pass_label}, writing per-level CSVs ...")
    grand_total = 0
    grand_augmented = 0
    grand_bypassed = 0
    grand_pruned = 0
    grand_vocab_completed = 0
    for ogte, label, *_ in OGTE_TABLE:
        rows = by_level.get(ogte, [])
        # Sort: max_wfs ASC, then word_count ASC (shorter wins ties), then id ASC.
        rows.sort(key=lambda r: (r[0], r[1], r[2]))

        # Pre-tokenise every row's in-vocab token set once.
        def in_vocab_tokens(text: str) -> frozenset[str]:
            return frozenset(t for t in (m.group(0).lower() for m in TOKEN_RE.finditer(text)) if t in vocab)

        tokens_of: dict[str, frozenset[str]] = {r[2]: in_vocab_tokens(r[3]) for r in rows}

        # ----- Phase 1: cap by primary criterion (frequency-then-shorter-then-id) -----
        # For each cap-pick, record its admission contribution in added_for_of:
        # the new in-vocab words it introduces to the level. If it contributes
        # none (all already covered by prior cap picks), fall back to its full
        # in-vocab token set so every row has a non-empty added_for value.
        capped: list[tuple[int, int, str, str, str]] = []
        bucket_count: Counter[int] = Counter()
        covered: set[str] = set()
        added_for_of: dict[str, list[str]] = {}
        for r in rows:
            if bucket_count[r[0]] < cap:
                capped.append(r)
                bucket_count[r[0]] += 1
                new = tokens_of[r[2]] - covered
                contribution = new if new else tokens_of[r[2]]
                added_for_of[r[2]] = sorted(contribution)
                covered |= tokens_of[r[2]]

        capped_ids = {r[2] for r in capped}

        augmented_count = 0
        vocab_completed_count = 0
        if legacy:
            # Legacy behaviour: any sentence with at least one new in-vocab word is added,
            # no per-bucket ceiling.
            for r in rows:
                if r[2] in capped_ids:
                    continue
                new = tokens_of[r[2]] - covered
                if new:
                    capped.append(r)
                    added_for_of[r[2]] = sorted(new)
                    covered |= new
                    augmented_count += 1
        else:
            # Greedy max-coverage with two bypasses on the bucket hard cap:
            #   - novelty bypass: candidate adds >= `novelty` new in-vocab words.
            #   - vocab-completion bypass: candidate adds at least one new word with
            #     merged-vocab rank <= `completion_rank` (e.g. <= 10,000).
            # Otherwise the candidate must respect bucket_count[mw] < hard_cap.
            # Tie-break: prefer bypass over non-bypass (so completion takes priority over
            # cap-bound picks), then word_count ASC, then id ASC.
            available = [r for r in rows if r[2] not in capped_ids]
            bypassed_count = 0
            while True:
                best = None
                best_new_count = 0
                best_new_set: frozenset[str] = frozenset()
                best_tb = None
                best_bypass = False
                best_reason: str = ""  # "novelty", "completion", or "" (cap-bound)
                for r in available:
                    new_set = tokens_of[r[2]] - covered
                    if not new_set:
                        continue
                    is_novelty = (len(new_set) >= novelty)
                    is_completion = (completion_rank > 0
                                     and any(vocab.get(tok, penalty) <= completion_rank for tok in new_set))
                    is_bypass = is_novelty or is_completion
                    if not is_bypass and bucket_count[r[0]] >= hard_cap:
                        continue
                    reason = "novelty" if is_novelty else ("completion" if is_completion else "")
                    tb = (r[1], int(r[2]))
                    # Sort key: more new words wins; tie-break by (word_count ASC, id ASC).
                    if (len(new_set) > best_new_count) or \
                       (len(new_set) == best_new_count and (best_tb is None or tb < best_tb)):
                        best = r
                        best_new_count = len(new_set)
                        best_new_set = new_set
                        best_tb = tb
                        best_bypass = is_bypass
                        best_reason = reason
                if best is None:
                    break
                capped.append(best)
                added_for_of[best[2]] = sorted(best_new_set)
                covered |= tokens_of[best[2]]
                bucket_count[best[0]] += 1
                if best_bypass:
                    bypassed_count += 1
                if best_reason == "completion":
                    vocab_completed_count += 1
                available = [r for r in available
                             if r[2] != best[2]
                             and not (tokens_of[r[2]] <= covered)]
                augmented_count += 1
            grand_bypassed += bypassed_count
            grand_vocab_completed += vocab_completed_count

        # Final pass: iteratively drop redundant sentences while keeping each in-vocab
        # word in >= min_occ kept sentences. Drop bulkier sentences first (longest, then highest id).
        pruned_count = 0
        if min_occ > 0:
            from collections import Counter as _C
            freq = _C()
            for r in capped:
                for tok in tokens_of[r[2]]:
                    freq[tok] += 1
            # Sort to identify removal order; iterate stable.
            order = sorted(capped, key=lambda r: (-r[1], -int(r[2])))
            keep_set = set(r[2] for r in capped)
            changed = True
            while changed:
                changed = False
                for r in order:
                    if r[2] not in keep_set:
                        continue
                    if not tokens_of[r[2]]:
                        continue
                    # OK to drop iff every token will still have freq >= min_occ after removal.
                    if all(freq[tok] - 1 >= min_occ for tok in tokens_of[r[2]]):
                        keep_set.discard(r[2])
                        for tok in tokens_of[r[2]]:
                            freq[tok] -= 1
                        pruned_count += 1
                        changed = True
                        break
            capped = [r for r in capped if r[2] in keep_set]

        # Re-sort after augmentation so the file remains in canonical order.
        capped.sort(key=lambda r: (r[0], r[1], r[2]))

        slug = LABEL_SLUG[ogte]
        out = out_levels / f"ogte_{ogte}_{slug}.csv"
        with out.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["id", "text", "max_wfs", "rarest_word", "word_count", "added_for"])
            for max_wfs, wc, sid, text, rarest in capped:
                w.writerow([sid, text, max_wfs, rarest, wc,
                            "|".join(added_for_of.get(sid, []))])
        grand_total += len(capped)
        grand_augmented += augmented_count
        grand_pruned += pruned_count
        suffix_parts = []
        if pruned_count:
            suffix_parts.append(f"-{pruned_count} pruned")
        if vocab_completed_count:
            suffix_parts.append(f"+{vocab_completed_count} vocab-completion")
        suffix = ("  (" + ", ".join(suffix_parts) + ")") if suffix_parts else ""
        print(f"  {ogte} {label:25s} {len(rows):>7,} -> {len(capped):>6,}  (+{augmented_count:>4} for coverage){suffix}  ({out.name})")

    print()
    print(f"  total sentences (final):            {grand_total:,}")
    print(f"  total augmented for coverage:       {grand_augmented:,}")
    if not legacy:
        print(f"  ... of which bypassed bucket cap:   {grand_bypassed:,} (novelty >= {novelty})")
        if completion_rank > 0:
            print(f"  ... of which were vocab-completion: {grand_vocab_completed:,} (rank <= {completion_rank})")
    if min_occ > 0:
        print(f"  total pruned (min word occ >= {min_occ}):  {grand_pruned:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
