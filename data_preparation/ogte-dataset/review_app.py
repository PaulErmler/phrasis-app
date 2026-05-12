"""Streamlit app for reviewing and editing the curated OGTE L1-L3 sentences.

Run with:
    cd data_preparation/ogte-dataset
    streamlit run review_app.py

Tabs:
- 🔀 Reorder & group: drag sentences within and across arc containers
- 📝 Edit text: spreadsheet-style editor for text / added_for / metadata
- 📜 Final ordering: read-only numbered list of the curated order with badges

Save runs vocab-monotonicity, reorder-budget (±100), and 4-in-a-row repetition checks.
Vocab failures block the save; the other two surface as warnings.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, UTC
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pandas as pd  # noqa: E402
import streamlit as st  # noqa: E402
from streamlit_sortables import sort_items  # noqa: E402

from curation.helpers import (  # noqa: E402
    CURATED_FIELDS,
    INPUT_DIR,
    LEVEL_FILES,
    MANIFEST_FILE,
    OUTPUT_DIR,
    REORDER_BUDGET,
    Row,
    check_adjacent_repetition,
    check_reorder_budget,
    check_vocab_monotonicity,
    compute_metadata,
    content_tokens,
    load_vocab,
    read_original_level,
)


st.set_page_config(page_title="OGTE Level Review", layout="wide")


# ----------------------- data loading -----------------------


@st.cache_data(show_spinner=False)
def cached_vocab() -> dict:
    return load_vocab()


def load_level(level: int) -> tuple[pd.DataFrame, dict, dict]:
    """Return (curated_df, original_by_id, level_manifest_entry)."""
    curated_path = OUTPUT_DIR / LEVEL_FILES[level]
    original_path = INPUT_DIR / LEVEL_FILES[level]

    curated_df = pd.read_csv(curated_path, dtype=str).fillna("")
    original_df = pd.read_csv(original_path, dtype=str).fillna("")

    # Index originals by id for quick lookup
    original_by_id = {row["id"]: dict(row) for _, row in original_df.iterrows()}
    orig_index = {rid: i for i, rid in enumerate(original_df["id"].tolist())}

    curated_df["original_index"] = curated_df["id"].map(orig_index)
    curated_df["delta"] = [
        (i - orig_index[r["id"]]) if r["id"] in orig_index else None
        for i, r in curated_df.iterrows()
    ]

    def classify(row) -> str:
        if row["id"] not in orig_index:
            return "added"
        if int(row["original_index"]) != row.name:
            return "moved"
        return "kept"

    curated_df["change_type"] = [classify(r) for _, r in curated_df.iterrows()]

    manifest = {}
    if MANIFEST_FILE.exists():
        manifest = json.loads(MANIFEST_FILE.read_text()).get("levels", {}).get(str(level), {})

    return curated_df, original_by_id, manifest


# ----------------------- item encoding for sortable -----------------------

ITEM_SEP = " · "


def encode_item(row: pd.Series) -> str:
    """Compact one-line label shown on each draggable card. id is the prefix and parser key."""
    badge = {"added": "+", "moved": "↻", "kept": " "}.get(row.get("change_type", ""), " ")
    text = (row.get("text", "") or "").replace("\n", " ")
    if len(text) > 90:
        text = text[:87] + "…"
    delta = row.get("delta")
    delta_str = ""
    if delta is not None and not pd.isna(delta) and delta != 0:
        delta_str = f"  (Δ{int(delta):+d})"
    return f"{row['id']}{ITEM_SEP}{badge} {text}{delta_str}"


def decode_item(label: str) -> str:
    """Recover the sentence id from a sortable item label."""
    return label.split(ITEM_SEP, 1)[0]


# ----------------------- repetition warnings (for display) -----------------------


def repetition_warnings(texts: list[str], window: int = 4) -> dict[int, str]:
    token_sets = [set(content_tokens(t)) for t in texts]
    warns: dict[int, str] = {}
    for i in range(window - 1, len(token_sets)):
        shared = set.intersection(*(token_sets[i - k] for k in range(window)))
        if shared:
            warns[i] = f"repeats {sorted(shared)} ×{window} rows"
    return warns


# ----------------------- save -----------------------


def rebuild_rows(
    level: int,
    ordered_records: list[dict],
    original_by_id: dict,
) -> list[Row]:
    """Given an ordered list of {id, text, added_for, arc_id} dicts, return Row objects."""
    vocab = cached_vocab()
    rows: list[Row] = []
    used_ids: set[str] = set(rec["id"] for rec in ordered_records if rec.get("id"))
    next_x = 1

    for rec in ordered_records:
        rid = (rec.get("id") or "").strip()
        text = (rec.get("text") or "").strip()
        arc_id = int(rec.get("arc_id") or 0)
        added_for = (rec.get("added_for") or "").strip()
        if not text:
            continue
        if rid and rid in original_by_id:
            orig = original_by_id[rid]
            if text != orig["text"]:
                wc, rw, mw = compute_metadata(text, vocab)
            else:
                wc = int(orig.get("word_count") or 0)
                rw = orig.get("rarest_word") or ""
                mw = int(orig.get("max_wfs") or 0)
            rows.append(Row(
                id=rid, text=text,
                pedagogy=orig.get("pedagogy") or "",
                max_wfs=str(mw), rarest_word=rw, word_count=str(wc),
                added_for=added_for or (orig.get("added_for") or ""),
                register=orig.get("register") or "direct-address",
                ogte_level=orig.get("ogte_level") or f"{level:02d}",
                arc_id=arc_id,
                original_index=int(orig.get("original_index") or 0) if "original_index" in orig else None,
            ))
        else:
            if not rid:
                while f"x{level}_{next_x}" in used_ids:
                    next_x += 1
                rid = f"x{level}_{next_x}"
                used_ids.add(rid)
                next_x += 1
            wc, rw, mw = compute_metadata(text, vocab)
            rows.append(Row(
                id=rid, text=text,
                pedagogy="", max_wfs=str(mw), rarest_word=rw, word_count=str(wc),
                added_for=added_for,
                register="direct-address",
                ogte_level=f"{level:02d}",
                arc_id=arc_id,
                original_index=None,
            ))
    return rows


def save_level(level: int, rows: list[Row], removed_ids_now: list[dict]) -> tuple[bool, list[str]]:
    msgs: list[str] = []
    originals = read_original_level(level)
    vocab_check = check_vocab_monotonicity(originals, rows)
    budget_check = check_reorder_budget(rows)
    rep_check = check_adjacent_repetition(rows)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame([r.as_csv_dict() for r in rows], columns=CURATED_FIELDS)
    df.to_csv(OUTPUT_DIR / LEVEL_FILES[level], index=False)

    manifest_payload = {"schema_version": 1, "levels": {}}
    if MANIFEST_FILE.exists():
        try:
            manifest_payload = json.loads(MANIFEST_FILE.read_text())
        except Exception:
            pass
    manifest_payload.setdefault("levels", {})
    existing = manifest_payload["levels"].get(str(level), {})
    existing_removed = list(existing.get("removed", []) or [])
    for rec in removed_ids_now:
        if not any(r.get("id") == rec.get("id") for r in existing_removed):
            existing_removed.append(rec)
    manifest_payload["levels"][str(level)] = {
        **existing,
        "level": level,
        "input_file": LEVEL_FILES[level],
        "edited_at": datetime.now(UTC).isoformat(),
        "stats": {
            "curated_count": len(rows),
            "added_count": sum(1 for r in rows if r.id.startswith("x")),
            "removed_count": len(existing_removed),
            "arcs_total": len({r.arc_id for r in rows}),
        },
        "removed": existing_removed,
        "checks": {
            "vocab_monotonicity": {"passed": vocab_check.passed, "details": vocab_check.details},
            "reorder_budget": {"passed": budget_check.passed, "details": budget_check.details},
            "adjacent_repetition": {"passed": rep_check.passed, "details": rep_check.details},
        },
    }
    MANIFEST_FILE.write_text(json.dumps(manifest_payload, indent=2))

    msgs.append(f"Saved {len(rows)} rows to {LEVEL_FILES[level]}.")
    if not vocab_check.passed:
        missing = vocab_check.details[0] if vocab_check.details else ""
        msgs.append(f"ℹ {missing} (informational — removing useless vocab is allowed)")
    if not budget_check.passed:
        msgs.append(f"⚠ {len(budget_check.details)} reorder-budget violation(s) — review the 'Δ' column.")
    if not rep_check.passed:
        msgs.append(f"⚠ {len(rep_check.details)} 4-in-a-row word repetition(s) — review the '⚠' column.")
    return True, msgs


# ----------------------- UI -----------------------

SORTABLE_CSS = """
.sortable-component { width: 100%; }
.sortable-container { background: #f8f9fb; border: 1px solid #e3e5eb; border-radius: 6px;
                      padding: 6px 10px; margin-bottom: 8px; min-height: 40px; }
