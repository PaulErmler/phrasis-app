#!/usr/bin/env python3
"""
Additional dataset statistics, complementing 6_build_stats.py.

Outputs (all in data/output/stats/):
  - missing_top10k_words.csv  — words in top-10k of merged vocab that don't
                                appear in ANY sentence of the full filtered
                                set (id+text from levels_original_order/),
                                with their rank.
  - vocab_growth.csv          — cumulative unique-word count per OGTE level
                                (in order 01 -> 99).
  - vocab_growth.png          — line plot of the same.
  - sample_5_per_level.csv    — 5 random sentences from each curated level
                                (levels/), in OGTE-level order.
  - vocab_by_level.md         — every word in the dataset, sectioned by the
                                OGTE level where it first appears, sorted by
                                merged-vocab frequency rank within each
                                section. Reading top-to-bottom = the order
                                vocabulary is introduced as a learner
                                progresses through the levels.

Uses the curated levels/ folder for the sample (so the user is reviewing the
same set already exposed in the IDE), and levels_original_order/ for the
"missing words" analysis (so coverage isn't artificially limited by the
3-per-bucket cap).
"""

import argparse
import csv
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

OGTE_ROOT = Path(__file__).resolve().parents[1]
VOCAB = OGTE_ROOT / "data" / "intermediate" / "merged_vocab.csv"
LEVELS_DIR = OGTE_ROOT / "data" / "output" / "levels"
ORIG_DIR = OGTE_ROOT / "data" / "output" / "levels_original_order"
STATS_DIR = OGTE_ROOT / "data" / "output" / "stats"

MISSING_OUT = STATS_DIR / "missing_top10k_words.csv"
GROWTH_CSV = STATS_DIR / "vocab_growth.csv"
GROWTH_PNG = STATS_DIR / "vocab_growth.png"
SAMPLE_OUT = STATS_DIR / "sample_5_per_level.csv"
VOCAB_BY_LEVEL_MD = STATS_DIR / "vocab_by_level.md"

TOP_N = 10_000
SAMPLE_PER_LEVEL = 5
SAMPLE_SEED = 42

TOKEN_RE = re.compile(r"[a-zA-Z']+")


def tokens(text: str) -> set[str]:
    return {m.group(0).lower() for m in TOKEN_RE.finditer(text)}


def load_top_n_vocab(path: Path, n: int) -> list[tuple[int, str]]:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found.")
    out: list[tuple[int, str]] = []
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rank = int(row["rank"])
            if rank > n:
                break
            out.append((rank, row["word"]))
    return out


def collect_words_per_level(levels_dir: Path) -> dict[str, set[str]]:
    """ogte_level -> set(words found in any sentence in that level's CSV)."""
    by_level: dict[str, set[str]] = defaultdict(set)
    for csv_path in sorted(levels_dir.glob("ogte_*.csv")):
        ogte = csv_path.stem.split("_", 2)[1]
        with csv_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                by_level[ogte].update(tokens(row["text"]))
    return dict(by_level)


def collect_sentence_counts(levels_dir: Path) -> dict[str, int]:
    """ogte_level -> sentence count in that level's CSV."""
    counts: dict[str, int] = {}
    for csv_path in sorted(levels_dir.glob("ogte_*.csv")):
        ogte = csv_path.stem.split("_", 2)[1]
        with csv_path.open(encoding="utf-8") as f:
            counts[ogte] = sum(1 for _ in csv.DictReader(f))
    return counts


def write_missing_words(top_vocab: list[tuple[int, str]], all_words: set[str]) -> int:
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    missing = [(rank, w) for rank, w in top_vocab if w not in all_words]
    with MISSING_OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rank", "word"])
        for rank, word in missing:
            w.writerow([rank, word])
    return len(missing)


def write_growth(per_level_words: dict[str, set[str]],
                 sentence_counts: dict[str, int] | None = None) -> list[tuple[str, int, int, int]]:
    """Compute and write per-level + cumulative unique words. If `sentence_counts` is
    given, the per-level sentence count is included as a fourth column.

    Returned rows: (level, unique_words_in_level, cumulative_unique_words, sentences_in_level).
    """
    sentence_counts = sentence_counts or {}
    levels_in_order = sorted(per_level_words)
    seen: set[str] = set()
    rows: list[tuple[str, int, int, int]] = []
    for lvl in levels_in_order:
        seen |= per_level_words[lvl]
        rows.append((lvl, len(per_level_words[lvl]), len(seen), sentence_counts.get(lvl, 0)))
    with GROWTH_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ogte_level", "unique_words_in_level", "cumulative_unique_words", "sentences_in_level"])
        for lvl, level_n, cum, sent_n in rows:
            w.writerow([lvl, level_n, cum, sent_n])
    return rows


