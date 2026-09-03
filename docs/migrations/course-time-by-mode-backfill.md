# Migration: course-level time-by-mode backfill

Status: **chained in `migrations:runAll`** (`convex/migrations.ts`), which runs
on every deploy via `pnpm build:deploy`. Deployment does **not** require it.

## Background

The home card's Time tile became tappable on 2026-09-01: like the Reps tile
it cycles all → learn → radio → free study, with its own
`userSettings.timeStatFilter`. Today's number could be split from
`dailyStats.timeMsByMode`, which the daily writers have carried since the
review-mode split, but the lifetime headline had only
`courseStats.totalTimeMs`. `courseStats.totalTimeMsByMode` (same four buckets
as `totalReviewsByMode`) was added; `recordReviewStats` and
`recordFreePlayStats` now stamp it on every review and free play.

## What the migration does

`courseStatsTimeByModeBackfill` walks `courseStats` and, for each row without
`totalTimeMsByMode`, sums `dailyStats.timeMsByMode` over that course's daily
rows and writes the result. Rows already carrying the field are skipped, so a
review that lands during the sweep is never overwritten. Idempotent.

Days written before `timeMsByMode` existed have no breakdown, so the sum can
be smaller than `totalTimeMs`. The tile derives learn time by subtraction
(`statForFilter` in `lib/statFilter.ts`), so that remainder shows as learn
time — the same rule the Reps tile uses for pre-free-play history.

Batch size is 10 (not the sweep default): each row reads a course's entire
daily history in one transaction.

## How it runs

```
npx convex deploy --cmd "pnpm run build" && npx convex run migrations:runAll --prod
npx convex run migrations:courseStatsTimeByModeBackfill '{"dryRun": true}'  # preview
npx convex run --component migrations lib:getStatus --watch                # progress
```

Until the sweep reaches a row, its Time tile shows the whole lifetime total
under every face except radio/free study, which read 0. No cleanup step
follows: the field stays optional because new `courseStats` rows are created
without it and stamped on the first review.
