"""Loader for per-level OGTE curation plans.

Each level N has its own plan file `curation/plan_lN.py` that defines a single
top-level dict `L{N}_PLAN` with the shape:

    L{N}_PLAN = {
        "removals": [{"id": str, "reason": str}, ...],
        "arcs": [
            # Each arc is either:
            #   - a list of items (auto-positioned by min original_index), or
            #   - a dict {"position": "first" | "last", "items": [...]}
            # Each item is either:
            #   - a string id (keep this original sentence), or
            #   - a dict {"text": str, "added_for": str, "reason": str}
            #     (insert a new sentence; id is auto-assigned as x{N}_M).
            ...
        ],
    }

Sentences not removed and not in any arc are kept as singleton arcs in their
original position. Block ordering is by min(original_index) so reorders stay local.

This module imports every plan_lN.py it can find and exposes them via the
`PLANS` dict keyed by level number.

Curation philosophy:
- Remove sexist/demeaning generalizations, dated brand names, untranslatable
  idioms at beginner levels, and exact/near-duplicate sentences.
- Keep long sentences, common idioms (at higher levels), drama, mild crime,
  body parts, narratives, political content (non-country-specific), and useful
  proper names in moderation.
- Build short conversation arcs (2-5 sentences) so each pattern is seen in a
  natural question/answer/follow-up shape. Avoid drill patterns where one
  content word appears in 4+ consecutive rows.
"""

from __future__ import annotations


def _normalize(plan: dict) -> None:
    """Drop empty/single-item arcs and deduplicate removal entries by id."""
    cleaned_arcs = []
    for a in plan.get("arcs", []):
        if isinstance(a, dict):
            items = a.get("items", [])
            items = [it for it in items if isinstance(it, dict) or (isinstance(it, str) and it)]
            if len(items) >= 2:
                cleaned_arcs.append({**a, "items": items})
        else:
            items = [it for it in a if isinstance(it, dict) or (isinstance(it, str) and it)]
            if len(items) >= 2:
                cleaned_arcs.append(items)
    plan["arcs"] = cleaned_arcs
    seen = set()
    cleaned_removals = []
    for r in plan.get("removals", []):
        rid = r.get("id", "")
        reason = r.get("reason", "")
        if not rid or rid in seen:
            continue
        if "n/a" in reason.lower() or "placeholder" in reason.lower():
            continue
        seen.add(rid)
        cleaned_removals.append(r)
    plan["removals"] = cleaned_removals


PLANS: dict[int, dict] = {}
for _lvl in range(1, 21):
    try:
        _mod = __import__(f"curation.plan_l{_lvl}", fromlist=[f"L{_lvl}_PLAN"])
        PLANS[_lvl] = getattr(_mod, f"L{_lvl}_PLAN")
    except (ImportError, AttributeError):
        pass

for _p in PLANS.values():
    _normalize(_p)