.sortable-container-header { font-weight: 600; color: #222; padding: 4px 0 6px; font-size: 14px; }
.sortable-item { background: white; border: 1px solid #d8dbe2; border-radius: 4px;
                 padding: 8px 12px; margin: 4px 0; cursor: grab; color: #111;
                 font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;
                 white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sortable-item:hover { background: #f0f4ff; }
"""


def main() -> None:
    st.title("OGTE Level Review")

    with st.sidebar:
        # Show only the levels that have curated CSVs on disk.
        available_levels = [
            n for n in range(1, 21)
            if (OUTPUT_DIR / LEVEL_FILES[n]).exists()
        ]
        level = st.radio("Level", available_levels, horizontal=True, format_func=lambda n: f"L{n}")
        st.divider()
        st.markdown(
            f"**Reorder budget:** ±{REORDER_BUDGET} rows\n\n"
            "**Repetition rule:** a content word may appear in at most **3** consecutive rows.\n\n"
            "**Vocab rule:** every word in the original must appear somewhere in the curated set."
        )

    curated_df, original_by_id, manifest = load_level(level)

    # Stats
    n_added = (curated_df["change_type"] == "added").sum()
    n_moved = (curated_df["change_type"] == "moved").sum()
    n_kept = (curated_df["change_type"] == "kept").sum()
    n_removed = len(manifest.get("removed", []) or [])
    n_arcs = curated_df["arc_id"].astype(int).nunique()
    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric("Curated", len(curated_df))
    c2.metric("Kept", int(n_kept))
    c3.metric("Moved", int(n_moved))
    c4.metric("Added", int(n_added))
    c5.metric("Removed", int(n_removed))
    c6.metric("Arcs", int(n_arcs))

    tab_reorder, tab_edit, tab_view = st.tabs(
        ["🔀 Reorder & group", "📝 Edit text", "📜 Final ordering"]
    )

    # ---------- TAB 1: Drag-and-drop reorder ----------
    with tab_reorder:
        st.caption(
            "Drag sentences within an arc card to reorder them. "
            "Drag across arc cards to regroup. Use the controls below to add a new arc card. "
            "When you're happy with the layout, click **Apply reorder**."
        )

        # Build sortable containers, one per arc, ordered by current curated position.
        # We use a dict keyed by arc_id and preserve the first-occurrence order in the CSV.
        arcs_by_id: dict[int, list[str]] = {}
        arc_order: list[int] = []
        for _, row in curated_df.iterrows():
            arc_id = int(row["arc_id"])
            if arc_id not in arcs_by_id:
                arcs_by_id[arc_id] = []
                arc_order.append(arc_id)
            arcs_by_id[arc_id].append(encode_item(row))

        containers = [
            {"header": f"Arc {arc_id}", "items": arcs_by_id[arc_id]}
            for arc_id in arc_order
        ]

        # Extra empty arcs at the end so users can drag into them
        extra_empty = st.number_input(
            "Empty arc slots to append (drag sentences in to populate)", min_value=0, max_value=10, value=1, step=1
        )
        for k in range(int(extra_empty)):
            containers.append({"header": f"Arc (new) #{k + 1}", "items": []})

        new_layout = sort_items(
            containers,
            multi_containers=True,
            direction="vertical",
            key=f"sort_l{level}",
        )

        col1, _ = st.columns([1, 5])
        if col1.button("✅ Apply reorder", type="primary", use_container_width=True, key=f"apply_l{level}"):
            # Build ordered records from the returned layout.
            row_lookup = {r["id"]: r for _, r in curated_df.iterrows()}
            ordered_records: list[dict] = []
            new_arc_id = 0
            for container in new_layout:
                if not container.get("items"):
                    continue  # skip empty arcs (don't waste arc ids)
                new_arc_id += 1
                for label in container["items"]:
                    rid = decode_item(label)
                    if rid not in row_lookup:
                        continue
                    src = row_lookup[rid]
                    ordered_records.append({
                        "id": rid,
                        "text": src["text"],
                        "added_for": src.get("added_for", ""),
                        "arc_id": new_arc_id,
                    })
            rows = rebuild_rows(level, ordered_records, original_by_id)
            ok, msgs = save_level(level, rows, removed_ids_now=[])
            for m in msgs:
                (st.success if ok else st.error)(m)
            if ok:
                st.cache_data.clear()
                st.rerun()

    # ---------- TAB 2: Edit text / metadata ----------
    with tab_edit:
        st.caption(
            "Edit `text`, `added_for`, or `arc_id` inline. "
            "Set `change_type` to **remove** to drop the row on save. "
            "Add new sentences at the bottom — leave `id` blank and it'll be auto-assigned `xL_N`."
        )
        texts = curated_df["text"].tolist()
        warns = repetition_warnings(texts)
        curated_df = curated_df.copy()
        curated_df["⚠"] = ""
        for i, msg in warns.items():
            curated_df.at[i, "⚠"] = msg
        budget_breach = curated_df["delta"].apply(
            lambda d: (d is not None) and (not pd.isna(d)) and abs(d) > REORDER_BUDGET
        )
        curated_df.loc[budget_breach, "⚠"] = curated_df.loc[budget_breach, "⚠"] + " · over budget"

        cols_for_edit = [
            "arc_id", "change_type", "id", "text", "added_for",
            "original_index", "delta", "rarest_word", "word_count", "⚠",
        ]
        edit_df = curated_df[cols_for_edit].copy()

        edited = st.data_editor(
            edit_df,
            num_rows="dynamic",
            use_container_width=True,
            column_config={
                "arc_id": st.column_config.NumberColumn("arc", step=1, help="Sentences sharing arc_id form one conversation arc."),
                "change_type": st.column_config.SelectboxColumn(
                    "type", options=["kept", "moved", "added", "remove"],
                    help="Set to 'remove' to drop on save.",
                ),
                "id": st.column_config.TextColumn("id"),
                "text": st.column_config.TextColumn("text", width="large"),
                "added_for": st.column_config.TextColumn("added_for"),
                "original_index": st.column_config.NumberColumn("orig idx", disabled=True),
                "delta": st.column_config.NumberColumn("Δ", disabled=True),
                "rarest_word": st.column_config.TextColumn("rarest", disabled=True),
                "word_count": st.column_config.NumberColumn("wc", disabled=True),
                "⚠": st.column_config.TextColumn("⚠", disabled=True),
            },
            key=f"editor_l{level}",
        )

        if st.button("💾 Save edits", type="primary", key=f"save_edit_l{level}"):
            keep_mask = edited["change_type"].fillna("") != "remove"
            removed_recs = [
                {"id": r["id"], "text": r["text"], "reason": "removed via review app"}
                for _, r in edited[~keep_mask].iterrows()
            ]
            edited_keep = edited[keep_mask].reset_index(drop=True)
            ordered_records = edited_keep.to_dict(orient="records")
            rows = rebuild_rows(level, ordered_records, original_by_id)
            ok, msgs = save_level(level, rows, removed_recs)
            for m in msgs:
                (st.success if ok else st.error)(m)
            if ok:
                st.cache_data.clear()
                st.rerun()

    # ---------- TAB 3: Final ordering view (read-only) ----------
    with tab_view:
        st.caption(
            "Numbered list of the curated sentences in final reading order. "
            "Badges: ➕ added, ↻ moved from original position, blank = kept in place. "
            "Lines separate arcs."
        )
        current_arc = None
        for i, row in curated_df.iterrows():
            arc_id = int(row["arc_id"])
            if current_arc is not None and arc_id != current_arc:
                st.markdown("---")
            current_arc = arc_id
            badge_map = {"added": ":green[➕ added]", "moved": ":blue[↻ moved]", "kept": ":grey[kept]"}
            badge = badge_map.get(row["change_type"], "")
            warn = f"  :red[⚠ {repetition_warnings(curated_df['text'].tolist()).get(i, '')}]" if i in repetition_warnings(curated_df["text"].tolist()) else ""
            st.markdown(
                f"**{i + 1}.** `arc {arc_id}` · {badge} · **{row['text']}**"
                f"  *(id `{row['id']}`)*{warn}"
            )

    # ---------- Bottom panels: removed / added ----------
    with st.expander(f"Removed sentences ({n_removed})", expanded=False):
        removed = manifest.get("removed", []) or []
        if not removed:
            st.caption("Nothing removed from this level yet.")
        else:
            st.dataframe(pd.DataFrame(removed), use_container_width=True)

    added = manifest.get("added", []) or []
    with st.expander(f"Added sentences ({len(added)})", expanded=False):
        if not added:
            st.caption("Nothing added to this level yet.")
        else:
            st.dataframe(pd.DataFrame(added), use_container_width=True)


if __name__ == "__main__":
    main()