def plot_growth(rows: list[tuple[str, int, int, int]],
                compare_rows: list[tuple[str, int, int, int]] | None = None,
                compare_label: str = "compare") -> None:
    levels = [r[0] for r in rows]
    per_level = [r[1] for r in rows]
    cumulative = [r[2] for r in rows]
    sentences = [r[3] for r in rows]

    fig, ax = plt.subplots(figsize=(11, 5.5))

    # Right axis (sentence counts as bars in the background).
    ax2 = ax.twinx()
    bars = ax2.bar(levels, sentences, alpha=0.18, color="#7f7f7f", label="Sentences in level (right axis)",
                   zorder=1)
    ax2.set_ylabel("Sentences", color="#555555")
    ax2.tick_params(axis="y", colors="#555555")
    ax2.set_ylim(0, max(sentences) * 1.1 if sentences else 1)

    # Left axis (vocab lines on top).
    main_label = "Cumulative unique words — current (levels/)"
    line_cum, = ax.plot(levels, cumulative, marker="o", linewidth=2, label=main_label,
                        color="#1f77b4", zorder=3)
    line_lvl, = ax.plot(levels, per_level, marker="s", linewidth=1.2, alpha=0.7,
                        label="Unique words in this level (non-cumulative)",
                        color="#ff7f0e", zorder=3)

    handles = [line_cum, line_lvl]
    if compare_rows is not None:
        comp_levels = [r[0] for r in compare_rows]
        comp_cum = [r[2] for r in compare_rows]
        line_cmp, = ax.plot(comp_levels, comp_cum, marker="^", linewidth=2,
                            label=f"Cumulative — {compare_label}",
                            color="#2ca02c", linestyle="--", zorder=3)
        handles.append(line_cmp)
    handles.append(bars)

    ax.set_xlabel("OGTE level")
    ax.set_ylabel("Unique words")
    ax.set_title("Vocabulary growth + sentence count per OGTE level (curated levels/)")
    ax.grid(True, alpha=0.3)
    # Combined legend across both axes.
    ax.legend(handles=handles, loc="upper left", fontsize=9)

    for i, c in enumerate(cumulative):
        if i == 0 or i == len(cumulative) - 1 or i % 4 == 0:
            ax.annotate(f"{c:,}", (i, c), textcoords="offset points", xytext=(0, 8),
                        ha="center", fontsize=8)
    for i, s in enumerate(sentences):
        if i == 0 or i == len(sentences) - 1 or i % 4 == 0:
            ax2.annotate(f"{s:,}", (i, s), textcoords="offset points", xytext=(0, -12),
                         ha="center", fontsize=7, color="#555555")
    ax.set_zorder(ax2.get_zorder() + 1)
    ax.patch.set_visible(False)  # so bars show through

    fig.tight_layout()
    fig.savefig(GROWTH_PNG, dpi=140)
    plt.close(fig)


def load_level_labels() -> dict[str, str]:
    """Read the canonical OGTE level labels from the mapping CSV produced by
    5_score_and_export.py. Avoids duplicating the label list."""
    mapping_csv = OGTE_ROOT / "data" / "output" / "ogte_cefr_mapping.csv"
    labels: dict[str, str] = {}
    if mapping_csv.exists():
        with mapping_csv.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                labels[row["ogte_level"]] = row["label"]
    return labels


def write_vocab_by_level(per_level_words: dict[str, set[str]]) -> int:
    """Markdown dump of every word, sectioned by the OGTE level where it first
    appears, sorted by merged-vocab rank within each section. OOV words
    (not in merged_vocab) listed after ranked words, alphabetically."""
    rank_of: dict[str, int] = {}
    if VOCAB.exists():
        with VOCAB.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                rank_of[row["word"]] = int(row["rank"])

    labels = load_level_labels()

    levels_in_order = sorted(per_level_words)
    seen: set[str] = set()
    total = 0

    with VOCAB_BY_LEVEL_MD.open("w", encoding="utf-8") as f:
        f.write("# Vocabulary by OGTE level\n\n")
        f.write("Every word in the dataset, sectioned by the OGTE level where it **first appears**. ")
        f.write("Within each section, ranked words come first (sorted by their merged-vocab frequency rank, ")
        f.write("most-common first), followed by OOV words (not in the top-20k intersection) sorted alphabetically.\n\n")
        f.write(f"Reading top-to-bottom = the order new vocabulary is introduced as a learner progresses through the levels.\n\n")

        for lvl in levels_in_order:
            label = labels.get(lvl, "")
            new_words = sorted(per_level_words[lvl] - seen)
            ranked = sorted([w for w in new_words if w in rank_of], key=lambda w: rank_of[w])
            oov = sorted(w for w in new_words if w not in rank_of)
            seen |= per_level_words[lvl]
            total += len(new_words)

            heading = f"## Level {lvl}"
            if label:
                heading += f" — {label}"
            heading += f"  ({len(new_words):,} new, {len(ranked):,} ranked, {len(oov):,} OOV)"
            f.write(heading + "\n\n")

            if ranked:
                lines = [f"{rank_of[w]:>5}. {w}" for w in ranked]
                f.write("```\n" + "\n".join(lines) + "\n```\n\n")
            if oov:
                f.write("**OOV** (not in merged top-20k):\n\n")
                f.write("```\n" + ", ".join(oov) + "\n```\n\n")

    return total


