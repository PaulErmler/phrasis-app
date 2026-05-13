#!/usr/bin/env python3
"""
Stats focused on the final dataset (data/output/levels_final/) — the
user-facing assembly of curated + reviewed levels.

Outputs (in data/output/stats/):
  - final_dataset_stats.csv  — per-level + overall row, descriptive stats
  - final_dataset_stats.md   — same as a padded markdown table
  - final_dataset_word_introduction.png  — 4x5 subplot grid showing the
        cumulative-new-word curve as a learner progresses through each
        level's sentences in order. Two lines per subplot: in-vocab
        unique words (solid) and all unique tokens (dashed).

Per-level stats: sentence count, total characters, total words,
                 avg characters / sentence, avg words / sentence,
                 min / max words / sentence, NEW in-vocab words
                 (introduced in this level for the first time, NOT counted
                 again if a learner already saw them in an earlier level).

The plot's per-level cumulative curve also counts only NEW-to-the-dataset
words: a sentence in L05 containing only words from L01-L04 contributes 0.
Summing the per-level "new in-vocab words" across all rows therefore equals
the dataset's total unique in-vocab vocabulary.
"""

import argparse
import csv
import re
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

OGTE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = "levels_final"
VOCAB = OGTE_ROOT / "data" / "intermediate" / "merged_vocab.csv"
STATS_DIR = OGTE_ROOT / "data" / "output" / "stats"
STATS_CSV = STATS_DIR / "final_dataset_stats.csv"
STATS_MD = STATS_DIR / "final_dataset_stats.md"
WORD_INTRO_PNG = STATS_DIR / "final_dataset_word_introduction.png"

TOKEN_RE = re.compile(r"[a-zA-Z']+")


def load_vocab(path: Path) -> set[str]:
    if not path.exists():
        return set()
    out = set()
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.add(r["word"])
    return out


