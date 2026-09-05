/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { FsrsState } from '../../types';
import { pickUniqueDueSlot, studyDayFromSettings } from '../../lib/dueSlots';
import {
  DUE_SLOT_WINDOW_MS,
  isInsideSlotWindow,
  studyDayStart,
  type StudyDay,
} from '../../../lib/scheduling';
import { drainScheduler, drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

// reviewCard schedules content work on 0ms timers; drain it inside the test.
drainSchedulerAfterEach();

const BERLIN: StudyDay = { timezone: 'Europe/Berlin', dayStartHour: 4 };
const DAY = 86_400_000;

/** A mature Review-state card: Good yields a multi-day interval, Again a
 * 10-minute relearning step. */
function makeFsrsState(overrides: Partial<FsrsState> = {}): FsrsState {
  const now = Date.now();
  return {
    due: now - 1000,
    stability: 20,
    difficulty: 4,
    elapsedDays: 3,
    scheduledDays: 3,
    learningSteps: 0,
    reps: 5,
    lapses: 0,
    state: 2,
    lastReview: now - 3 * DAY,
    ...overrides,
  };
}

async function seedCourse(
  t: TestConvex<typeof schema>,
  opts: {
    userSettings?: Partial<Doc<'userSettings'>>;
    courseSettings?: Partial<Doc<'courseSettings'>>;
    statsTimezone?: string;
    cards: Array<Partial<Doc<'cards'>>>;
  },
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
      ...opts.userSettings,
    });
    await ctx.db.insert('courseStats', {
      userId: 'user_A',
      courseId,
      totalRepetitions: 0,
      totalTimeMs: 0,
      totalCards: 0,
      currentStreak: 0,
      ...(opts.statsTimezone ? { timezone: opts.statsTimezone } : {}),
    });
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: 5,
      ...opts.courseSettings,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: opts.cards.length,
    });
    const cardIds: Id<'cards'>[] = [];
    for (let i = 0; i < opts.cards.length; i++) {
      const textId = await ctx.db.insert('texts', {
        text: `Hola ${i}`,
        language: 'es',
        userCreated: true,
        userId: 'user_A',
        collectionId,
        collectionRank: i + 1,
      });
      cardIds.push(
        await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
          ...opts.cards[i],
        }),
      );
    }
    return { courseId, deckId, cardIds };
  });
}

const reviewCardSpec = (): Partial<Doc<'cards'>> => ({
  schedulingPhase: 'review',
  fsrsState: makeFsrsState(),
  isGraduated: true,
});

const getCard = (t: TestConvex<typeof schema>, cardId: Id<'cards'>) =>
  t.run(async (ctx) => (await ctx.db.get(cardId))!);

