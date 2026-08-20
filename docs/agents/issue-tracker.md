# Issue tracker: Obsidian kanban board

Work for this repo is tracked on `board/Flexling Board.md` — a gitignored
symlink into Paul's Obsidian vault. It may be absent on other machines; if it
is, say so and fall back to `.scratch/` rather than inventing a queue.

## Structure

Columns are `##` headings: Not Started, Prioritized, Doing, Done, Archived.
Each card is a single `- [ ] <one-line summary>` under a column.

**Never add priorities or reorder the Prioritized column** — prioritization is
Paul's job. Moving a card you were explicitly asked to work on into Doing or
Done is fine.

## Cards are titles, not bodies

A card is one line. Anything longer — a spec, an issue with acceptance
criteria, a wayfinder map — lives in the repo:

- One effort per directory: `.scratch/<feature-slug>/`
- Spec: `.scratch/<feature-slug>/spec.md`
- Issues: one file per ticket at
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a
  single combined tickets file
- The board card links to it:
  `- [ ] Fix audio gate — .scratch/audio-gate/`

## When a skill says "publish to the issue tracker"

Write the file under `.scratch/<feature-slug>/` (creating the directory if
needed), then add a `- [ ]` card under **Not Started** on the board pointing at
that directory. Never file it under Prioritized.

## When a skill says "fetch the relevant ticket"

Read the `.scratch/` file the card points at. Paul will normally pass the path
or the card text directly.

## GitHub Issues

The repo has ~101 GitHub issues, last touched Feb 2026. Treat them as an
archive: read them for history, don't file new work there.

## PRs as a request surface

Off. Incoming PRs are not part of the triage queue.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`,
  with the question in the body. A `Type:` line records the ticket type
  (`research`/`prototype`/`grilling`/`task`); a `Status:` line records
  `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked
  when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open,
  unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set
  `Status: resolved`, then append a context pointer (gist + link) to the map's
  Decisions-so-far in `map.md`.
