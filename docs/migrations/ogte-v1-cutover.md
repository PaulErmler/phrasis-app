# OGTE V1 Migration Runbook

How to migrate the production app from the legacy 7-collection course
(`Essential`, `A1`..`C2`) to the OGTE 20-level course
(`Pre-A1`, `A1.1`–`A1.3`, …, `C2.1`–`C2.4`) without disrupting users.

The migration is **additive and reversible**: legacy collections and their
`collectionProgress` rows are never modified or deleted; the new dataset is
uploaded alongside, then activated. Per-user counters are rolled forward by
CEFR tier so users immediately see credit for their previous learning on the
new home view.

## Mental model

- **`datasets` table**: each upload is one row. One row per language is
  `isActive: true`; the home view reads only that dataset's collections.
- **`collections.datasetId`**: links a collection to the dataset that created
  it. Legacy rows have `datasetId === undefined`.
- **`collectionProgress` counters are monotonic**: `cardsAdded`,
  `cardsLearned`, `cardsMastered` only ever increase. Deleting a card or
  demastering one is a no-op for the counters.
- **Cutover roll-forward**: when a dataset activates, each user's legacy CEFR
  collection counters are *added* into the first level of the matching new
  CEFR tier (`Essential` → `L01`, `A1` → `L02`, `A2` → `L05`, `B1` → `L08`,
  `B2` → `L11`, `C1` → `L14`, `C2` → `L17`).
- **`courseSettings.reconciledDatasetId`** acts as the idempotency gate.
  `cutoverUser` no-ops if it already matches the target dataset.
- **`FF_NEW_COURSE_CUTOVER` env var** must be `true` for the activation
  mutation to schedule the per-user fan-out. Without it, you can still flip
  `isActive`, but no `cutoverUser` jobs will run.

## Files involved

| Purpose | Path |
|---|---|
| Dataset upload action | `convex/admin/uploadDataset.ts` |
| Dataset activation + cutover trigger | `convex/admin/activateDataset.ts` |
| Per-user cutover migration | `convex/migrations/datasetMigration_cutoverUser.ts` |
| `cardsMastered` backfill (one-time) | `convex/migrations/datasetMigration_backfillCardsMastered.ts` |
| `collections.origin` + `cards.collectionOrigin` backfill (one-time) | `convex/admin/backfillCollectionOrigin.ts` |
| Home view query | `convex/features/home.ts` (filters to active dataset) |
| Schema | `convex/schema.ts` (`datasets`, `collections.datasetId`, `collections.origin`, `cards.collectionOrigin`, `courseSettings.reconciledDatasetId`, `courseSettings.studyContentFilter`) |
| Upload CLI | `scripts/uploadOgteV1.mjs` |
| Source CSVs | `data_preparation/ogte-dataset/data/output/levels_curated/ogte_*.csv` |

## Prerequisites

- The Convex deployment has Phase 1 & 2 schema/code deployed
  (extended `collections`, `collectionProgress.cardsMastered`,
  `patchCard` mastery hook).
- The frontend with the segmented home view is deployed.
- The OGTE source CSVs have been regenerated with deterministic curation IDs
  (`c-<hex>`). The pipeline in `data_preparation/ogte-dataset/curation/curate.py`
  produces these automatically.

## Step 1 — One-time `cardsMastered` backfill

Required *once per environment*. Populates `cardsMastered` on existing
`collectionProgress` rows by counting current mastered cards. Skipped rows
(where `cardsMastered` is already set) make re-runs free.

```bash
npx convex run migrations/datasetMigration_backfillCardsMastered:run
```

The mutation schedules itself in `BATCH_SIZE=50` chunks via
`ctx.scheduler.runAfter` until done. Watch the **Functions** tab of the
Convex dashboard for `processBatch` invocations.

If the database has zero `collectionProgress` rows (fresh staging), the
backfill finishes in one batch with `processed: 0`.

## Step 1b — One-time content-origin backfill

Also required *once per environment*, alongside Step 1. Powers the
content-source filter feature (`courseSettings.studyContentFilter`) by
stamping every existing `collection` with an explicit `origin` and every
existing `card` with its denormalized `collectionOrigin` + `collectionId`.

Going forward, all new collection/card inserts already write these fields
directly (see `convex/db/collections.ts`, `convex/admin/uploadDataset.ts`,
`convex/features/decks.ts:createCardsFromTexts`), so the backfill only
touches rows that pre-date the deploy. Both phases are idempotent on the
field-undefined check — re-runs are free.

