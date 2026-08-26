/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bounds-sensitive file-level aggregate mock (takes precedence over the
// zero-count stub in tests/convexTestSetup.ts; extends the pattern from
// stats.test.ts). Tests register sorted due-date keys per
// `${track}|${namespaceTail}`; `count()` applies the requested upper bound
// (inclusive or exclusive) to them, which is exactly what the forecast's
// prefix-diff bucketing exercises. Lookup tries the two-segment tail first
// (`origin:state`) then the last segment (`state`).
const keysByTrackAndTail: Record<string, number[]> = {};
const countCalls: Array<{
  namespace: string;
  track: 'shared' | 'writing';
  upper?: { key: number; inclusive: boolean };
}> = [];

vi.mock('@convex-dev/aggregate', () => {
  class TableAggregate {
    private readonly track: 'shared' | 'writing';

    constructor(
      _component: unknown,
      opts?: { sortKey?: (doc: unknown) => unknown },
    ) {
      let probed: unknown;
      try {
        probed = opts?.sortKey?.({
          dueDate: 'shared',
          writingDueDate: 'writing',
        });
      } catch {
        probed = undefined;
      }
      this.track = probed === 'writing' ? 'writing' : 'shared';
    }

    async insertIfDoesNotExist(): Promise<void> {}
    async replaceOrInsert(): Promise<void> {}
    async deleteIfExists(): Promise<void> {}
    async count(
      _ctx: unknown,
      opts: {
        namespace: string;
        bounds?: { upper?: { key: number; inclusive: boolean } };
      },
    ): Promise<number> {
      const upper = opts.bounds?.upper;
      countCalls.push({ namespace: opts.namespace, track: this.track, upper });
      const parts = opts.namespace.split(':');
      const tail2 = parts.slice(-2).join(':');
      const tail1 = parts[parts.length - 1] ?? '';
      const keys =
        keysByTrackAndTail[`${this.track}|${tail2}`] ??
        keysByTrackAndTail[`${this.track}|${tail1}`] ??
        [];
      if (!upper) return keys.length;
      return keys.filter((k) =>
        upper.inclusive ? k <= upper.key : k < upper.key,
      ).length;
    }
  }
  return { TableAggregate };
});

import schema from '../../schema';
import { api } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import { addDays, startOfDayMs } from '../../../lib/dateStrings';

const modules = import.meta.glob('/convex/**/*.ts');

const TODAY = new Date().toISOString().slice(0, 10); // UTC, matches timezone arg
const B = Array.from({ length: 8 }, (_, k) =>
  startOfDayMs(addDays(TODAY, k), 'UTC'),
);
/** Deterministic "now" early in today's window — the query clamps into
 * [B[0], B[1]-1] anyway, so the actual test clock never matters. */
const NOW = B[0] + 1000;

const baseArgs = { timezone: 'UTC', today: TODAY, now: NOW };

beforeEach(() => {
  countCalls.length = 0;
  for (const key of Object.keys(keysByTrackAndTail)) {
    delete keysByTrackAndTail[key];
  }
});

async function seedActiveCourse(
  t: TestConvex<typeof schema>,
  settings: Partial<Doc<'courseSettings'>> = {},
) {
  return t.run(async (ctx) => {
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: 5,
      ...settings,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 0,
    });
    return { courseId, deckId };
  });
}

