# Triage labels

The skills speak in terms of five canonical triage roles. This repo keeps the
canonical names as-is.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from this table.

## How labels are applied

Put the role in the card's `labels` array in `.devtool/features/`:

```yaml
labels: ["needs-triage"]
```

A card carries at most one triage label; replace the old one rather than
stacking them. If a longer spec lives in `.scratch/`, mirror it on a
`Status:` line near the top of that file.

If `.devtool/features/` is absent, the `Status:` line in `.scratch/` is the
source of truth.
