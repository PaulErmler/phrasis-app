import csv
import sys
from pathlib import Path

BASE = Path(__file__).parent / "data" / "output"
BY_DIFF = BASE / "sentences_by_difficulty"
TRANSLATED = BASE / "sentences_translated.csv"

LANG_COLS = [
    "text_en", "es", "es_latam", "fr", "de", "it", "pt", "ru",
    "hi", "zh", "ja", "ko", "vi", "sv", "fi", "nl", "el", "ar",
]

csv.field_size_limit(sys.maxsize)

translations = {}
with TRANSLATED.open(encoding="utf-8", newline="") as f:
    for row in csv.DictReader(f):
        translations[row["id"]] = {l: row.get(l, "") or "" for l in LANG_COLS}

totals = {l: {"chars": 0, "count": 0} for l in LANG_COLS}
per_difficulty = {}

for csv_path in sorted(BY_DIFF.glob("*.csv")):
    diff = csv_path.stem
    bucket = {l: {"chars": 0, "count": 0} for l in LANG_COLS}
    with csv_path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            sid = row["id"]
            t = translations.get(sid)
            if not t:
                continue
            for lang in LANG_COLS:
                txt = t[lang]
                if txt:
                    bucket[lang]["chars"] += len(txt)
                    bucket[lang]["count"] += 1
                    totals[lang]["chars"] += len(txt)
                    totals[lang]["count"] += 1
    per_difficulty[diff] = bucket

COST_PER_1K = 0.05  # ElevenLabs v3 USD per 1000 characters

def fmt(stats):
    print(f"  {'lang':<10} {'sentences':>10} {'total_chars':>14} {'avg/sentence':>14} {'cost_usd':>10}")
    sum_chars = 0
    sum_count = 0
    for lang in LANG_COLS:
        c = stats[lang]["count"]
        ch = stats[lang]["chars"]
        avg = ch / c if c else 0
        cost = ch / 1000 * COST_PER_1K
        sum_chars += ch
        sum_count += c
        print(f"  {lang:<10} {c:>10} {ch:>14} {avg:>14.2f} {cost:>10.2f}")
    total_cost = sum_chars / 1000 * COST_PER_1K
    print(f"  {'-'*64}")
    print(f"  {'SUM':<10} {sum_count:>10} {sum_chars:>14} {'':>14} {total_cost:>10.2f}")

for diff, stats in per_difficulty.items():
    print(f"\n=== Difficulty: {diff} ===")
    fmt(stats)

print("\n=== ENTIRE DATASET (all difficulties combined) ===")
fmt(totals)

print(f"\n=== VERIFICATION: sum-of-difficulty-buckets vs. totals dict ===")
for lang in LANG_COLS:
    summed = sum(per_difficulty[d][lang]["chars"] for d in per_difficulty)
    direct = totals[lang]["chars"]
    match = "OK" if summed == direct else f"MISMATCH ({summed} vs {direct})"
    print(f"  {lang:<10} direct={direct:>10}  summed={summed:>10}  {match}")
