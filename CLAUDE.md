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

The project kanban board lives at `.devtool/features/` (gitignored). One
markdown file per card, with YAML frontmatter (`status`, `priority`, `order`).
Statuses: `todo`, `backlog`, `in-progress`, `review`, `done`. Finished work
goes to `review` and stays put; only Paul moves a card to `done` and into
`.devtool/features/done/`. Never invent a second queue; never reorder or
reprioritize existing cards — prioritization is Paul's job.

## Agent skills

### Always use these two

- **Writing a plan** — run `/unslop` over it before showing it. Every plan, not
  just long ones.
- **Reviewing code** — use `/mattpocock-skills:code-review`, never an ad-hoc
  read-through. It reviews on two axes (repo standards, and fidelity to the
  originating card or spec) and reports them separately.

### Issue tracker

Issues are tracked as cards in `.devtool/features/` (see above). Longer specs
or wayfinder maps can live in `.scratch/<feature-slug>/`. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged, applied in the card's `labels` array
and mirrored on a `Status:` line in `.scratch/` when a spec exists. See
`docs/agents/triage-labels.md`.

### Domain docs

One context, so `CONTEXT.md` and `docs/adr/` live at the repo root, created
lazily by `/domain-modeling`. See `docs/agents/domain.md`.
