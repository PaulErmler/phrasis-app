#!/usr/bin/env python3
"""
Filter OGTE sentences: length cap, banned words, Tom drop, profanity.

Reuses BANNED_WORDS / MAX_WORDS from data_filtering.config. The two small
helpers (count_words, contains_banned_word) are inlined here rather than
imported from data_filtering.utils.filter_sentences, because that module
imports `openai` at module level (used only for the moderation step we skip),
and we don't want to add an unused dependency.

Parallelised with multiprocessing.Pool — the existing pipeline uses the same
pattern. Worker batches are dispatched lazily via imap_unordered.
"""

import csv
import re
import sys
import time
from collections import Counter
from multiprocessing import Pool, cpu_count
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_PREP = REPO_ROOT / "data_preparation"
OGTE_ROOT = DATA_PREP / "ogte-dataset"

sys.path.insert(0, str(DATA_PREP))

from data_filtering.config import BANNED_WORDS, MAX_WORDS  # noqa: E402

INPUT = OGTE_ROOT / "data" / "intermediate" / "ogte_sentences_raw.csv"
OUT_KEPT = OGTE_ROOT / "data" / "intermediate" / "ogte_sentences_filtered.csv"
OUT_DROPPED = OGTE_ROOT / "data" / "intermediate" / "ogte_sentences_dropped.csv"

BATCH_SIZE = 5_000

_BANNED_RE = re.compile(
    r"\b(" + "|".join(re.escape(w.lower()) for w in BANNED_WORDS) + r")\b",
    re.IGNORECASE,
)
TOM_RE = re.compile(r"\bTom\b", re.IGNORECASE)
# Trailing run of sentence-ending punctuation/whitespace stripped for dedup
# normalisation. Lets "Dinner's ready!" collapse with "Dinner's ready.".
_TRAILING_PUNCT_RE = re.compile(r"[\s.!?]+$")
_INTERNAL_WS_RE = re.compile(r"\s+")


def normalise_for_dedup(text: str) -> str:
    """Normalise sentence for near-duplicate detection.
    Lowercases, collapses internal whitespace, strips trailing .!? and
    surrounding whitespace. Keeps internal punctuation intact so
    "Don't!" and "Don't." dedupe but "It's me." and "It's me!" do too,
    while "I'm here." and "I'm here, sir." stay distinct."""
    s = text.strip().lower()
    s = _INTERNAL_WS_RE.sub(" ", s)
    s = _TRAILING_PUNCT_RE.sub("", s)
    return s

# Per-worker profanity instance, initialised lazily on first call.
_profanity = None


def _get_profanity():
    global _profanity
    if _profanity is None:
        from better_profanity import profanity as _p
        _p.load_censor_words()
        _profanity = _p
    return _profanity


def _classify(text: str) -> str | None:
    """Return drop reason or None if the sentence passes."""
    if len(text.split()) > MAX_WORDS:
        return "too_long"
    if TOM_RE.search(text):
        return "tom"
    m = _BANNED_RE.search(text)
    if m:
        return f"banned:{m.group(1).lower()}"
    if _get_profanity().contains_profanity(text):
        return "profanity"
    return None


def _process_batch(batch: list[tuple[str, str, str]]) -> tuple[list, list, dict]:
    kept = []
    dropped = []
    reasons: Counter[str] = Counter()
    per_level_kept: Counter[str] = Counter()
    for sid, level, text in batch:
        reason = _classify(text)
        if reason is None:
            kept.append((sid, level, text))
            per_level_kept[level] += 1
        else:
            dropped.append((sid, level, text, reason))
            reasons[reason] += 1
    return kept, dropped, {"reasons": reasons, "per_level_kept": per_level_kept}


def _read_batches(path: Path, batch_size: int):
    batch: list[tuple[str, str, str]] = []
    with path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            batch.append((row["id"], row["ogte_level"], row["text"]))
            if len(batch) >= batch_size:
                yield batch
                batch = []
    if batch:
        yield batch


