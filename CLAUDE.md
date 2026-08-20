<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Changelog

After completing a change that alters user-visible behavior, create an entry
file `changelog/unreleased/YYYY-MM-DD-<slug>.md` following the format in
`changelog/README.md` (1–2 sentences, written for the end user, no code
jargon). Skip internal refactors, tests, CI/tooling, and dependency bumps.
The entries are rolled up monthly into a user-facing summary via the
`/changelog-roll` skill.

## Kanban board

The project kanban board lives at `board/Flexling Board.md` (a gitignored
symlink into Paul's Obsidian vault; may be absent on other machines). Columns:
Not Started, Prioritized, Doing, Done, Archived — cards are `- [ ] item`
lines under the `##` column headings. When explicitly working on a board
item you may move it to Doing/Done, but never add priorities or reorder the
Prioritized column — prioritization is Paul's job.

## Agent skills

### Issue tracker

Issues are tracked as cards on the Obsidian kanban board (`board/Flexling
Board.md`, see above), with spec and issue bodies in `.scratch/<feature-slug>/`.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged, applied as Obsidian tags on the card and
mirrored on a `Status:` line in `.scratch/`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root, created lazily
by `/domain-modeling`. See `docs/agents/domain.md`.