def render_table(headers: list[str], aligns: list[str], rows: list[list[str]]) -> list[str]:
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            if len(cell) > widths[i]:
                widths[i] = len(cell)

    def fmt(v: str, w: int, a: str) -> str:
        return v.rjust(w) if a == "r" else (v.center(w) if a == "c" else v.ljust(w))

    def sep(w: int, a: str) -> str:
        if a == "r": return "-" * (w - 1) + ":"
        if a == "c": return ":" + "-" * (w - 2) + ":"
        return "-" * w

    out = ["| " + " | ".join(fmt(h, widths[i], aligns[i]) for i, h in enumerate(headers)) + " |"]
    out.append("| " + " | ".join(sep(widths[i], aligns[i]) for i in range(len(headers))) + " |")
    for row in rows:
        out.append("| " + " | ".join(fmt(c, widths[i], aligns[i]) for i, c in enumerate(row)) + " |")
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--levels-dir", default=DEFAULT_DIR,
                   help=f"Folder under data/output/ to analyse (default: {DEFAULT_DIR}).")
    args = p.parse_args()
    levels_dir = OGTE_ROOT / "data" / "output" / args.levels_dir
    if not levels_dir.exists():
        raise FileNotFoundError(f"{levels_dir} not found. Run 11_build_final_dataset.py first.")

    STATS_DIR.mkdir(parents=True, exist_ok=True)
    vocab = load_vocab(VOCAB)
    print(f"  reading from: {levels_dir.relative_to(OGTE_ROOT)}/")
    print(f"  vocab size: {len(vocab):,}")

    # Per-level: ordered list of (text, char_count, word_count)
    per_level: dict[str, list[tuple[str, int, int]]] = {}
    label_for: dict[str, str] = {}
    for csv_path in sorted(levels_dir.glob("ogte_*.csv")):
        parts = csv_path.stem.split("_", 2)
        if len(parts) < 3:
            continue
        level = parts[1]
        label_for[level] = parts[2].replace("_", "-")
        rows: list[tuple[str, int, int]] = []
        with csv_path.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                text = r["text"]
                rows.append((text, len(text), len(text.split())))
        per_level[level] = rows

    # Walk levels in order, tracking what's been seen in EARLIER levels so we can
    # report only words that are new to the learner at this level.
    levels_in_order = sorted(per_level)
    seen_earlier_v: set[str] = set()
    seen_earlier_a: set[str] = set()
    per_level_stats: dict[str, dict] = {}
    cum_new_curves: dict[str, tuple[list[int], list[int]]] = {}  # lvl -> (in_vocab_curve, all_curve)

    for lvl in levels_in_order:
        rows = per_level[lvl]
        n = len(rows)
        chars = [r[1] for r in rows]
        words = [r[2] for r in rows]

        # Per-sentence cumulative-new-words curves (only counting words not seen
        # in any earlier level OR earlier sentence in this level).
        seen_so_far_v = set(seen_earlier_v)  # snapshot for stop-comparison only
        running_v = set()
        running_a = set()
        curve_v: list[int] = []
        curve_a: list[int] = []
        for text, _, _ in rows:
            for m in TOKEN_RE.finditer(text):
                t = m.group(0).lower()
                if t not in seen_earlier_a and t not in running_a:
                    running_a.add(t)
                    if t in vocab:
                        running_v.add(t)
            curve_v.append(len(running_v))
            curve_a.append(len(running_a))
        cum_new_curves[lvl] = (curve_v, curve_a)

        per_level_stats[lvl] = {
            "sentence_count": n,
            "total_chars": sum(chars) if chars else 0,
            "total_words": sum(words) if words else 0,
            "avg_chars": sum(chars) / n if n else 0.0,
            "avg_words": sum(words) / n if n else 0.0,
            "min_words": min(words) if words else 0,
            "max_words": max(words) if words else 0,
            "new_in_vocab_words": len(running_v),
            "new_all_words": len(running_a),
        }

        # After this level, those tokens are now "seen earlier" for subsequent levels.
        seen_earlier_v |= running_v
        seen_earlier_a |= running_a

    # Overall — recompute by concatenating in-order processing (per-level "new" sums = overall unique).
    total_chars = sum(s["total_chars"] for s in per_level_stats.values())
    total_words = sum(s["total_words"] for s in per_level_stats.values())
    total_n = sum(s["sentence_count"] for s in per_level_stats.values())
    all_rows = [r for lvl in levels_in_order for r in per_level[lvl]]
    overall = {
        "sentence_count": total_n,
        "total_chars": total_chars,
        "total_words": total_words,
        "avg_chars": total_chars / total_n if total_n else 0.0,
        "avg_words": total_words / total_n if total_n else 0.0,
        "min_words": min((r[2] for r in all_rows), default=0),
        "max_words": max((r[2] for r in all_rows), default=0),
        "new_in_vocab_words": len(seen_earlier_v),  # union after all levels processed
        "new_all_words": len(seen_earlier_a),
    }

    # Write CSV
    cols = ["ogte_level", "label", "sentence_count", "total_chars", "total_words",
            "avg_chars_per_sentence", "avg_words_per_sentence",
            "min_words_per_sentence", "max_words_per_sentence",
            "new_in_vocab_words", "new_all_words"]
    with STATS_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for lvl in levels_in_order:
            s = per_level_stats[lvl]
            w.writerow([lvl, label_for.get(lvl, ""), s["sentence_count"], s["total_chars"],
                        s["total_words"], f"{s['avg_chars']:.1f}", f"{s['avg_words']:.2f}",
                        s["min_words"], s["max_words"], s["new_in_vocab_words"],
                        s["new_all_words"]])
        w.writerow(["TOTAL", "", overall["sentence_count"], overall["total_chars"],
                    overall["total_words"], f"{overall['avg_chars']:.1f}",
                    f"{overall['avg_words']:.2f}", overall["min_words"], overall["max_words"],
                    overall["new_in_vocab_words"], overall["new_all_words"]])
    print(f"  -> {STATS_CSV}")

    # Markdown
    headers = ["OGTE", "Label", "Sentences", "Chars", "Words",
               "Avg chars/sent", "Avg words/sent",
               "Min w/sent", "Max w/sent",
               "New in-vocab", "New all"]
    aligns = ["l", "l", "r", "r", "r", "r", "r", "r", "r", "r", "r"]
    rows_md = []
    for lvl in levels_in_order:
        s = per_level_stats[lvl]
        rows_md.append([lvl, label_for.get(lvl, ""), f"{s['sentence_count']:,}",
                        f"{s['total_chars']:,}", f"{s['total_words']:,}",
                        f"{s['avg_chars']:.1f}", f"{s['avg_words']:.2f}",
                        str(s["min_words"]), str(s["max_words"]),
                        f"{s['new_in_vocab_words']:,}", f"{s['new_all_words']:,}"])
    rows_md.append(["TOTAL", "", f"{overall['sentence_count']:,}",
                    f"{overall['total_chars']:,}", f"{overall['total_words']:,}",
                    f"{overall['avg_chars']:.1f}", f"{overall['avg_words']:.2f}",
                    str(overall["min_words"]), str(overall["max_words"]),
                    f"{overall['new_in_vocab_words']:,}", f"{overall['new_all_words']:,}"])

    md_lines = [
        "# Final dataset — descriptive statistics",
        "",
        f"Source folder: `data/output/{args.levels_dir}/`",
        "",
        "**New in-vocab / New all** = words introduced in this level for the FIRST time "
        "across the dataset. Words a learner already saw in any earlier level are not "
        "re-counted, so the column sums equal the total unique vocabulary in the TOTAL row.",
        "",
        "## Per-level + overall",
        "",
    ]
    md_lines.extend(render_table(headers, aligns, rows_md))
    md_lines.append("")
    STATS_MD.write_text("\n".join(md_lines), encoding="utf-8")
    print(f"  -> {STATS_MD}")

    # Plot grid: each subplot shows the across-level cumulative-new-word curve
    # for one level (only counting words not seen in any EARLIER level).
    n_levels = len(levels_in_order)
    n_cols = 5
    n_rows = (n_levels + n_cols - 1) // n_cols
    fig, axes = plt.subplots(n_rows, n_cols, figsize=(15, 2.4 * n_rows), squeeze=False)
    for idx, lvl in enumerate(levels_in_order):
        ax = axes[idx // n_cols][idx % n_cols]
        v_series, a_series = cum_new_curves[lvl]
        x = list(range(1, len(v_series) + 1))
        ax.plot(x, a_series, color="#aaaaaa", linewidth=1.0, linestyle="--", label="all tokens")
        ax.plot(x, v_series, color="#1f77b4", linewidth=1.5, label="in-vocab")
        s = per_level_stats[lvl]
        ax.set_title(f"L{lvl} {label_for.get(lvl,'')[:18]} (+{s['new_in_vocab_words']} new)",
                     fontsize=9)
        ax.tick_params(axis="both", labelsize=7)
        ax.grid(True, alpha=0.3)
        if idx == 0:
            ax.legend(fontsize=7, loc="lower right")
    for idx in range(n_levels, n_rows * n_cols):
        axes[idx // n_cols][idx % n_cols].axis("off")
    fig.suptitle("Cumulative NEW words per level — only words not yet seen in any earlier level "
                 f"(source: {args.levels_dir}/)", fontsize=11, y=1.02)
    fig.supxlabel("Sentence position within level", fontsize=9)
    fig.supylabel("Cumulative new words (across-level-aware)", fontsize=9)
    fig.tight_layout()
    fig.savefig(WORD_INTRO_PNG, dpi=140, bbox_inches="tight")
    plt.close(fig)
    print(f"  -> {WORD_INTRO_PNG}")

    print()
    print(f"  total sentences: {overall['sentence_count']:,}")
    print(f"  avg chars/sentence (overall): {overall['avg_chars']:.1f}")
    print(f"  avg words/sentence (overall): {overall['avg_words']:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