### Phase A — collections

Small one-pass mutation (tens to low hundreds of rows). Classifies each
collection:

- `datasetId !== undefined` OR `legacy === true` → `'premade'`
- `_id` matches some `courseSettings.chatCollectionId` → `'chat'`
- otherwise → `'custom'`

```bash
npx convex run admin/backfillCollectionOrigin:runCollectionsOriginBackfill
```

Returns `{ processed, updated, classified: { premade, custom, chat } }`.
Verify `updated > 0` on first run, `updated === 0` on the second.

### Phase B — cards

Paginated batch processor (`CARDS_BATCH_SIZE = 200`, self-schedules until
done). For each card missing `collectionId` or `collectionOrigin`, reads
the source text → collection and patches both fields. A per-batch cache
keys on `collectionId` so cards from the same OGTE level only require one
collection read across the whole batch.

```bash
npx convex run admin/backfillCollectionOrigin:runCardsBackfill
```

The action returns `{ status: 'started' }`. Watch the **Functions** tab
for `processCardsBatch` invocations until they stop firing. For ~100k
cards expect a few minutes total.

**Must run Phase A before Phase B** — Phase B reads `collection.origin`
from Phase A's output.

### Tightening the schema (separate follow-up PR)

After both phases have run cleanly and the dashboard confirms zero
undefined values (check `collections` filtered by `origin === undefined`
and `cards` filtered by `collectionOrigin === undefined`), drop the
`v.optional()` wrappers in `convex/schema.ts`:

- `collections.origin`
- `cards.collectionId`
- `cards.collectionOrigin`

This ships as its own deploy so a stuck backfill can't break writes.

## Step 2 — Upload the OGTE dataset (inactive)

```bash
node scripts/uploadOgteV1.mjs --version 1.0.0
```

What happens:

1. `createOrGetDataset` upserts a `datasets` row by `(slug, version)` with
   `isActive: false`. **Save the printed `Dataset id: <id>`** — you need it
   for step 3.
2. For each of the 20 levels, `upsertDatasetCollection` upserts a
   `collections` row keyed by `(datasetId, order)`, setting `code`,
   `cefrTier`, `order`, `displayName`, `name`.
3. `batchUpsertDatasetTexts` upserts ~20k `texts` rows in batches of 500,
   keyed by `(datasetId, externalId)`. New rows get `language: 'en'`,
   `userCreated: false`, `register` mapped from the CSV's `formality` column.

Re-running with the same `--version` is safe — texts are upserted in place,
collection metadata is patched, and no duplicates are created.

To re-upload with different display names or a new dataset version, change
the `LEVELS` array in `scripts/uploadOgteV1.mjs` (for display tweaks) or pass
a different `--version` (for a new dataset row).

## Step 3 — Verify the upload landed but is not yet referenced

```bash
# In the Convex dashboard data tab:
#   - `datasets`: new row, isActive: false
#   - `collections`: 20 rows with datasetId set, code L01..L20
#   - `texts`: ~20k rows with the new datasetId
```

The home view will still render the legacy 7-collection view because
`convex/features/home.ts:getActiveDataset` returns `null` (no active dataset
for English yet) and the query falls back to legacy rows only.

## Step 4 — Activate + fan out the per-user cutover

```bash
# Enable the cutover flag — the activation mutation refuses to schedule
# without it, so accidental dashboard clicks cannot fan out across users.
npx convex env set FF_NEW_COURSE_CUTOVER true

# Flip isActive AND schedule cutoverAllUsers in one call.
npx convex run admin/activateDataset:activateDataset \
  '{"datasetId":"<id from step 2>","runCutover":true}'
```

What happens server-side:

1. The dataset's `isActive` flips to `true`; any other active dataset for the
   same language flips to `false`. **The home query immediately switches** —
   users with the app open will see the 20-level view on the next subscription
   tick.
2. `cutoverAllUsers` paginates over `courses` (25 per page) and schedules
   `cutoverUser` for each (50ms stagger per course, then next page).
3. Each `cutoverUser` mutation:
   - Short-circuits if `courseSettings.reconciledDatasetId === datasetId`.
   - Walks the 7 legacy CEFR collections, reads each `collectionProgress`
     row for this user/course, and **adds** the counters into the new
     first-of-tier collection's row (Essential→L01, A1→L02, A2→L05, B1→L08,
     B2→L11, C1→L14, C2→L17). Get-or-create per destination row.
   - Remaps `courses.currentLevel` if it points at a legacy CEFR string.
   - Remaps `courseSettings.activeCollectionId` if it points at a legacy
     collection.
   - Sets `courseSettings.reconciledDatasetId` to the target dataset id.

