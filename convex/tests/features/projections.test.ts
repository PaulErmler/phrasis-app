/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../../schema';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { addDays } from '../../../lib/dateStrings';
import { ORIGIN_BUCKET_ZEROS, type NewCardsByOrigin } from '../../types';

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

/**
 * Two premade levels on an active dataset, with the first one active and
 * partially added, so the `nextLevel` ETA has something to divide.
 * `cardsAdded` totals 160 of the deck's 300 cards => curriculumShare 0.5333.
 */
async function seedLevels(
  t: TestConvex<typeof schema>,
  courseId: Id<'courses'>,
) {
  return t.run(async (ctx) => {
    const datasetId = await ctx.db.insert('datasets', {
      slug: 'ogte-curated',
      version: '1.0.0',
      publishedAt: Date.now(),
      isActive: true,
    });
    const l1 = await ctx.db.insert('collections', {
      name: 'L01',
      datasetId,
      code: 'L01',
      displayName: 'A1.1',
      order: 1,
      textCount: 5000,
      origin: 'premade',
    });
    const l2 = await ctx.db.insert('collections', {
      name: 'L02',
      datasetId,
      code: 'L02',
      displayName: 'A1.2',
      order: 2,
      textCount: 200,
      origin: 'premade',
    });
    // 5000 - 160 - 0 = 4840 premade texts left in the active level. Large on
    // purpose: it keeps every ETA well clear of the 1-day floor so the ratios
    // below are not swallowed by `ceilDays` rounding.
    await ctx.db.insert('collectionProgress', {
      userId: 'user_A',
      courseId,
      collectionId: l1,
      cardsAdded: 160,
      cardsLearned: 160,
      cardsMastered: 0,
      ignoredCount: 0,
    });
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: 2,
      activeCollectionId: l1,
    });
    return { l1, l2 };
  });
}

/** A full origin split from the buckets a case actually cares about. */
const originSplit = (partial: Partial<NewCardsByOrigin>): NewCardsByOrigin => ({
  ...ORIGIN_BUCKET_ZEROS,
  ...partial,
});

/** Overwrite the seeded window's per-day origin split. */
async function setOriginSplit(
  t: TestConvex<typeof schema>,
  courseId: Id<'courses'>,
  split: NewCardsByOrigin | null,
) {
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('dailyStats')
      .withIndex('by_userId_and_courseId_and_date', (q) =>
        q.eq('userId', 'user_A').eq('courseId', courseId),
      )
      .collect();
    for (const r of rows) {
      await ctx.db.patch(r._id, { newCardsByOrigin: split ?? undefined });
    }
  });
}

async function nextLevelEta(
  t: TestConvex<typeof schema>,
): Promise<number | undefined> {
  const res = await t
    .withIdentity({ subject: 'user_A' })
    .query(api.features.projections.getProjections, {
      timezone: TZ,
      today: todayUtc(),
    });
  const nl = res?.indicators.find((i) => i.kind === 'nextLevel');
  return nl && 'etaDays' in nl ? nl.etaDays : undefined;
}

describe('features/projections: getProjections', () => {
  /**
   * The reported bug: the level ETA divided a premade-only remaining count by
   * an all-origin pace. These cover the query's half of the fix, the
   * attribution of `dailyStats.newCardsByOrigin` into a curriculum-only
   * series; `computeIndicators`' half is covered in
   * tests/unit/lib/projections.test.ts, which pins the exact day counts.
   *
   * Assertions here are RATIOS between configurations, not absolute days: a
   * convex-test course is created "now", so `courseAgeDays` is 1 and
   * `decayedDailyPace` divides the 90-day window by a single day, inflating
   * every pace by the same constant. The ratios are what the attribution
   * controls, and they are immune to it.
   */
  describe('curriculum vs custom attribution', () => {
    /**
     * ETA for one origin split, on a deck with 4840 premade texts left.
     * Unnamed buckets are 0; `null` is a row that carries no split at all.
     */
    async function etaFor(split: Partial<NewCardsByOrigin> | null) {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      await seedHistory(t, courseId, 90);
      await seedLevels(t, courseId);
      await setOriginSplit(t, courseId, split && originSplit(split));
      return nextLevelEta(t);
    }

    it('divides remaining premade texts by the PREMADE pace only', async () => {
      // Both users learn 5 new cards a day. The first learns 5 curriculum
      // cards, the second learns 1 curriculum card and 4 of their own. Before
      // the split they read as the same pace and got the same ETA.
      const allCurriculum = await etaFor({ premade: 5 });
      const mostlyCustom = await etaFor({ premade: 1, custom: 3, chat: 1 });
      expect(allCurriculum).toBeDefined();
      // A fifth of the curriculum pace ⇒ five times the ETA.
      expect(mostlyCustom! / allCurriculum!).toBeCloseTo(5, 1);
    });

    it('suppresses the ETA when no curriculum cards are being learned', async () => {
      // 5 cards a day, none of them curriculum: nothing honest to promise.
      expect(await etaFor({ custom: 5 })).toBeUndefined();
    });

    it('apportions legacy rows that carry no split by the deck ratio', async () => {
      // curriculumShare = 160 premade cardsAdded / 300 deck cards = 0.5333,
      // so a row with no split contributes 0.5333 of its newCards.
      const allCurriculum = await etaFor({ premade: 5 });
      const legacy = await etaFor(null);
      expect(legacy).toBeDefined();
      expect(legacy! / allCurriculum!).toBeCloseTo(1 / 0.5333, 1);
    });

    it('attributes only the remainder on a row with a PARTIAL split', async () => {
      // The shape of a day that straddled the deploy: newCards is 5, but only
      // 2 of them were bucketed. Trusting the buckets to sum would undercount
      // the day; the other 3 fall back to the deck ratio, for an effective
      // 2 + 3 * 0.5333 = 3.6 curriculum cards.
      const allCurriculum = await etaFor({ premade: 5 });
      const partial = await etaFor({ premade: 2 });
      expect(partial).toBeDefined();
      expect(partial! / allCurriculum!).toBeCloseTo(5 / 3.6, 1);
    });
  });

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
