/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../../schema';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { addDays } from '../../../lib/dateStrings';

const modules = import.meta.glob('/convex/**/*.ts');

const TZ = 'UTC';
const todayUtc = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

async function seedActiveCourse(t: TestConvex<typeof schema>) {
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
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 300,
    });
    return { courseId, deckId };
  });
}

async function seedHistory(
  t: TestConvex<typeof schema>,
  courseId: Id<'courses'>,
  days: number,
) {
  const today = todayUtc();
  await t.run(async (ctx) => {
    await ctx.db.insert('courseStats', {
      userId: 'user_A',
      courseId,
      totalRepetitions: 4000,
      totalTimeMs: 50 * 3_600_000,
      totalCards: 300,
      currentStreak: 10,
    });
    await ctx.db.insert('languageStats', {
      userId: 'user_A',
      courseId,
      language: 'es',
      totalRepetitions: 4000,
      totalNewCards: 300,
      totalWords: 1200,
      totalTimeMs: 50 * 3_600_000,
    });
    for (let d = 0; d < days; d++) {
      const date = addDays(today, -d);
      await ctx.db.insert('dailyStats', {
        userId: 'user_A',
        courseId,
        date,
        reps: 40,
        newCards: 5,
        timeMs: 20 * 60_000,
        cardsReviewed: 30,
      });
      await ctx.db.insert('dailyLanguageStats', {
        userId: 'user_A',
        courseId,
        date,
        language: 'es',
        reps: 40,
        newCards: 5,
        timeMs: 20 * 60_000,
        newWordsCount: 20,
      });
    }
  });
}