Watch the **Functions** tab during the fan-out. For ~10k active courses the
fan-out completes in roughly `10000 × 50ms ≈ 8 minutes`, plus whatever each
`cutoverUser` takes (small — single-digit ms typical).

## Step 5 — Verify

For a representative user with prior legacy progress:

1. Open the **Data** tab in the Convex dashboard, filter `collectionProgress`
   by `userId`. Confirm:
   - The legacy rows (`Essential`, `A1`..`C2`) still exist with the original
     counter values.
   - New rows exist for L01/L02/L05/L08/L11/L14/L17 with counters carrying
     the rolled-forward values.
2. Confirm `courseSettings.reconciledDatasetId` matches the new dataset id.
3. In the app, the home view should show 20 chips in 7 CEFR bands and the
   focused-level detail card should reflect the per-tier blurb.
4. FSRS state on cards (`dueDate`, `fsrsState`) should be **byte-identical**
   pre/post cutover — we don't touch any `cards` row.

## Re-running cutover for a single user

If you wipe a user's new-collection rows during testing, clear their
`courseSettings.reconciledDatasetId` (via the dashboard) and re-trigger the
fan-out:

```bash
npx convex run admin/activateDataset:runCutoverNow \
  '{"datasetId":"<id>"}'
```

`runCutoverNow` requires `FF_NEW_COURSE_CUTOVER=true`. It schedules
`cutoverAllUsers` which paginates all courses but skips already-reconciled
ones — only the cleared user runs.

## Rollback

Two reversible knobs:

1. **Flip `isActive` back to `false`** on the new dataset (via dashboard).
   The home query immediately reverts to the legacy 7-collection view. Per-user
   roll-forward counters stay where they are but become invisible (only the
   active dataset's collections are surfaced).
2. **Toggle the segmented home view off** by reverting the frontend to render
   the old `CollectionCarousel` + `CustomCollectionCarousel`. Since
   `getCollectionProgress` still returns the legacy rows, the old UI continues
   to function.

No data is destroyed at any step — the migration is purely additive.

## Production rollout (recommended sequencing)

1. **Weekday deploy 1** — Phase 1 schema + Phase 2 hooks + `cardsMastered`
   backfill. Silent: no behavior change.
2. **Weekday deploy 2** — Phase 5 segmented home view + Phase 6 collection
   helpers, behind a feature flag if desired. Silent: legacy fallback still
   renders the 7-collection view because no dataset is active.
3. **Off-hours** — Run `node scripts/uploadOgteV1.mjs --version 1.0.0`
   against production. Dataset lands with `isActive: false`; no user
   visibility.
4. **Off-hours, low-traffic window** — `npx convex env set
   FF_NEW_COURSE_CUTOVER true` then call `activateDataset` with
   `runCutover: true`. Monitor for ~30 minutes.
5. **Several days later** — Once active-user metrics are stable, optionally
   mark legacy collections `legacy: true` (cosmetic only — they're already
   hidden) and remove the legacy fallback branch in
   `convex/features/home.ts`.

## Known edge cases

- **Counter overflow (> 100%)**: legacy `A1` had ~295 sentences and rolls
  into `L02`, which has ~1k texts of its own. Some users may have
  `cardsAdded > totalTexts` on the destination level if they had a lot of
  legacy progress on a smaller-mapped CEFR collection. The home view clamps
  display percentages to 100%, but the underlying counter is not clamped on
  write (we want to preserve the full historical credit for future
  re-rolls).
- **Users mid-review during activation**: `cards` are never touched; FSRS
  scheduling continues uninterrupted. The user's `activeCollectionId` may
  remap from a legacy collection to its new first-of-tier collection between
  reviews. Auto-add will then pull from the new collection on the next batch.
- **Users with `currentLevel` set to a legacy CEFR string**: remapped to the
  corresponding L-code during `cutoverUser`. Defensive — onboarding hasn't
  written CEFR strings into `currentLevel` for years, so most rows will not
  trigger this branch.
- **Curation IDs in `levels_curated/`**: if the upstream dataset was
  regenerated with `data_preparation/ogte-dataset/curation/curate.py`,
  `externalId`s are deterministic (`c-<16hex>` = sha256 of text|level). Older
  `x{level}_{n}` IDs from earlier regenerations are unstable across runs and
  should not be uploaded to production; regenerate first.