describe('reviewCard: due by day', () => {
  it('snaps a day-scale Good into the study-day window, one unique slot per card', async () => {
    const t = convexTest(schema, modules);
    const { cardIds } = await seedCourse(t, {
      cards: Array.from({ length: 30 }, reviewCardSpec),
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    const dueDates = new Set<number>();
    for (const cardId of cardIds) {
      const result = await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'good',
        timezone: 'Europe/Berlin',
      });
      expect(isInsideSlotWindow(result.dueDate, BERLIN)).toBe(true);
      dueDates.add(result.dueDate);

      const card = await getCard(t, cardId);
      expect(card.dueDate).toBe(result.dueDate);
      // FSRS's own opinion keeps the exact instant; only the serving key
      // moved, and only earlier.
      expect(card.fsrsState!.due).toBeGreaterThan(card.dueDate);
      expect(studyDayStart(card.fsrsState!.due, BERLIN)).toBe(
        studyDayStart(card.dueDate, BERLIN),
      );
    }
    expect(dueDates.size).toBe(30);
  });

  it('keeps the exact FSRS instant when dueByDay is off for the user', async () => {
    const t = convexTest(schema, modules);
    const { cardIds } = await seedCourse(t, {
      userSettings: { dueByDay: false },
      cards: [reviewCardSpec()],
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    const result = await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId: cardIds[0],
      rating: 'good',
      timezone: 'Europe/Berlin',
    });
    const card = await getCard(t, cardIds[0]);
    expect(card.dueDate).toBe(card.fsrsState!.due);
    expect(result.dueDate).toBe(card.fsrsState!.due);
  });

  it('keeps a relearning step exact: Again on a graduated card is due in 10 minutes', async () => {
    const t = convexTest(schema, modules);
    const { cardIds } = await seedCourse(t, { cards: [reviewCardSpec()] });
    const asUser = t.withIdentity({ subject: 'user_A' });
    const before = Date.now();
    const result = await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId: cardIds[0],
      rating: 'again',
      timezone: 'Europe/Berlin',
    });
    expect(result.dueDate - before).toBeGreaterThanOrEqual(10 * 60_000 - 10);
    expect(result.dueDate - before).toBeLessThan(10 * 60_000 + 5_000);
    expect(result.fsrsState!.scheduledDays).toBe(0);
  });

  it('snaps the writing track under separateModeTracking and leaves the shared schedule alone', async () => {
    const t = convexTest(schema, modules);
    const sharedDue = Date.now() + 5 * DAY + 7 * 3_600_000;
    const { cardIds } = await seedCourse(t, {
      courseSettings: { separateModeTracking: true },
      cards: [
        {
          ...reviewCardSpec(),
          dueDate: sharedDue,
          writingDueDate: Date.now() - 1000,
          writingFsrsState: makeFsrsState(),
          writingIsGraduated: true,
        },
      ],
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    const result = await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId: cardIds[0],
      rating: 'good',
      timezone: 'Europe/Berlin',
      reviewMode: 'full',
    });
    const card = await getCard(t, cardIds[0]);
    expect(card.writingDueDate).toBe(result.dueDate);
    expect(isInsideSlotWindow(card.writingDueDate!, BERLIN)).toBe(true);
    expect(card.writingFsrsState!.due).toBeGreaterThan(card.writingDueDate!);
    expect(card.dueDate).toBe(sharedDue);
  });

  it('serves a snapped card once its study day starts, not before', async () => {
    const t = convexTest(schema, modules);
    const { cardIds } = await seedCourse(t, { cards: [reviewCardSpec()] });
    const asUser = t.withIdentity({ subject: 'user_A' });
    const { dueDate } = await asUser.mutation(
      api.features.scheduling.reviewCard,
      { cardId: cardIds[0], rating: 'good', timezone: 'Europe/Berlin' },
    );
    const dayStart = studyDayStart(dueDate, BERLIN);

    const before = await asUser.query(
      api.features.scheduling.getCardForReview,
      {
        timezone: 'Europe/Berlin',
        now: dayStart - 60_000,
      },
    );
    expect(before).toBeNull();

    const after = await asUser.query(api.features.scheduling.getCardForReview, {
      timezone: 'Europe/Berlin',
      now: dayStart + DUE_SLOT_WINDOW_MS,
    });
    expect(after?._id).toBe(cardIds[0]);
  });
});

describe('studyDayFromSettings', () => {
  it('defaults to on at 04:00 and honours the stored overrides', () => {
    expect(studyDayFromSettings(null, 'Europe/Berlin')).toEqual(BERLIN);
    expect(
      studyDayFromSettings({ dueByDay: true, dayStartHour: 6 }, 'UTC'),
    ).toEqual({ timezone: 'UTC', dayStartHour: 6 });
    expect(studyDayFromSettings({ dueByDay: false }, 'UTC')).toBeUndefined();
  });

  it('falls back to exact instants on an unusable zone, and to 04:00 on a bad hour', () => {
    expect(studyDayFromSettings(null, 'Not/AZone')).toBeUndefined();
    expect(studyDayFromSettings(null, '')).toBeUndefined();
    expect(studyDayFromSettings({ dayStartHour: 24 }, 'UTC')).toEqual({
      timezone: 'UTC',
      dayStartHour: 4,
    });
    expect(studyDayFromSettings({ dayStartHour: 2.5 }, 'UTC')).toEqual({
      timezone: 'UTC',
      dayStartHour: 4,
    });
  });
});