def write_sample(curated_dir: Path) -> int:
    rng = random.Random(SAMPLE_SEED)
    written = 0
    with SAMPLE_OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ogte_level", "id", "text", "max_wfs", "rarest_word", "word_count"])
        for csv_path in sorted(curated_dir.glob("ogte_*.csv")):
            ogte = csv_path.stem.split("_", 2)[1]
            with csv_path.open(encoding="utf-8") as fin:
                rows = list(csv.DictReader(fin))
            if not rows:
                continue
            picks = rng.sample(rows, min(SAMPLE_PER_LEVEL, len(rows)))
            for row in picks:
                w.writerow([ogte, row["id"], row["text"], row["max_wfs"],
                            row["rarest_word"], row["word_count"]])
                written += 1
    return written


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--levels-dir", default="levels",
                        help="Curated levels folder (under data/output/) used for vocab-growth plot main line.")
    parser.add_argument("--compare-dir", default=None,
                        help="Optional comparison folder (under data/output/) for a second growth line.")
    parser.add_argument("--compare-label", default=None,
                        help="Legend label for the comparison line (default = folder name).")
    args = parser.parse_args()

    levels_dir = OGTE_ROOT / "data" / "output" / args.levels_dir
    compare_dir = OGTE_ROOT / "data" / "output" / args.compare_dir if args.compare_dir else None

    if not VOCAB.exists():
        raise FileNotFoundError(f"{VOCAB} not found.")
    if not ORIG_DIR.exists():
        raise FileNotFoundError(f"{ORIG_DIR} not found. Run 7_export_original_order.py first.")
    if not levels_dir.exists():
        raise FileNotFoundError(f"{levels_dir} not found. Run 5_score_and_export.py first.")
    if compare_dir and not compare_dir.exists():
        raise FileNotFoundError(f"{compare_dir} not found.")

    print(f"[1/5] Loading top-{TOP_N} merged vocab ...")
    top_vocab = load_top_n_vocab(VOCAB, TOP_N)
    print(f"  loaded {len(top_vocab):,} words")

    print(f"[2/5] Collecting words from full pool ({ORIG_DIR.name}) for missing-words / vocab-by-level ...")
    full_pool_words = collect_words_per_level(ORIG_DIR)
    all_words = set().union(*full_pool_words.values()) if full_pool_words else set()
    print(f"  unique words across full pool: {len(all_words):,}")

    print(f"[3/5] Writing missing-words list ...")
    missing_n = write_missing_words(top_vocab, all_words)
    print(f"  {missing_n:,} of top-{TOP_N} merged-vocab words are absent from the full pool")
    print(f"  -> {MISSING_OUT}")

    print(f"[4/5] Computing vocab growth + sentence counts from curated {levels_dir.name}/ ...")
    curated_words = collect_words_per_level(levels_dir)
    curated_counts = collect_sentence_counts(levels_dir)
    growth_rows = write_growth(curated_words, curated_counts)
    compare_rows = None
    if compare_dir is not None:
        print(f"      + comparison growth from {compare_dir.name}/ ...")
        compare_words = collect_words_per_level(compare_dir)
        compare_counts = collect_sentence_counts(compare_dir)
        seen: set[str] = set()
        compare_rows = []
        for lvl in sorted(compare_words):
            seen |= compare_words[lvl]
            compare_rows.append((lvl, len(compare_words[lvl]), len(seen), compare_counts.get(lvl, 0)))

    plot_growth(growth_rows, compare_rows, args.compare_label or (compare_dir.name if compare_dir else ""))
    print(f"  -> {GROWTH_CSV}")
    print(f"  -> {GROWTH_PNG}")

    print(f"[5/5] Writing sample + vocab-by-level ...")
    sample_n = write_sample(levels_dir)
    print(f"  -> {SAMPLE_OUT} ({sample_n} rows)")

    vocab_total = write_vocab_by_level(full_pool_words)
    print(f"  -> {VOCAB_BY_LEVEL_MD} ({vocab_total:,} words across all levels)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
