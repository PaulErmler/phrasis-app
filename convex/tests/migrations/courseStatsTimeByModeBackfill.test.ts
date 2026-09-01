/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../../schema';
import {
  courseStatsTimeByModeBackfillOne,
  sumDailyTimeMsByMode,
} from '../../migrations';
import type { Id } from '../../_generated/dataModel';

const modules = import.meta.glob('/convex/**/*.ts');

const day = (
  date: string,
  timeMs: number,
  timeMsByMode?: {
    audio: number;
    full: number;
    radio?: number;
    freeStudy?: number;
  },
) => ({
  userId: 'user_A',
  date,
  reps: 1,
  newCards: 0,
  timeMs,
  cardsReviewed: 1,
  ...(timeMsByMode ? { timeMsByMode } : {}),
});

describe('sumDailyTimeMsByMode', () => {
  it('adds every bucket across days and treats missing buckets as zero', () => {
    expect(
      sumDailyTimeMsByMode([
        { timeMsByMode: { audio: 100, full: 50, radio: 20 } },
        { timeMsByMode: { audio: 10, full: 0, freeStudy: 5 } },
        // A day from before the daily split existed.
        {},
      ]),
    ).toEqual({ audio: 110, full: 50, radio: 20, freeStudy: 5 });
  });

  it('is all zeros for a course with no daily history', () => {
    expect(sumDailyTimeMsByMode([])).toEqual({
      audio: 0,
      full: 0,
      radio: 0,
      freeStudy: 0,
    });
  });
});

describe('courseStatsTimeByModeBackfillOne', () => {
  async function seed(
    t: ReturnType<typeof convexTest>,
    totalTimeMsByMode?: { audio: number; full: number },
  ) {
    return t.run(async (ctx) => {
      const courseId = await ctx.db.insert('courses', {
        userId: 'user_A',
        baseLanguages: ['en'],
        targetLanguages: ['sv'],
      });
      const otherCourseId = await ctx.db.insert('courses', {
        userId: 'user_A',
        baseLanguages: ['en'],
        targetLanguages: ['de'],
      });
      const statsId = await ctx.db.insert('courseStats', {
        userId: 'user_A',
        courseId,
        totalRepetitions: 4,
        totalTimeMs: 1_000,
        totalCards: 2,
        currentStreak: 1,
        ...(totalTimeMsByMode ? { totalTimeMsByMode } : {}),
      });
      await ctx.db.insert('dailyStats', {
        ...day('2026-08-30', 300, { audio: 200, full: 100 }),
        courseId,
      });
      await ctx.db.insert('dailyStats', {
        ...day('2026-08-31', 250, {
          audio: 50,
          full: 0,
          radio: 150,
          freeStudy: 50,
        }),
        courseId,
      });
      // Pre-split day: counted in totalTimeMs, no breakdown.
      await ctx.db.insert('dailyStats', {
        ...day('2026-01-01', 450),
        courseId,
      });
      // Another course of the same user must not leak in.
      await ctx.db.insert('dailyStats', {
        ...day('2026-08-31', 999, { audio: 999, full: 0 }),
        courseId: otherCourseId,
      });
      return { statsId, courseId: courseId as Id<'courses'> };
    });
  }

  it("sums the course's own daily split into the missing field", async () => {
    const t = convexTest(schema, modules);
    const { statsId } = await seed(t);
    const patch = await t.run(async (ctx) => {
      const doc = await ctx.db.get(statsId);
      return courseStatsTimeByModeBackfillOne(ctx, doc!);
    });
    expect(patch).toEqual({
      totalTimeMsByMode: { audio: 250, full: 100, radio: 150, freeStudy: 50 },
    });
    // 450 ms of pre-split time is not in any bucket: the tile's subtraction
    // rule shows it as learn time.
    const bucketed = Object.values(patch!.totalTimeMsByMode!).reduce(
      (a, b) => a + (b ?? 0),
      0,
    );
    expect(bucketed).toBe(550);
  });

  it('leaves a row the live writers already stamped alone', async () => {
    const t = convexTest(schema, modules);
    const { statsId } = await seed(t, { audio: 7, full: 0 });
    // t.run serializes `undefined` to null across the convex-test boundary.
    const skipped = await t.run(async (ctx) => {
      const doc = await ctx.db.get(statsId);
      return (await courseStatsTimeByModeBackfillOne(ctx, doc!)) === undefined;
    });
    expect(skipped).toBe(true);
  });
});