def main() -> int:
    if not INPUT.exists():
        raise FileNotFoundError(f"{INPUT} not found. Run 3_extract_ogte_sentences.py first.")

    OUT_KEPT.parent.mkdir(parents=True, exist_ok=True)
    workers = max(1, cpu_count() - 1)
    print(f"  workers: {workers}, batch size: {BATCH_SIZE:,}")

    # Pre-count input rows (fast — one column scan).
    with INPUT.open(encoding="utf-8") as f:
        total_in = sum(1 for _ in f) - 1
    print(f"  total input sentences: {total_in:,}")

    drop_reasons: Counter[str] = Counter()
    per_level_total: Counter[str] = Counter()
    per_level_kept: Counter[str] = Counter()

    # Per-level totals require a separate pass — but we can do it during reading
    # on the main process (the worker batches don't see file order). We update
    # per_level_total below as we yield batches.

    start = time.time()
    processed = 0
    last_print = 0.0

    with OUT_KEPT.open("w", encoding="utf-8", newline="") as fkept, \
         OUT_DROPPED.open("w", encoding="utf-8", newline="") as fdrop, \
         Pool(processes=workers) as pool:
        kept_writer = csv.writer(fkept, delimiter="\t")
        drop_writer = csv.writer(fdrop, delimiter="\t")
        kept_writer.writerow(["id", "ogte_level", "text"])
        drop_writer.writerow(["id", "ogte_level", "text", "filter_reason"])

        def batch_iter():
            for batch in _read_batches(INPUT, BATCH_SIZE):
                for _, level, _t in batch:
                    per_level_total[level] += 1
                yield batch

        for kept, dropped, stats in pool.imap_unordered(_process_batch, batch_iter(), chunksize=1):
            kept_writer.writerows(kept)
            drop_writer.writerows(dropped)
            drop_reasons.update(stats["reasons"])
            per_level_kept.update(stats["per_level_kept"])
            processed += len(kept) + len(dropped)
            now = time.time()
            if now - last_print > 2.0 or processed == total_in:
                elapsed = now - start
                rate = processed / elapsed if elapsed > 0 else 0
                eta = (total_in - processed) / rate if rate > 0 else 0
                print(f"  [{100*processed/total_in:5.1f}%] {processed:>7,}/{total_in:,}  "
                      f"rate={rate:,.0f}/s  eta={eta:5.1f}s")
                last_print = now

    pre_dedup_kept = sum(per_level_kept.values())

    # Near-duplicate dedup: collapse sentences differing only in trailing
    # punctuation/whitespace and case. Lowest OGTE level wins on collision
    # (matches step 3's tie-break rule); within a level, lowest id wins.
    print()
    print("  deduping near-duplicates (trailing .!? collapse) ...")
    seen: dict[str, tuple[str, str, str]] = {}  # norm -> (level, id, text)
    duplicate_rows: list[tuple[str, str, str, str]] = []  # (id, level, text, reason)
    with OUT_KEPT.open(encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        rows = list(reader)
    rows.sort(key=lambda r: (r["ogte_level"], int(r["id"])))  # deterministic winner
    for r in rows:
        norm = normalise_for_dedup(r["text"])
        existing = seen.get(norm)
        if existing is None:
            seen[norm] = (r["ogte_level"], r["id"], r["text"])
        else:
            duplicate_rows.append((r["id"], r["ogte_level"], r["text"], "near_duplicate"))

    # Rewrite kept file with dedup applied (preserve original sort: by id).
    kept_after = list(seen.values())
    with OUT_KEPT.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["id", "ogte_level", "text"])
        # Sort: ogte_level ASC then id ASC so iteration is reproducible downstream.
        for level, sid, text in sorted(kept_after, key=lambda x: (x[0], int(x[1]))):
            w.writerow([sid, level, text])

    # Append dedup drops to the dropped file (already opened/closed above).
    with OUT_DROPPED.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        for sid, level, text, reason in duplicate_rows:
            w.writerow([sid, level, text, reason])

    total_kept = len(kept_after)
    deduped = pre_dedup_kept - total_kept
    drop_reasons["near_duplicate"] = deduped
    total_dropped = total_in - total_kept

    print()
    print(f"  input:        {total_in:,}")
    print(f"  pre-dedup kept: {pre_dedup_kept:,}")
    print(f"  deduped:      {deduped:,}")
    print(f"  kept:         {total_kept:,} ({100*total_kept/total_in:.1f}%)")
    print(f"  dropped:      {total_dropped:,}")
    print(f"  elapsed:      {time.time()-start:.1f}s")
    print()
    print("  drop reasons (top 20):")
    for reason, count in drop_reasons.most_common(20):
        print(f"    {reason:40s} {count:>8,}")
    print()
    # Recompute per-level kept after dedup.
    per_level_kept_post: Counter[str] = Counter()
    for level, _sid, _text in kept_after:
        per_level_kept_post[level] += 1
    print("  per-level retention (post-dedup):")
    for level in sorted(per_level_total):
        t = per_level_total[level]
        k = per_level_kept_post[level]
        pct = 100 * k / t if t else 0
        print(f"    {level}: {k:>7,} / {t:>7,} ({pct:5.1f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