describe('pickUniqueDueSlot', () => {
  const dayStart = studyDayStart(Date.now() + 3 * DAY, BERLIN);

  it('draws inside the window and probes forward past an occupied slot', async () => {
    const t = convexTest(schema, modules);
    const { deckId } = await seedCourse(t, {
      cards: [{ dueDate: dayStart + 30_000 }],
    });
    const free = await t.run((ctx) =>
      pickUniqueDueSlot(ctx, deckId, 'shared', dayStart, () => 0.25),
    );
    expect(free).toBe(dayStart + 15_000);
    const probed = await t.run((ctx) =>
      pickUniqueDueSlot(ctx, deckId, 'shared', dayStart, () => 0.5),
    );
    expect(probed).toBe(dayStart + 30_001);
  });

  it('checks the writing due index for the writing track', async () => {
    const t = convexTest(schema, modules);
    const { deckId } = await seedCourse(t, {
      cards: [{ writingDueDate: dayStart + 30_000 }],
    });
    expect(
      await t.run((ctx) =>
        pickUniqueDueSlot(ctx, deckId, 'writing', dayStart, () => 0.5),
      ),
    ).toBe(dayStart + 30_001);
    // The shared index is untouched by a writing due date.
    expect(
      await t.run((ctx) =>
        pickUniqueDueSlot(ctx, deckId, 'shared', dayStart, () => 0.5),
      ),
    ).toBe(dayStart + 30_000);
  });

  it('ignores hidden and mastered cards, which no due query serves', async () => {
    const t = convexTest(schema, modules);
    const { deckId } = await seedCourse(t, {
      cards: [
        { dueDate: dayStart + 30_000, isHidden: true },
        { dueDate: dayStart + 30_000, isMastered: true },
      ],
    });
    expect(
      await t.run((ctx) =>
        pickUniqueDueSlot(ctx, deckId, 'shared', dayStart, () => 0.5),
      ),
    ).toBe(dayStart + 30_000);
  });

  it('returns null after sixteen occupied probes so callers keep the exact instant', async () => {
    const t = convexTest(schema, modules);
    const { deckId } = await seedCourse(t, {
      cards: Array.from({ length: 16 }, (_, i) => ({
        dueDate: dayStart + 30_000 + i,
      })),
    });
    expect(
      await t.run((ctx) =>
        pickUniqueDueSlot(ctx, deckId, 'shared', dayStart, () => 0.5),
      ),
    ).toBeNull();
  });
});

