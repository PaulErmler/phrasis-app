#!/usr/bin/env python3
"""
Build a statistical overview of the OGTE dataset.

Reads every per-level CSV under data/output/levels/ plus the OGTE→CEFR mapping
and emits:
  - data/output/stats/overview.json (machine-readable)
  - data/output/stats/overview.md   (human-readable)

Reported per level:
  - sentence count
  - unique words (regex-tokenised, lowercased)
  - max_wfs distribution: min / p50 / p90 / p99 / max
  - distinct max_wfs bucket count

Plus a CEFR-rolled-up table that collapses +/- variants into the bare band
(pre-A1, A1, A2, B1, B2, C1, C2, native).
"""

import csv
import json
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

OGTE_ROOT = Path(__file__).resolve().parents[1]
LEVELS_DIR = OGTE_ROOT / "data" / "output" / "levels"
MAPPING_CSV = OGTE_ROOT / "data" / "output" / "ogte_cefr_mapping.csv"
STATS_DIR = OGTE_ROOT / "data" / "output" / "stats"
JSON_OUT = STATS_DIR / "overview.json"
MD_OUT = STATS_DIR / "overview.md"
VOCAB = OGTE_ROOT / "data" / "intermediate" / "merged_vocab.csv"

TOKEN_RE = re.compile(r"[a-zA-Z']+")


def render_table(headers: list[str], aligns: list[str], rows: list[list[str]]) -> list[str]:
    """Render a markdown table with each column padded to its max cell width.

    aligns is a list parallel to headers: 'l' (left), 'r' (right), 'c' (center).
    """
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            if len(cell) > widths[i]:
                widths[i] = len(cell)

    def fmt_cell(value: str, width: int, align: str) -> str:
        if align == "r":
            return value.rjust(width)
        if align == "c":
            return value.center(width)
        return value.ljust(width)

    def fmt_sep(width: int, align: str) -> str:
        if align == "r":
            return "-" * (width - 1) + ":"
        if align == "c":
            return ":" + "-" * (width - 2) + ":"
        return "-" * width

    out: list[str] = []
    out.append("| " + " | ".join(fmt_cell(h, widths[i], aligns[i]) for i, h in enumerate(headers)) + " |")
    out.append("| " + " | ".join(fmt_sep(widths[i], aligns[i]) for i in range(len(headers))) + " |")
    for row in rows:
        out.append("| " + " | ".join(fmt_cell(c, widths[i], aligns[i]) for i, c in enumerate(row)) + " |")
    return out


def percentile(values: list[int], p: float) -> int:
    if not values:
        return 0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round((p / 100) * (len(s) - 1)))))
    return s[k]


def load_mapping() -> dict[str, dict]:
    mapping: dict[str, dict] = {}
    with MAPPING_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            mapping[row["ogte_level"]] = row
    return mapping


def main() -> int:
    if not LEVELS_DIR.exists():
        raise FileNotFoundError(f"{LEVELS_DIR} not found. Run 5_score_and_export.py first.")

    mapping = load_mapping()
    vocab_size = sum(1 for _ in VOCAB.open(encoding="utf-8")) - 1 if VOCAB.exists() else None

    by_level: dict[str, dict] = {}
    grand_total = 0
    cefr_simple_totals: dict[str, int] = defaultdict(int)
    cefr_simple_unique: dict[str, set] = defaultdict(set)

    for csv_path in sorted(LEVELS_DIR.glob("ogte_*.csv")):
        # Filename pattern: ogte_NN_label.csv
        ogte = csv_path.stem.split("_", 2)[1]
        info = mapping.get(ogte, {})
        max_wfs_values: list[int] = []
        unique_words: set[str] = set()
        sentence_count = 0
        with csv_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                sentence_count += 1
                max_wfs_values.append(int(row["max_wfs"]))
                for tok in TOKEN_RE.finditer(row["text"]):
                    unique_words.add(tok.group(0).lower())

        by_level[ogte] = {
            "label": info.get("label", "?"),
            "headwords_min": int(info.get("headwords_min", 0)),
            "headwords_max": int(info.get("headwords_max", 0)),
            "cefr_approx": info.get("cefr_approx", "?"),
            "cefr_simple": info.get("cefr_simple", "?"),
            "sentence_count": sentence_count,
            "unique_words": len(unique_words),
            "max_wfs_min": min(max_wfs_values) if max_wfs_values else 0,
            "max_wfs_p50": percentile(max_wfs_values, 50),
            "max_wfs_p90": percentile(max_wfs_values, 90),
            "max_wfs_p99": percentile(max_wfs_values, 99),
            "max_wfs_max": max(max_wfs_values) if max_wfs_values else 0,
            "max_wfs_mean": round(statistics.mean(max_wfs_values), 1) if max_wfs_values else 0,
            "max_wfs_buckets_used": len(set(max_wfs_values)),
        }
        grand_total += sentence_count
        simple = info.get("cefr_simple", "?")
        cefr_simple_totals[simple] += sentence_count
        cefr_simple_unique[simple] |= unique_words

    cefr_rollup = {
        band: {
            "sentence_count": cefr_simple_totals[band],
            "unique_words": len(cefr_simple_unique[band]),
        }
        for band in ["pre-A1", "A1", "A2", "B1", "B2", "C1", "C2", "native"]
        if band in cefr_simple_totals
    }

    overview = {
        "total_sentences": grand_total,
        "vocab_size": vocab_size,
        "by_level": by_level,
        "by_cefr_simple": cefr_rollup,
    }

    STATS_DIR.mkdir(parents=True, exist_ok=True)
    JSON_OUT.write_text(json.dumps(overview, indent=2), encoding="utf-8")
    print(f"  wrote {JSON_OUT}")

    # Markdown
    lines: list[str] = []
    lines.append("# OGTE Dataset — Overview")
    lines.append("")
    lines.append(f"- **Total sentences (post-cap)**: {grand_total:,}")
    lines.append(f"- **Vocabulary size (merged top-20k intersection)**: {vocab_size:,}")
    lines.append(f"- **OGTE levels**: {len(by_level)}")
    lines.append("")
    lines.append("## Per-level metrics")
    lines.append("")
    headers = ["OGTE", "Label", "CEFR", "Sentences", "Unique words",
               "max_wfs min", "p50", "p90", "p99", "max", "buckets"]
    aligns = ["l", "l", "l", "r", "r", "r", "r", "r", "r", "r", "r"]
    rows = []
    for ogte in sorted(by_level):
        d = by_level[ogte]
        rows.append([
            ogte, d["label"], d["cefr_approx"],
            f"{d['sentence_count']:,}", f"{d['unique_words']:,}",
            f"{d['max_wfs_min']}", f"{d['max_wfs_p50']}",
            f"{d['max_wfs_p90']}", f"{d['max_wfs_p99']}",
            f"{d['max_wfs_max']}", f"{d['max_wfs_buckets_used']:,}",
        ])
    lines.extend(render_table(headers, aligns, rows))
    lines.append("")
    lines.append("## CEFR roll-up (without +/-)")
    lines.append("")
    rollup_rows = []
    for band in ["pre-A1", "A1", "A2", "B1", "B2", "C1", "C2", "native"]:
        if band in cefr_rollup:
            d = cefr_rollup[band]
            rollup_rows.append([band, f"{d['sentence_count']:,}", f"{d['unique_words']:,}"])
    lines.extend(render_table(
        ["CEFR", "Sentences", "Unique words"],
        ["l", "r", "r"],
        rollup_rows,
    ))
    lines.append("")
    MD_OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"  wrote {MD_OUT}")
    print()
    print(f"  total sentences: {grand_total:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