describe('getWorkloadForecast', () => {
  it('returns null unauthenticated and without an active course', async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.query(api.features.stats.getWorkloadForecast, baseArgs),
    ).toBeNull();
    const asUser = t.withIdentity({ subject: 'user_A' });
    expect(
      await asUser.query(api.features.stats.getWorkloadForecast, baseArgs),
    ).toBeNull();
  });

  it('buckets due dates into availableNow / laterToday / per-day windows', async () => {
    const t = convexTest(schema, modules);
    await seedActiveCourse(t);
    keysByTrackAndTail['shared|review'] = [
      B[0] - 100_000_000, // deep overdue backlog
      B[0] + 500, // earlier today, before now
      NOW, // exactly now — inclusive
      B[1] - 1, // last ms of today
      B[1], // first ms of tomorrow
      B[2] - 1, // last ms of tomorrow
      B[2], // day 2
      B[7] - 1, // last ms of day 6
      B[7], // day 7 — outside the window
    ];
    keysByTrackAndTail['shared|learning'] = [B[1]];

    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(
      api.features.stats.getWorkloadForecast,
      baseArgs,
    );
    expect(res).not.toBeNull();
    expect(res!.today).toBe(TODAY);
    expect(res!.dayStartMs).toBe(B[0]);
    expect(res!.availableNow.review).toBe(3);
    expect(res!.laterToday.review).toBe(1);
    expect(res!.futureDays).toHaveLength(6);
    expect(res!.futureDays[0].review).toBe(2);
    expect(res!.futureDays[0].learning).toBe(1);
    expect(res!.futureDays[1].review).toBe(1);
    expect(res!.futureDays[5].review).toBe(1);
    // B[7] never counted anywhere.
    const totalReview =
      res!.availableNow.review +
      res!.laterToday.review +
      res!.futureDays.reduce((s, d) => s + d.review, 0);
    expect(totalReview).toBe(8);
    // 4 states × 8 bounds for filter 'both', +4 stability buckets +1 guard
    // total for the observed-mix payload, +3 unbounded startedCards counts
    // (learning/relearning/review).
    expect(countCalls).toHaveLength(40);
    expect(countCalls.filter((c) => c.upper === undefined)).toHaveLength(3);
    expect(res!.preparingWriting).toBeUndefined();
    expect(res!.initialReviewCount).toBe(5);
    // startedCards: every registered non-'new' key regardless of due date
    // (all 9 review keys incl. the out-of-window B[7], + 1 learning).
    expect(res!.startedCards).toBe(10);
  });

  it("filter 'custom' fans out over the custom+chat origin namespaces", async () => {
    const t = convexTest(schema, modules);
    await seedActiveCourse(t);
    keysByTrackAndTail['shared|custom:review'] = [B[1]];
    keysByTrackAndTail['shared|chat:review'] = [B[1] + 5000];
    // State-only namespace must NOT be consulted under a filter.
    keysByTrackAndTail['shared|review'] = [B[1]];

    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(api.features.stats.getWorkloadForecast, {
      ...baseArgs,
      filter: 'custom',
    });
    expect(res!.futureDays[0].review).toBe(2);
    // 4 states × 8 bounds × 2 origins, +5 for the (unfiltered) mix counts,
    // +3 unbounded startedCards counts.
    expect(countCalls).toHaveLength(72);
    // The day bucketing goes through the origin namespaces only; the
    // stability mix and the gate are deliberately deck-wide (deck
    // properties, not filter-scoped ones).
    const originCalls = countCalls.filter((c) =>
      /:custom:|:chat:/.test(c.namespace),
    );
    expect(originCalls).toHaveLength(64);
    // startedCards stays filter-independent: unbounded counts over the
    // plain state namespaces, so toggling the content filter cannot lock
    // and unlock the card underneath the user.
    expect(
      countCalls
        .filter((c) => c.upper === undefined)
        .every((c) => !/:custom:|:chat:/.test(c.namespace)),
    ).toBe(true);
    expect(res!.startedCards).toBe(1); // the state-namespace review key
  });

  it('writing mode with separateModeTracking reads the writing aggregates and flags mid-seed counts', async () => {
    const t = convexTest(schema, modules);
    await seedActiveCourse(t, { separateModeTracking: true });
    keysByTrackAndTail['writing|review'] = [NOW];
    keysByTrackAndTail['shared|review'] = [NOW, NOW, NOW];

    const asUser = t.withIdentity({ subject: 'user_A' });
    const writing = await asUser.query(api.features.stats.getWorkloadForecast, {
      ...baseArgs,
      reviewMode: 'full',
    });
    expect(writing!.availableNow.review).toBe(1);
    // Day bucketing reads the writing aggregates; the stability-mix counts
    // stay on the shared track (the deck's mix stands proxy for writing).
    expect(countCalls.filter((c) => c.track === 'writing').length).toBe(35);
    expect(countCalls.filter((c) => c.track === 'shared').length).toBe(5);
    expect(writing!.preparingWriting).toBe(true);

    const audio = await asUser.query(api.features.stats.getWorkloadForecast, {
      ...baseArgs,
      reviewMode: 'audio',
    });
    expect(audio!.availableNow.review).toBe(3);
    expect(audio!.preparingWriting).toBeUndefined();
  });

  it('preparingWriting clears once the seed is done, and never applies to free play', async () => {
    const t = convexTest(schema, modules);
    await seedActiveCourse(t, {
      separateModeTracking: true,
      writingSeedDone: true,
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    const done = await asUser.query(api.features.stats.getWorkloadForecast, {
      ...baseArgs,
      reviewMode: 'full',
    });
    expect(done!.preparingWriting).toBeUndefined();

    const t2 = convexTest(schema, modules);
    await seedActiveCourse(t2, {
      separateModeTracking: true,
      schedulingMode: 'radio',
    });
    const asUser2 = t2.withIdentity({ subject: 'user_A' });
    const freePlay = await asUser2.query(
      api.features.stats.getWorkloadForecast,
      { ...baseArgs, reviewMode: 'full' },
    );
    // Free Study resolves to track 'writing' but is served from the
    // rotation; its counts must not be flagged provisional.
    expect(freePlay!.preparingWriting).toBeUndefined();
  });

  it('sums the trailing window of complete days, today and day −15 excluded', async () => {
    const t = convexTest(schema, modules);
    const { courseId } = await seedActiveCourse(t);
    const mkDay = (
      date: string,
      reps: number,
      extra: Partial<Doc<'dailyStats'>> = {},
    ) =>
      t.run((ctx) =>
        ctx.db.insert('dailyStats', {
          userId: 'user_A',
          courseId,
          date,
          reps,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: 0,
          ...extra,
        }),
      );
    await mkDay(TODAY, 99); // excluded: partial day
    await mkDay(addDays(TODAY, -1), 5, {
      newCards: 2,
      timeMs: 60_000,
      cardsReviewed: 4,
      reviewsByMode: { audio: 3, full: 2 },
      timeMsByMode: { audio: 20_000, full: 40_000 },
      ratingCounts: {
        stillLearning: 1,
        understood: 1,
        again: 1,
        hard: 0,
        good: 2,
        easy: 0,
      },
    });
    await mkDay(addDays(TODAY, -14), 3, { newCards: 1, timeMs: 30_000 });
    await mkDay(addDays(TODAY, -15), 42); // excluded: before the window
    await mkDay(addDays(TODAY, -3), 0); // inside window but inactive

    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(
      api.features.stats.getWorkloadForecast,
      baseArgs,
    );
    expect(res!.history.windowDays).toBe(14);
    expect(res!.history.activeDays).toBe(2);
    expect(res!.history.reps).toBe(8);
    expect(res!.history.newCards).toBe(3);
    expect(res!.history.timeMs).toBe(90_000);
    expect(res!.history.cardsReviewed).toBe(4);
    expect(res!.history.reviewsByMode).toEqual({ audio: 3, full: 2 });
    expect(res!.history.timeMsByMode).toEqual({ audio: 20_000, full: 40_000 });
    // Rows without ratingCounts contribute zeros, not NaN.
    expect(res!.history.ratingCounts).toEqual({
      stillLearning: 1,
      understood: 1,
      again: 1,
      hard: 0,
      good: 2,
      easy: 0,
    });
  });

  it('returns matureStabilityCounts when the bucket aggregate covers the review total', async () => {
    const t = convexTest(schema, modules);
    await seedActiveCourse(t);
    keysByTrackAndTail['shared|review'] = [NOW, B[1], B[2], B[3]];
    keysByTrackAndTail['shared|s1'] = [NOW, B[1]];
    keysByTrackAndTail['shared|s2'] = [B[2]];
    keysByTrackAndTail['shared|s3'] = [B[3], B[7]]; // B[7] outside the window

    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(
      api.features.stats.getWorkloadForecast,
      baseArgs,
    );
    expect(res!.matureStabilityCounts).toEqual({ s0: 0, s1: 2, s2: 1, s3: 1 });
  });

  it('omits matureStabilityCounts while the backfill has not covered the deck', async () => {
    const t = convexTest(schema, modules);
    await seedActiveCourse(t);
    // Plenty of review cards due, but the bucket aggregate only knows about
    // a fraction of them — the mid-backfill shape.
    keysByTrackAndTail['shared|review'] = [NOW, NOW, NOW, NOW, NOW, NOW];
    keysByTrackAndTail['shared|s0'] = [NOW];

    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(
      api.features.stats.getWorkloadForecast,
      baseArgs,
    );
    expect(res).not.toBeNull();
    expect(res!.matureStabilityCounts).toBeUndefined();
  });

  it('clamps a skewed client now into today and a drifted today to the server day', async () => {
    const t = convexTest(schema, modules);
    await seedActiveCourse(t);
    keysByTrackAndTail['shared|review'] = [B[0] + 500];

    const asUser = t.withIdentity({ subject: 'user_A' });
    // `now` from yesterday clamps to today's start: the key is later today.
    const res = await asUser.query(api.features.stats.getWorkloadForecast, {
      ...baseArgs,
      now: B[0] - 86_400_000,
    });
    expect(res!.availableNow.review).toBe(0);
    expect(res!.laterToday.review).toBe(1);

    // A client `today` two days ahead falls back to the server's day.
    const drifted = await asUser.query(api.features.stats.getWorkloadForecast, {
      ...baseArgs,
      today: addDays(TODAY, 2),
    });
    expect(drifted!.today).toBe(TODAY);

    // Invalid timezone falls back to UTC boundaries.
    const invalidTz = await asUser.query(
      api.features.stats.getWorkloadForecast,
      { ...baseArgs, timezone: 'Not/AZone' },
    );
    expect(invalidTz!.dayStartMs).toBe(B[0]);
  });

  it('buckets across a spring-forward DST transition with a 23h day (non-UTC)', async () => {
    // Europe/Berlin, 2026-03-29: clocks jump 02:00 → 03:00. Every other
    // case in this file runs in UTC, so the 8-boundary loop had never been
    // exercised with unequal day lengths.
    const TZ = 'Europe/Berlin';
    const DST_TODAY = '2026-03-29';
    const DB = Array.from({ length: 8 }, (_, k) =>
      startOfDayMs(addDays(DST_TODAY, k), TZ),
    );
    expect(DB[1] - DB[0]).toBe(23 * 3_600_000); // the shortened day

    const t = convexTest(schema, modules);
    await seedActiveCourse(t);
    // One review at the last ms of the 23h day, one at the first ms of the
    // next: a naive 24h boundary would put both in the same bucket.
    keysByTrackAndTail['shared|review'] = [DB[1] - 1, DB[1]];

    // Pin the server clock inside that day so resolveClientToday's ±1-day
    // validation accepts the fixed `today` (all other cases use the real
    // clock with a dynamic TODAY).
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(DB[0] + 60_000);
    try {
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(api.features.stats.getWorkloadForecast, {
        timezone: TZ,
        today: DST_TODAY,
        now: DB[0] + 60_000,
      });
      expect(res!.today).toBe(DST_TODAY);
      expect(res!.dayStartMs).toBe(DB[0]);
      expect(res!.laterToday.review).toBe(1);
      expect(res!.futureDays[0].review).toBe(1);
      expect(res!.availableNow.review).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('returns all-zero buckets and startedCards 0 for a course with no cards', async () => {
    const t = convexTest(schema, modules);
    await seedActiveCourse(t);
    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(
      api.features.stats.getWorkloadForecast,
      baseArgs,
    );
    expect(res).not.toBeNull();
    const zero = { new: 0, learning: 0, relearning: 0, review: 0 };
    expect(res!.availableNow).toEqual(zero);
    expect(res!.laterToday).toEqual(zero);
    expect(res!.futureDays).toEqual(Array.from({ length: 6 }, () => zero));
    expect(res!.history.reps).toBe(0);
    // No aggregate keys registered at all — the client's minimum-activity
    // gate sees a fresh course and locks the card.
    expect(res!.startedCards).toBe(0);
  });
});