describe('snapDueDatesToStudyDay sweep', () => {
  it('moves future day-scale cards into their day window and leaves everything else alone', async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const legacyExact = now + 3 * DAY + 5 * 3_600_000;
    const alreadySnapped = studyDayStart(now + 2 * DAY, BERLIN) + 10_000;
    const learningStep = now + 10 * 60_000;
    const overdue = now - DAY;
    const preReview = now + DAY;
    const writingExact = now + 5 * DAY + 3 * 3_600_000;

    const { cardIds } = await seedCourse(t, {
      statsTimezone: 'Europe/Berlin',
      cards: [
        { ...reviewCardSpec(), dueDate: legacyExact },
        { ...reviewCardSpec(), dueDate: alreadySnapped },
        {
          schedulingPhase: 'review',
          isGraduated: true,
          fsrsState: makeFsrsState({ state: 3, scheduledDays: 0 }),
          dueDate: learningStep,
        },
        { ...reviewCardSpec(), dueDate: overdue },
        { dueDate: preReview },
        {
          writingDueDate: writingExact,
          writingFsrsState: makeFsrsState({ scheduledDays: 5 }),
          writingIsGraduated: true,
        },
      ],
    });

    const run = async () => {
      await t.mutation(internal.migrations.snapDueDatesToStudyDay.kickOff, {});
      await drainScheduler(40);
    };
    await run();

    const [moved, snapped, step, past, fresh, writing] = await Promise.all(
      cardIds.map((id) => getCard(t, id)),
    );
    expect(moved.dueDate).not.toBe(legacyExact);
    expect(isInsideSlotWindow(moved.dueDate, BERLIN)).toBe(true);
    expect(studyDayStart(moved.dueDate, BERLIN)).toBe(
      studyDayStart(legacyExact, BERLIN),
    );
    expect(snapped.dueDate).toBe(alreadySnapped);
    expect(step.dueDate).toBe(learningStep);
    expect(past.dueDate).toBe(overdue);
    expect(fresh.dueDate).toBe(preReview);
    expect(writing.writingDueDate).not.toBe(writingExact);
    expect(isInsideSlotWindow(writing.writingDueDate!, BERLIN)).toBe(true);
    expect(studyDayStart(writing.writingDueDate!, BERLIN)).toBe(
      studyDayStart(writingExact, BERLIN),
    );
    // The shared due date of the writing-only card was in the past and
    // stays put.
    expect(writing.dueDate).toBeLessThan(now);

    // Idempotent: a second pass finds nothing to move.
    const firstPass = [moved.dueDate, writing.writingDueDate];
    await run();
    const [movedAgain, writingAgain] = await Promise.all([
      getCard(t, cardIds[0]),
      getCard(t, cardIds[5]),
    ]);
    expect([movedAgain.dueDate, writingAgain.writingDueDate]).toEqual(
      firstPass,
    );
  });

  it('walks past a full batch via the cursor and keeps every slot unique', async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    // 60 cards > BATCH_SIZE (50), all landing on the same study day.
    const { cardIds } = await seedCourse(t, {
      statsTimezone: 'Europe/Berlin',
      cards: Array.from({ length: 60 }, (_, i) => ({
        ...reviewCardSpec(),
        dueDate: now + 4 * DAY + i * 60_000,
      })),
    });
    await t.mutation(internal.migrations.snapDueDatesToStudyDay.kickOff, {});
    await drainScheduler(40);

    const cards = await Promise.all(cardIds.map((id) => getCard(t, id)));
    const slots = new Set(cards.map((c) => c.dueDate));
    expect(slots.size).toBe(60);
    for (const card of cards) {
      expect(isInsideSlotWindow(card.dueDate, BERLIN)).toBe(true);
    }
  });

  it('walks the writing track from the kick time, not from the shared cursor', async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    // 55 shared cards fill one full batch and a partial one, so the shared
    // cursor ends up days past the kick time. The three writing-track cards
    // are due BEFORE that cursor and must still be reached.
    const shared = Array.from({ length: 55 }, (_, i) => ({
      ...reviewCardSpec(),
      dueDate: now + 6 * DAY + i * 60_000,
    }));
    const writingExact = now + 2 * DAY + 3 * 3_600_000;
    const writing = Array.from({ length: 3 }, (_, i) => ({
      writingDueDate: writingExact + i * 60_000,
      writingFsrsState: makeFsrsState({ scheduledDays: 2 }),
      writingIsGraduated: true,
    }));
    const { cardIds } = await seedCourse(t, {
      statsTimezone: 'Europe/Berlin',
      cards: [...shared, ...writing],
    });
    await t.mutation(internal.migrations.snapDueDatesToStudyDay.kickOff, {});
    await drainScheduler(60);

    const cards = await Promise.all(cardIds.map((id) => getCard(t, id)));
    for (const card of cards.slice(0, 55)) {
      expect(isInsideSlotWindow(card.dueDate, BERLIN)).toBe(true);
    }
    for (const card of cards.slice(55)) {
      expect(isInsideSlotWindow(card.writingDueDate!, BERLIN)).toBe(true);
      expect(studyDayStart(card.writingDueDate!, BERLIN)).toBe(
        studyDayStart(writingExact, BERLIN),
      );
    }
  });

  it('skips a learner who turned dueByDay off', async () => {
    const t = convexTest(schema, modules);
    const legacyExact = Date.now() + 3 * DAY + 5 * 3_600_000;
    const { cardIds } = await seedCourse(t, {
      userSettings: { dueByDay: false },
      statsTimezone: 'Europe/Berlin',
      cards: [{ ...reviewCardSpec(), dueDate: legacyExact }],
    });
    await t.mutation(internal.migrations.snapDueDatesToStudyDay.kickOff, {});
    await drainScheduler(40);
    expect((await getCard(t, cardIds[0])).dueDate).toBe(legacyExact);
  });

  it('uses UTC when the course was never reviewed', async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const legacyExact = now + 3 * DAY + 5 * 3_600_000;
    const { cardIds } = await seedCourse(t, {
      cards: [{ ...reviewCardSpec(), dueDate: legacyExact }],
    });
    await t.mutation(internal.migrations.snapDueDatesToStudyDay.kickOff, {});
    await drainScheduler(40);
    const utc: StudyDay = { timezone: 'UTC', dayStartHour: 4 };
    const card = await getCard(t, cardIds[0]);
    expect(isInsideSlotWindow(card.dueDate, utc)).toBe(true);
  });
});
