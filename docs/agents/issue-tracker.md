# Issue tracker: `.devtool/features`

Work for this repo is tracked in `.devtool/features/` (gitignored). One
markdown file per card. If that directory is absent, say so and fall back
to `.scratch/` rather than inventing a queue.

## Cards

Each card is a file named `<slug>-YYYY-MM-DD.md` (or `<slug>-YYYY-MM-DD-N.md`
on a collision) with YAML frontmatter and a `# Title` body:

```yaml
id: "the-same-slug-as-the-filename-stem"
status: "todo"          # todo | backlog | in-progress | review | done
priority: "medium"      # low | medium | high | critical
assignee: null
epic: null
dueDate: null
created: "2026-08-29T06:20:00.000Z"
modified: "2026-08-29T06:20:00.000Z"
completedAt: null
labels: []
order: "a7"             # lex order within the status column; append, don't reshuffle
```

- New work: add a file under `.devtool/features/` with `status: todo` (or
  `backlog` when that is what was asked). Never invent a second board.
- Do not change `priority` or `order` on existing cards. Prioritization is
  Paul's job.
- When explicitly working a card, you may set `status: in-progress`.
- When the work is finished, set `status: review` and leave the card where it
  is. `review` means done but awaiting Paul's sign-off; it is not `done`, and a
  card in it must not be moved to `.devtool/features/done/`.
- Only Paul closes a card: `status: done`, `completedAt` filled, file moved to
  `.devtool/features/done/`. Do that yourself only when explicitly asked to.

## Cards vs longer specs

A card body is the ticket. A spec, acceptance criteria, or wayfinder map
that outgrows that can live in the repo:

- One effort per directory: `.scratch/<feature-slug>/`
- Spec: `.scratch/<feature-slug>/spec.md`
- Issues: one file per ticket at
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`. Never a
  single combined tickets file
- Point at it from the card body if both exist.

## When a skill says "publish to the issue tracker"

Write a new `.devtool/features/<slug>-YYYY-MM-DD.md` card. If the work also
needs a longer spec, create `.scratch/<feature-slug>/` and link it from the
card. Never file it as `in-progress` unless you were asked to start it.

## When a skill says "fetch the relevant ticket"

Read the `.devtool/features/` card (and any `.scratch/` file it points at).
Paul will normally pass the path or the card title directly.

## GitHub Issues

The repo has ~101 GitHub issues, last touched Feb 2026. Treat them as an
archive: read them for history, don't file new work there.

## PRs as a request surface

Off. Incoming PRs are not part of the triage queue.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md`, holding the Notes / Decisions-so-far /
  Fog body.
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
