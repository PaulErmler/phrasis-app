# Changelog framework

User-facing change tracking for Flexling. Each month the entries collected
here are rolled up into a summary Paul sends to users (email / in-app post).

## Structure

```
changelog/
  README.md              ← this file: the rules
  unreleased/            ← one file per user-facing change, added as you work
  released/<YYYY-MM>/    ← entries moved here by the monthly rollup
  <YYYY-MM>.md           ← the monthly user-facing summary
```

## When to add an entry

Add a file to `changelog/unreleased/` **after completing a change that alters
user-visible behavior**: new features, visible improvements, user-noticeable
fixes, pricing/limit changes, new languages, etc.

Do **not** add entries for internal work: refactors, tests, CI/tooling,
dependency bumps, performance work with no perceptible effect, or docs.
Git history already covers those. When genuinely unsure, add the entry —
the monthly rollup can drop it.

## Entry format

Filename: `YYYY-MM-DD-<short-slug>.md` (date = when the change was made).

```markdown
---
date: 2026-07-30
type: added        # added | improved | fixed
area: onboarding   # free-form: onboarding, audio, review, billing, languages, ...
---
New learners now get a personal welcome email from Paul one day after signing up.
```

Body rules:

- 1–2 sentences, written **for the end user** — benefit first.
- No code jargon, file names, or internal component names.
- Present tense ("You can now…", "Fixed an issue where…").
- One entry per user-facing change; don't bundle unrelated changes.

## Monthly rollup

Run `/changelog-roll` (skill in `.claude/skills/changelog-roll/`). It:

1. Reads all `changelog/unreleased/*.md` entries.
2. Cross-checks the month's git log for user-facing changes that got no
   entry and drafts the misses.
3. Writes `changelog/<YYYY-MM>.md` — a friendly summary grouped by
   New / Improved / Fixed, ready to paste into a user email.
4. Moves the rolled-up entries to `changelog/released/<YYYY-MM>/`.
