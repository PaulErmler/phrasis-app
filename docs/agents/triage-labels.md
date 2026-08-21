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

Kanban checkbox cards have no label field, so a label is applied in two places:

- On the board, append it as an Obsidian tag to the card line:
  `- [ ] Fix audio gate — .scratch/audio-gate/ #needs-triage`
  A card carries at most one triage tag; replace the old one rather than
  stacking them.
- In the repo, mirror it on a `Status:` line near the top of the `.scratch/`
  spec or issue file the card points at.

If the board is unavailable (the symlink is absent on this machine), the
`Status:` line in `.scratch/` is the source of truth.

Edit the right-hand column above to match whatever vocabulary you actually use.