describe('features/projections: getProjections', () => {
  it('returns null when unauthenticated', async () => {
    const t = convexTest(schema, modules);
    const res = await t.query(api.features.projections.getProjections, {
      timezone: TZ,
      today: todayUtc(),
    });
    expect(res).toBeNull();
  });

  it('falls back to the server date for a malformed today string', async () => {
    const t = convexTest(schema, modules);
    const { courseId } = await seedActiveCourse(t);
    await seedHistory(t, courseId, 10);
    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(api.features.projections.getProjections, {
      timezone: TZ,
      today: 'not-a-date',
    });
    // `resolveClientToday` degrades to the server's view rather than blanking
    // the whole slot, matching every other client-date consumer.
    expect(res?.today).toBe(todayUtc());
  });

  it("clamps a skewed client date to the server's view of the timezone", async () => {
    const t = convexTest(schema, modules);
    const { courseId } = await seedActiveCourse(t);
    await seedHistory(t, courseId, 10);
    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(api.features.projections.getProjections, {
      timezone: TZ,
      today: addDays(todayUtc(), 30),
    });
    expect(res?.today).toBe(todayUtc());
  });

  it('canonicalizes a non-canonical but regex-passing date instead of using it raw', async () => {
    const t = convexTest(schema, modules);
    const { courseId } = await seedActiveCourse(t);
    await seedHistory(t, courseId, 10);
    const asUser = t.withIdentity({ subject: 'user_A' });
    // "<yyyy>-<mm>-00" passes a bare /^\d{4}-\d{2}-\d{2}$/ and resolves to the
    // last day of the previous month. Within the ±1 clamp only when that is
    // adjacent to today. Whatever comes back must be a real calendar date, so
    // it can serve as a `dailyStats` index bound and a wordsByDate map key.
    const server = todayUtc();
    const res = await asUser.query(api.features.projections.getProjections, {
      timezone: TZ,
      today: `${server.slice(0, 8)}00`,
    });
    expect(res?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res?.today?.endsWith('-00')).toBe(false);
    // Canonical means it round-trips through the date arithmetic unchanged.
    expect(addDays(res!.today!, 0)).toBe(res?.today);
  });

  it('active user gets observed-basis indicators incl. words, sentences and rates', async () => {
    const t = convexTest(schema, modules);
    const { courseId } = await seedActiveCourse(t);
    await seedHistory(t, courseId, 14);
    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(api.features.projections.getProjections, {
      timezone: TZ,
      today: todayUtc(),
    });
    expect(res).not.toBeNull();
    expect(res!.basis).toBe('observed');
    expect(res!.currentWords).toBe(1200);
    const kinds = res!.indicators.map((i) => i.kind);
    expect(kinds).toContain('oneYearWords');
    expect(kinds).toContain('sentencesPerHour');
    expect(kinds).toContain('nextWordMilestone');
    expect(kinds).toContain('studyTimeMilestone');
    expect(kinds).not.toContain('empty');
  });

  it('zero-history user gets the empty indicator', async () => {
    const t = convexTest(schema, modules);
    await seedActiveCourse(t);
    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(api.features.projections.getProjections, {
      timezone: TZ,
      today: todayUtc(),
    });
    expect(res).not.toBeNull();
    expect(res!.basis).toBe('empty');
    expect(res!.indicators).toEqual([{ kind: 'empty' }]);
  });

  it('stays locked below 10 minutes of study time, unlocks above it', async () => {
    const seedWithStudyTime = async (totalTimeMs: number) => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      await seedHistory(t, courseId, 14);
      // seedHistory writes 50h; overwrite with the threshold case under test.
      await t.run(async (ctx) => {
        const stats = await ctx.db
          .query('courseStats')
          .filter((q) => q.eq(q.field('courseId'), courseId))
          .first();
        if (stats) await ctx.db.patch(stats._id, { totalTimeMs });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      return asUser.query(api.features.projections.getProjections, {
        timezone: TZ,
        today: todayUtc(),
      });
    };

    // Real daily history, but only 9 minutes on the clock, still locked.
    const locked = await seedWithStudyTime(9 * 60_000);
    expect(locked!.basis).toBe('empty');
    expect(locked!.indicators).toEqual([{ kind: 'empty' }]);
    // currentWords is still reported so the rest of the card can use it.
    expect(locked!.currentWords).toBe(1200);

    const unlocked = await seedWithStudyTime(10 * 60_000);
    expect(unlocked!.basis).not.toBe('empty');
    expect(unlocked!.indicators.map((i) => i.kind)).not.toContain('empty');
  });

  it('non-target-language word rows are excluded from the pace', async () => {
    const t = convexTest(schema, modules);
    const { courseId } = await seedActiveCourse(t);
    await seedHistory(t, courseId, 14);
    // A base-language row that must not inflate word counts.
    await t.run(async (ctx) => {
      await ctx.db.insert('dailyLanguageStats', {
        userId: 'user_A',
        courseId,
        date: todayUtc(),
        language: 'en',
        reps: 40,
        newCards: 5,
        timeMs: 20 * 60_000,
        newWordsCount: 500,
      });
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(api.features.projections.getProjections, {
      timezone: TZ,
      today: todayUtc(),
    });
    // 500 extra "today words" in a base language must not trigger the
    // counterfactual (20/day pace, today = 20 target words only).
    const kinds = res!.indicators.map((i) => i.kind);
    expect(kinds).not.toContain('counterfactualWords');
  });

  it('falls back to UTC for an invalid or empty timezone instead of throwing', async () => {
    const t = convexTest(schema, modules);
    const { courseId } = await seedActiveCourse(t);
    await seedHistory(t, courseId, 10);
    const asUser = t.withIdentity({ subject: 'user_A' });
    for (const timezone of ['', 'Not/AZone']) {
      const res = await asUser.query(api.features.projections.getProjections, {
        timezone,
        today: todayUtc(),
      });
      expect(res).not.toBeNull();
      expect(res!.today).toBe(todayUtc());
      expect(res!.basis).toBe('observed');
    }
  });

  it('keeps the newest days when the language-stats window exceeds the row cap', async () => {
    // 7 target languages × 90 days = 630 rows > the 600-row cap. The read is
    // descending, so truncation must drop the OLDEST days. An ascending
    // read would cut exactly the newest days the decayed pace weights most.
    const langs = ['es', 'fr', 'de', 'it', 'pt', 'nl', 'sv'];
    const t = convexTest(schema, modules);
    const { courseId } = await t.run(async (ctx) => {
      const id = await ctx.db.insert('courses', {
        userId: 'user_A',
        baseLanguages: ['en'],
        targetLanguages: langs,
      });
      await ctx.db.insert('userSettings', {
        userId: 'user_A',
        hasCompletedOnboarding: true,
        activeCourseId: id,
      });
      await ctx.db.insert('decks', { courseId: id, name: 'd', cardCount: 300 });
      await ctx.db.insert('courseStats', {
        userId: 'user_A',
        courseId: id,
        totalRepetitions: 4000,
        totalTimeMs: 50 * 3_600_000,
        totalCards: 300,
        currentStreak: 10,
      });
      return { courseId: id };
    });
    const today = todayUtc();
    await t.run(async (ctx) => {
      for (let d = 0; d < 90; d++) {
        const date = addDays(today, -d);
        await ctx.db.insert('dailyStats', {
          userId: 'user_A',
          courseId,
          date,
          reps: 40,
          newCards: 5,
          timeMs: 20 * 60_000,
          cardsReviewed: 30,
        });
        for (const language of langs) {
          await ctx.db.insert('dailyLanguageStats', {
            userId: 'user_A',
            courseId,
            date,
            language,
            reps: 5,
            newCards: 1,
            timeMs: 3 * 60_000,
            // All the word progress sits in the NEWEST 30 days; the oldest
            // 60 days are zero. If truncation dropped the newest rows the
            // observed pace would be 0 and no word projection would emit.
            newWordsCount: d < 30 ? 10 : 0,
          });
        }
      }
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(api.features.projections.getProjections, {
      timezone: TZ,
      today,
    });
    expect(res!.basis).toBe('observed');
    const eoy = res!.indicators.find((i) => i.kind === 'endOfYearWords');
    const oneYear = res!.indicators.find((i) => i.kind === 'oneYearWords');
    // A nonzero recent pace must project ABOVE the current word count.
    expect(eoy || oneYear).toBeTruthy();
    if (oneYear && 'words' in oneYear) {
      expect(oneYear.words).toBeGreaterThan(res!.currentWords);
    }
  });
});
