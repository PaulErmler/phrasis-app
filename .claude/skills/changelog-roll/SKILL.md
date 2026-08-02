---
name: changelog-roll
description:
  Rolls up changelog/unreleased/ entries into a monthly user-facing summary
  (changelog/<YYYY-MM>.md) and archives the entries. Use at the end of each
  month, or when Paul asks for a user-facing summary of recent changes.
---

# Changelog Roll

Compile the month's user-facing changes into a summary Paul can send to
Flexling users. The framework rules live in `changelog/README.md` — read
them first.

## Steps

1. **Determine the month.** Default: the month of the oldest entry in
   `changelog/unreleased/` (usually the month that just ended). If Paul named
   a month in the request, use that.

2. **Read all entries** in `changelog/unreleased/*.md`.

3. **Cross-check git for misses.** Run
   `git log --since=<first day of month> --until=<first day of next month> --oneline --no-merges`
   and compare against the entries. For commits that look user-facing but
   have no entry, draft one (following the entry format in
   `changelog/README.md`) and save it to `changelog/unreleased/` before
   rolling up. Skip anything internal (refactors, tests, CI, deps). If it's
   genuinely unclear whether a change is user-facing, ask Paul rather than
   guessing.

4. **Write `changelog/<YYYY-MM>.md`** — the user-facing summary:
   - A one-line friendly intro (varies month to month, no boilerplate).
   - Sections **New**, **Improved**, **Fixed** (omit empty sections), each a
     short bullet list distilled from the entries.
   - Voice: Paul writing personally to his users — warm, plain language,
     benefit-first, no jargon. Match the tone of the welcome email in
     `convex/lib/welcomeEmail.ts`.
   - Merge closely-related entries into one bullet; drop anything that turns
     out not to matter to users.

5. **Archive the entries.** Move every rolled-up file from
   `changelog/unreleased/` to `changelog/released/<YYYY-MM>/`.

6. **Show Paul the summary** in the final message so he can copy it straight
   into an email, and mention anything you dropped or were unsure about.

Do not commit anything — Paul commits when he's ready.
