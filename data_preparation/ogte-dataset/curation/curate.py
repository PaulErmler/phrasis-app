"""Apply a curation plan to an original OGTE level CSV and write the curated result.

A "plan" is a Python dict describing removals, arcs (groupings + reorderings), and
additions for one level. See `plans.py` for the actual plans for L1, L2, L3.

Usage:
    python -m curation.curate            # curate all 3 levels
    python -m curation.curate --level 1  # curate only level 1
    python -m curation.curate --check    # validate existing curated CSVs
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import datetime, UTC
from pathlib import Path

from .helpers import (
    INPUT_DIR,
    LEVEL_FILES,
    MANIFEST_FILE,
    OUTPUT_DIR,
    REORDER_BUDGET,
    Row,
    check_adjacent_repetition,
    check_reorder_budget,
    check_vocab_monotonicity,
    file_sha256,
    load_vocab,
    read_curated_level,
    read_original_level,
    run_all_checks,
    write_curated_level,
)


# The ±REORDER_BUDGET is now an *incentive* (informational warning), not a hard limit.
# Arcs are no longer auto-trimmed; the user can review budget violations in the app.


# --------- plan model ---------

# A plan looks like:
# {
#   "removals": [{"id": "...", "reason": "..."}],
#   "arcs": [
#       # each arc is a list whose items are either:
#       #   - "<id>"                 → keep this original sentence
#       #   - {"text": "...", "added_for": "...", "id_hint": "..."} → add a new sentence
#       ["373330", "30316", {"text": "I'm fine, thanks!", "added_for": "fine|thanks"}],
#       ...
#   ]
# }
#
# Anything not removed and not in any arc is kept as a singleton arc in its original position.


def _next_added_id(level: int, used: set[str]) -> str:
    """Allocate a fresh added-sentence id of the form 'x{level}_{n}'."""
    n = 1
    while f"x{level}_{n}" in used:
        n += 1
    used.add(f"x{level}_{n}")
    return f"x{level}_{n}"


def apply_plan(level: int, plan: dict, vocab: dict[str, int]) -> tuple[list[Row], dict]:
    """Return (curated_rows, level_manifest_entry)."""

    originals = read_original_level(level)
    by_id = {r.id: r for r in originals}
    used_ids = set(by_id.keys())

    # ---- removals
    removed_ids = set()
    removed_log = []
    skipped_removals = []
    for entry in plan.get("removals", []):
        rid = entry["id"]
        if rid not in by_id:
            skipped_removals.append(rid)
            continue
        removed_ids.add(rid)
        r = by_id[rid]
        removed_log.append({
            "id": rid,
            "text": r.text,
            "reason": entry.get("reason", ""),
        })
    if skipped_removals:
        print(f"  ⚠ L{level}: skipped {len(skipped_removals)} removal(s) for unknown ids: {skipped_removals[:5]}{'…' if len(skipped_removals) > 5 else ''}")

    # ---- arcs
    # Each arc spec may be either:
    #   - a list of items (default position = "auto", placed by anchor)
    #   - a dict {"items": [...], "position": "first"|"last"|"auto"}
    arc_specs = plan.get("arcs", [])
    arc_ids_seen: set[str] = set()
    arc_blocks: list[tuple[str, list[Row]]] = []  # (position, block)
    added_log: list[dict] = []

    for arc_idx, arc in enumerate(arc_specs):
        if not arc:
            continue
        if isinstance(arc, dict):
            arc_items = arc.get("items", [])
            arc_position = arc.get("position", "auto")
        else:
            arc_items = arc
            arc_position = "auto"
        if not arc_items:
            continue
        block: list[Row] = []
        for item in arc_items:
            if isinstance(item, str):
                if item in removed_ids:
                    print(f"  ⚠ L{level}: arc references removed id {item!r} — skipped")
                    continue
                if item in arc_ids_seen:
                    print(f"  ⚠ L{level}: id {item!r} appears in two arcs — skipped 2nd")
                    continue
                if item not in by_id:
                    print(f"  ⚠ L{level}: arc references unknown id {item!r} — skipped")
                    continue
                arc_ids_seen.add(item)
                block.append(by_id[item])
            else:
                added_id = _next_added_id(level, used_ids)
                row = Row.new_added(
                    level=level,
                    added_id=added_id,
                    text=item["text"],
                    added_for=item.get("added_for", ""),
                    vocab=vocab,
                )
                block.append(row)
                added_log.append({
                    "id": added_id,
                    "text": item["text"],
                    "added_for": item.get("added_for", ""),
                    "reason": item.get("reason", ""),
                    "arc_position": arc_idx,
                })
        if len(block) >= 2:
            arc_blocks.append((arc_position, block))
        elif block:
            arc_ids_seen.discard(block[0].id)

    # ---- singleton blocks for untouched originals
    untouched = [
        r for r in originals
        if r.id not in removed_ids and r.id not in arc_ids_seen
    ]
    singleton_blocks: list[tuple[str, list[Row]]] = [("auto", [r]) for r in untouched]

    def anchor(entry: tuple[str, list[Row]]) -> float:
        _pos, block = entry
        idxs = [r.original_index for r in block if r.original_index is not None]
        if not idxs:
            return float("inf")  # pure-added arcs go to the end; user should anchor
        return min(idxs)

    # ---- order blocks: forced-first arcs (in declaration order),
    #      then auto blocks (arcs + singletons) sorted by anchor,
    #      then forced-last arcs (in declaration order).
    forced_first = [e for e in arc_blocks if e[0] == "first"]
    forced_last = [e for e in arc_blocks if e[0] == "last"]
    auto = [e for e in arc_blocks if e[0] not in ("first", "last")] + singleton_blocks
    auto.sort(key=anchor)
    all_blocks = forced_first + auto + forced_last

    # ---- flatten + assign arc_id
    curated: list[Row] = []
    arc_id_counter = 0
    for _pos, block in all_blocks:
        arc_id_counter += 1
        for r in block:
            r.arc_id = arc_id_counter
            curated.append(r)

    # ---- manifest entry
    manifest_entry = {
        "level": level,
        "input_file": LEVEL_FILES[level],
        "input_sha256": file_sha256(INPUT_DIR / LEVEL_FILES[level]),
        "generated_at": datetime.now(UTC).isoformat(),
        "stats": {
            "original_count": len(originals),
            "curated_count": len(curated),
            "removed_count": len(removed_log),
            "added_count": len(added_log),
            "arcs_designed": len(arc_blocks),
            "arcs_total": arc_id_counter,
        },
        "removed": removed_log,
        "added": added_log,
    }

    return curated, manifest_entry


def curate_level(level: int, plan: dict, vocab: dict[str, int]) -> dict:
    curated, manifest_entry = apply_plan(level, plan, vocab)
    write_curated_level(level, curated)
    results = [
        check_vocab_monotonicity(read_original_level(level), curated),
        check_reorder_budget(curated),
        check_adjacent_repetition(curated),
    ]
    manifest_entry["checks"] = {r.name: {"passed": r.passed, "details": r.details} for r in results}
    # Vocab-monotonicity is now an informational warning (the user explicitly allows
    # removing useless words). Don't let it fail the build.
    return manifest_entry


def write_manifest(entries_by_level: dict[int, dict]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "reorder_budget": REORDER_BUDGET,
        "levels": {str(k): v for k, v in sorted(entries_by_level.items())},
    }
    MANIFEST_FILE.write_text(json.dumps(payload, indent=2))


def print_checks(level: int, results) -> bool:
    """Print check results. Vocab-monotonicity is informational only (does not affect exit code)."""
    all_ok = True
    print(f"\n=== Level {level} ===")
    for r in results:
        if r.name == "vocab_monotonicity":
            marker = "OK" if r.passed else "INFO"
        else:
            marker = "OK" if r.passed else "FAIL"
        print(f"  [{marker}] {r.name}")
        if not r.passed:
            if r.name != "vocab_monotonicity":
                all_ok = False
            for d in r.details[:10]:
                print(f"        - {d}")
            if len(r.details) > 10:
                print(f"        … ({len(r.details) - 10} more)")
    return all_ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", type=int, choices=list(range(1, 21)), help="Curate only this level.")
    parser.add_argument("--check", action="store_true", help="Validate existing curated CSVs only.")
    args = parser.parse_args()

    if args.check:
        levels = [args.level] if args.level else list(range(1, 11))
        all_ok = True
        for lvl in levels:
            try:
                results = run_all_checks(lvl)
            except FileNotFoundError:
                continue
            ok = print_checks(lvl, results)
            all_ok = all_ok and ok
        return 0 if all_ok else 1

    # Import plans lazily so --check works even if a plan has a bug.
    from .plans import PLANS

    vocab = load_vocab()
    levels = [args.level] if args.level else sorted(PLANS.keys())
    entries: dict[int, dict] = {}
    all_ok = True
    for lvl in levels:
        plan = PLANS[lvl]
        entry = curate_level(lvl, plan, vocab)
        entries[lvl] = entry
        results = [
            type("R", (), {"name": k, "passed": v["passed"], "details": v["details"]})()  # noqa: SLF001
            for k, v in entry["checks"].items()
        ]
        ok = print_checks(lvl, results)
        all_ok = all_ok and ok
        print(
            f"  → wrote {entry['stats']['curated_count']} rows "
            f"({entry['stats']['removed_count']} removed, "
            f"{entry['stats']['added_count']} added, "
            f"{entry['stats']['arcs_designed']} arcs designed)"
        )

    # Merge with any existing manifest entries for levels not being regenerated
    if MANIFEST_FILE.exists():
        try:
            old = json.loads(MANIFEST_FILE.read_text())
            for lvl_str, e in old.get("levels", {}).items():
                lvl_int = int(lvl_str)
                if lvl_int not in entries:
                    entries[lvl_int] = e
        except Exception:
            pass

    write_manifest(entries)
    print(f"\nWrote manifest → {MANIFEST_FILE}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
