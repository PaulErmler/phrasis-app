/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConvexError } from 'convex/values';

// Mock the rate limiter at the module boundary. The real component would need
// `t.registerComponent` (flagged fragile in this project). Permissive default
// is (re)installed in the beforeEach below; the limiter-exceeded tests
// override `mockRateLimit` per test. Same precedent as
// tests/features/ttsProcessing.test.ts.
vi.mock('../../rateLimiter', () => ({
  rateLimiter: {
    limit: vi.fn(),
    check: vi.fn(),
    reset: vi.fn(),
  },
  TTS_RATE_LIMIT_BY_PROVIDER: {
    google: 'googleTts',
    gemini: 'geminiTts',
    minimax: 'minimaxTts',
  },
}));

import { rateLimiter } from '../../rateLimiter';
import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

const mockRateLimit = vi.mocked(rateLimiter.limit);

beforeEach(() => {
  mockRateLimit.mockReset();
  mockRateLimit.mockResolvedValue({ ok: true, retryAfter: 0 });
});
import {
  ONBOARDING_INITIAL_SEED_CARDS,
  ONBOARDING_CARDS_BATCH_SIZE,
  MAX_ONBOARDING_FREE_TEXT_LENGTH,
  ogteLevelToCollectionCode,
} from '../../../lib/constants/onboarding';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * `completeOnboarding` schedules background warmup via `ctx.scheduler.runAfter`
 * (translation queue, audio warmup). Those scheduled functions fire *after*
 * the test's synchronous mutation returns, but by then the convex-test
 * harness has torn down their `_scheduled_functions` row. They crash inside
 * the harness with "Cannot read properties of null (reading 'state')" and
 * surface as unhandled rejections that pollute the test output.
 *
 * None of that affects the assertions we make (we read DB state straight
 * after the mutation, before any scheduled work runs).
 *
 * Suppression strategy:
 *   1. **unhandledRejection**: vitest's worker listener
 *      (init.D98-gwRW.js:105) reports the error only when
 *      `processListeners('unhandledRejection').length === 1`. We register a
 *      second listener that pattern-matches the known scheduler-teardown
 *      crashes; for those, do nothing (vitest's listener returns early
 *      because `length > 1`). For genuinely unexpected unhandled rejections
 *      we re-throw to a microtask so vitest still surfaces them.
 *   2. **console.error**: convex-test's scheduler logs failed scheduled
 *      functions via `console.error`. Filter the known patterns so the
 *      report stays readable.
 */
const SCHEDULER_NOISE =
  /(Cannot read properties of null \(reading 'state'\)|Transaction already committed or rolled back|Error when running scheduled function|AUTUMN_SECRET_KEY environment variable)/;

// Register the noise filters at MODULE TOP LEVEL (not in beforeAll/afterAll).
// The deferred scheduled functions can fire after vitest's afterAll cleanup,
// if we'd removed the listener by then, the rejection slips through to
// vitest's worker handler.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (SCHEDULER_NOISE.test(msg)) return;
  // Re-throw asynchronously so legitimate unhandled rejections still surface.
  setTimeout(() => {
    throw reason instanceof Error ? reason : new Error(String(reason));
  }, 0);
});

const realConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const msg = args
    .map((a) => (a instanceof Error ? a.message : String(a)))
    .join(' ');
  if (SCHEDULER_NOISE.test(msg)) return;
  realConsoleError(...args);
};

async function seedQuota(t: TestConvex<typeof schema>, userId: string) {
  await t.run(async (ctx) =>
    ctx.db.insert('usageQuotas', {
      userId,
      features: {
        courses: { balance: 5, included: 5, used: 0, unlimited: false },
        sentences: { balance: 100, included: 100, used: 0, unlimited: false },
        multiple_languages: {
          balance: 1,
          included: 1,
          used: 0,
          unlimited: true,
        },
        chat_messages: {
          balance: 100,
          included: 100,
          used: 0,
          unlimited: false,
        },
        custom_sentences: {
          balance: 100,
          included: 100,
          used: 0,
          unlimited: false,
        },
        transcriptions: {
          balance: 100,
          included: 100,
          used: 0,
          unlimited: false,
        },
        card_edits: { balance: 100, included: 100, used: 0, unlimited: false },
        translation_auto_fill: {
          balance: 100,
          included: 100,
          used: 0,
          unlimited: false,
        },
      },
      lastSyncedAt: Date.now(),
    }),
  );
}

/**
 * Seed the `Essential` legacy curriculum collection with 12 English texts so
 * `getNextTextsFromRank` can pull the first 10 cards during completeOnboarding.
 */
async function seedEssentialCollection(
  t: TestConvex<typeof schema>,
): Promise<Id<'collections'>> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert('collections', {
      name: 'Essential',
      textCount: 12,
      origin: 'premade',
    });
    for (let i = 0; i < 12; i++) {
      await ctx.db.insert('texts', {
        text: `essential ${i}`,
        language: 'en',
        userCreated: false,
        collectionId: id,
        collectionRank: i,
      });
    }
    return id;
  });
}

/**
 * Seed an active OGTE dataset with the given level collections (each with a
 * handful of curriculum texts) so `resolveStartingCollection`'s by-code path
 * has something to hit. Returns the collection ids keyed by code ("L06" …).
 */
async function seedActiveDataset(
  t: TestConvex<typeof schema>,
  levels: number[],
): Promise<Record<string, Id<'collections'>>> {
  return t.run(async (ctx) => {
    const datasetId = await ctx.db.insert('datasets', {
      slug: 'ogte-test',
      version: '1.0.0',
      publishedAt: Date.now(),
      isActive: true,
    });
    const byCode: Record<string, Id<'collections'>> = {};
    for (const level of levels) {
      const code = ogteLevelToCollectionCode(level)!;
      const id = await ctx.db.insert('collections', {
        name: code,
        textCount: 6,
        datasetId,
        code,
        order: level,
        origin: 'premade',
      });
      for (let i = 0; i < 6; i++) {
        await ctx.db.insert('texts', {
          text: `${code} sentence ${i}`,
          language: 'en',
          userCreated: false,
          collectionId: id,
          collectionRank: i,
          datasetId,
        });
      }
      byCode[code] = id;
    }
    return byCode;
  });
}

/**
 * Seed the `placement-test-pool` collection with 5 English texts.
 */
async function seedPlacementPool(
  t: TestConvex<typeof schema>,
): Promise<Id<'collections'>> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert('collections', {
      name: 'placement-test-pool',
      textCount: 5,
      displayName: 'Placement Test Pool',
      origin: 'premade',
    });
    for (let i = 0; i < 5; i++) {
      await ctx.db.insert('texts', {
        text: `placement ${i}`,
        language: 'en',
        userCreated: false,
        collectionId: id,
        collectionRank: 100 + i,
      });
    }
    return id;
  });
}

/**
 * `completeOnboarding` schedules background work (translation/audio backfill)
 * via `ctx.scheduler.runAfter`. Drain those before the test ends so the
 * scheduler doesn't race against vitest teardown and surface as an unhandled
 * rejection.
 */
async function drainScheduled(t: TestConvex<typeof schema>) {
  try {
    await t.finishInProgressScheduledFunctions();
  } catch {
    // Scheduled functions can fail in the test harness when they hit real
    // network paths. That's fine; we only care about the in-memory state
    // the synchronous mutation already produced.
  }
}

describe('completeOnboarding', () => {
  it('creates a course, deck, and seeds exactly ONBOARDING_INITIAL_SEED_CARDS cards with the matching batch size on settings', async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
    });

    const { courseId, deckId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );

    expect(courseId).toBeDefined();
    expect(deckId).toBeDefined();

    const cards = await t.run(async (ctx) =>
      ctx.db
        .query('cards')
        .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
        .collect(),
    );
    // Onboarding seeds the initial-seed count upfront; the first lesson runs
    // longer (10 reviews) and the gap is filled by the auto-add path.
    expect(cards.length).toBe(ONBOARDING_INITIAL_SEED_CARDS);
    // deck.cardCount is maintained per-insert by `insertCard` (the mutation
    // no longer patches it itself) and must match the seeded rows.
    const deck = await t.run(async (ctx) => ctx.db.get(deckId));
    expect(deck?.cardCount).toBe(ONBOARDING_INITIAL_SEED_CARDS);

    const settings = await t.run(async (ctx) =>
      ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .first(),
    );
    expect(settings?.cardsToAddBatchSize).toBe(ONBOARDING_CARDS_BATCH_SIZE);
    expect(settings?.autoAddCards).toBe(true);

    await drainScheduled(t);
  });

  /**
   * The boundary clamp in `saveOnboardingProgress` only defends NEW writes.
   * An `onboardingProgress` row written before that guard existed can still
   * carry an out-of-range or non-finite goal, and THIS is the copy that
   * reaches `courseSettings` and the homescreen ring. Seeded via `ctx.db`
   * to reproduce exactly that pre-existing-row case.
   */
  it('clamps a poisoned daily goal from an existing progress row', async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await t.run(async (ctx) => {
      await ctx.db.insert('onboardingProgress', {
        userId: 'user_A',
        step: 6,
        targetLanguages: ['es'],
        baseLanguages: ['en'],
        currentLevel: 'beginner',
        reviewMode: 'audio',
        dailyTimeGoalMinutes: Number.POSITIVE_INFINITY,
      });
      await ctx.db.insert('userSettings', {
        userId: 'user_A',
        hasCompletedOnboarding: false,
      });
    });

    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );

    const settings = await t.run(async (ctx) =>
      ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .first(),
    );
    // Dropped, not stored as Infinity. The ring reads "Set daily goal"
    // instead of "14 / Infinity min".
    expect(settings?.dailyTimeGoalMinutes).toBeUndefined();

    await drainScheduled(t);
  });

  it('clamps an out-of-range daily goal from an existing progress row', async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await t.run(async (ctx) => {
      await ctx.db.insert('onboardingProgress', {
        userId: 'user_A',
        step: 6,
        targetLanguages: ['es'],
        baseLanguages: ['en'],
        currentLevel: 'beginner',
        reviewMode: 'audio',
        dailyTimeGoalMinutes: 9999,
      });
      await ctx.db.insert('userSettings', {
        userId: 'user_A',
        hasCompletedOnboarding: false,
      });
    });

    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );

    const settings = await t.run(async (ctx) =>
      ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .first(),
    );
    expect(settings?.dailyTimeGoalMinutes).toBe(120);

    await drainScheduled(t);
  });

  it('is idempotent, a second call returns the same course/deck and does not double-consume quota', async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
    });

    const first = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );
    await drainScheduled(t);
    const second = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );

    expect(second.courseId).toEqual(first.courseId);
    expect(second.deckId).toEqual(first.deckId);

    const quota = await t.run(async (ctx) =>
      ctx.db
        .query('usageQuotas')
        .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
        .first(),
    );
    expect(quota?.features.courses.used).toBe(1);

    // Cards should still be exactly the initial seed, no double-seeding on
    // the second call. Without the idempotency guard this would be
    // 2 * ONBOARDING_INITIAL_SEED_CARDS (or fail elsewhere).
    const cards = await t.run(async (ctx) =>
      ctx.db
        .query('cards')
        .withIndex('by_deckId', (q) => q.eq('deckId', first.deckId))
        .collect(),
    );
    expect(cards.length).toBe(ONBOARDING_INITIAL_SEED_CARDS);

    await drainScheduled(t);
  });

  it('pins the active course on userSettings without flipping hasCompletedOnboarding', async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    // The survey-only answers (acquisitionSource, learningGoals,
    // placementTest) live on `onboardingProgress` and stay there as the
    // permanent snapshot (the row is frozen, not deleted, by
    // finalizeOnboarding). `dailyTimeGoalMinutes` is mirrored to
    // `courseSettings` because it's a per-course pacing target. See
    // the dedicated test below. `userSettings` only carries identity +
    // activeCourseId + tutorial state.
    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
      acquisitionSource: 'reddit',
      learningGoals: ['travel', 'work'],
      dailyTimeGoalMinutes: 20,
      placementTest: {
        strategy: 'staircase',
        history: [
          { level: 8, knew: true },
          { level: 10, knew: false },
        ],
        finalLevel: 9,
      },
    });
    await asUser.mutation(api.features.courses.completeOnboarding, {});

    const settings = await asUser.query(
      api.features.courses.getUserSettings,
      {},
    );
    expect(settings?.hasCompletedOnboarding).toBe(false);
    expect(settings?.activeCourseId).toBeDefined();

    await drainScheduled(t);
  });

  it("mirrors dailyTimeGoalMinutes from onboarding answers to the new course's courseSettings", async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
      dailyTimeGoalMinutes: 25,
    });
    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );

    const courseSettings = await t.run(async (ctx) =>
      ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .first(),
    );
    expect(courseSettings?.dailyTimeGoalMinutes).toBe(25);

    await drainScheduled(t);
  });

  /**
   * The critical safeguard: placement-test sentences must never end up as
   * cards in the user's deck. This test seeds both pools, runs the full
   * completeOnboarding flow, and inspects every card's textId.
   */
  it("does not leak placement-test sentences into the user's deck", async () => {
    const t = convexTest(schema, modules);
    const essentialId = await seedEssentialCollection(t);
    const poolId = await seedPlacementPool(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
    });
    const { deckId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );

    const cards = await t.run(async (ctx) =>
      ctx.db
        .query('cards')
        .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
        .collect(),
    );
    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      const text = await t.run(async (ctx) => ctx.db.get(card.textId));
      expect(text).toBeDefined();
      expect(text!.collectionId).toBe(essentialId);
      expect(text!.collectionId).not.toBe(poolId);
    }
    await drainScheduled(t);
  });
});

describe('completeOnboarding: starting level → collection', () => {
  async function getActiveCollectionId(
    t: TestConvex<typeof schema>,
    courseId: Id<'courses'>,
  ): Promise<Id<'collections'> | undefined> {
    return t.run(async (ctx) => {
      const settings = await ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .first();
      return settings?.activeCollectionId;
    });
  }

  it('starts at the exact OGTE level when placementTest.finalLevel is present, and seeds cards from it', async () => {
    const t = convexTest(schema, modules);
    const byCode = await seedActiveDataset(t, [1, 6, 8]);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      // The 6-bucket mapping for `intermediate` is L08. The precise
      // finalLevel (6) must win over it.
      currentLevel: 'intermediate',
      reviewMode: 'audio',
      placementTest: { strategy: 'self-pick', history: [], finalLevel: 6 },
    });
    const { courseId, deckId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );

    expect(await getActiveCollectionId(t, courseId)).toBe(byCode.L06);

    const cards = await t.run(async (ctx) =>
      ctx.db
        .query('cards')
        .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
        .collect(),
    );
    expect(cards.length).toBe(ONBOARDING_INITIAL_SEED_CARDS);
    for (const card of cards) {
      const text = await t.run(async (ctx) => ctx.db.get(card.textId));
      expect(text?.collectionId).toBe(byCode.L06);
    }
    await drainScheduled(t);
  });

  it('falls back to the 6-bucket mapping when no finalLevel exists', async () => {
    const t = convexTest(schema, modules);
    const byCode = await seedActiveDataset(t, [1, 8]);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'intermediate',
      reviewMode: 'audio',
    });
    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );
    expect(await getActiveCollectionId(t, courseId)).toBe(byCode.L08);
    await drainScheduled(t);
  });

  it('defaults to L01 when no level was persisted at all', async () => {
    const t = convexTest(schema, modules);
    const byCode = await seedActiveDataset(t, [1, 8]);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      reviewMode: 'audio',
    });
    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );
    expect(await getActiveCollectionId(t, courseId)).toBe(byCode.L01);
    await drainScheduled(t);
  });

  it('ignores an out-of-range finalLevel and uses the bucket mapping', async () => {
    const t = convexTest(schema, modules);
    const byCode = await seedActiveDataset(t, [1, 8]);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'intermediate',
      reviewMode: 'audio',
      placementTest: { strategy: 'self-pick', history: [], finalLevel: 21 },
    });
    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );
    expect(await getActiveCollectionId(t, courseId)).toBe(byCode.L08);
    await drainScheduled(t);
  });
});

describe('saveOnboardingProgress: free-text length guard', () => {
  it('accepts free-text up to MAX_ONBOARDING_FREE_TEXT_LENGTH', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await expect(
      asUser.mutation(api.features.courses.saveOnboardingProgress, {
        step: 2,
        acquisitionSourceFreeText: 'x'.repeat(MAX_ONBOARDING_FREE_TEXT_LENGTH),
        learningGoalFreeText: 'y'.repeat(MAX_ONBOARDING_FREE_TEXT_LENGTH),
      }),
    ).resolves.toBeDefined();
  });

  it('rejects acquisitionSourceFreeText longer than the cap', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await expect(
      asUser.mutation(api.features.courses.saveOnboardingProgress, {
        step: 2,
        acquisitionSourceFreeText: 'x'.repeat(
          MAX_ONBOARDING_FREE_TEXT_LENGTH + 1,
        ),
      }),
    ).rejects.toThrow(/acquisitionSourceFreeText/);
  });

  it('rejects learningGoalFreeText longer than the cap', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await expect(
      asUser.mutation(api.features.courses.saveOnboardingProgress, {
        step: 3,
        learningGoalFreeText: 'x'.repeat(MAX_ONBOARDING_FREE_TEXT_LENGTH + 1),
      }),
    ).rejects.toThrow(/learningGoalFreeText/);
  });
});

describe('finalizeOnboarding', () => {
  it('flips hasCompletedOnboarding, freezes progress with completedAt, and pre-marks NO tutorials', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 7,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
    });

    const { alreadyFinalized } = await asUser.mutation(
      api.features.onboarding.finalizeOnboarding,
      {},
    );
    expect(alreadyFinalized).toBe(false);

    const settings = await asUser.query(
      api.features.courses.getUserSettings,
      {},
    );
    expect(settings?.hasCompletedOnboarding).toBe(true);
    // The wizard no longer embeds a tutorial lesson, so nothing may be
    // pre-marked. The home tour and every learning-mode tip must stay
    // armed for the fresh user (they teach in the real app now).
    expect(settings?.completedTutorials ?? []).toEqual([]);

    // Helper-mediated query hides frozen rows from the wizard.
    const progress = await asUser.query(
      api.features.courses.getOnboardingProgress,
      {},
    );
    expect(progress).toBeNull();

    // But the underlying row survives as the permanent snapshot.
    const row = await t.run(async (ctx) =>
      ctx.db
        .query('onboardingProgress')
        .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
        .first(),
    );
    expect(row).not.toBeNull();
    expect(typeof row?.completedAt).toBe('number');
  });

  it('preserves the full set of survey answers on the frozen progress row', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 12,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      acquisitionSource: 'friend',
      learningGoals: ['travel', 'career'],
      dailyTimeGoalMinutes: 15,
      placementTest: {
        strategy: 'binary',
        history: [
          { level: 5, knew: true },
          { level: 10, knew: false },
        ],
        finalLevel: 7,
      },
    });

    await asUser.mutation(api.features.onboarding.finalizeOnboarding, {});

    const row = await t.run(async (ctx) =>
      ctx.db
        .query('onboardingProgress')
        .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
        .first(),
    );
    expect(row?.acquisitionSource).toBe('friend');
    expect(row?.learningGoals).toEqual(['travel', 'career']);
    // Snapshot of the daily-time answer stays on the frozen row even
    // though the live setting lives on `courseSettings`.
    expect(row?.dailyTimeGoalMinutes).toBe(15);
    expect(row?.placementTest?.history).toHaveLength(2);
    expect(row?.placementTest?.finalLevel).toBe(7);
  });

  it('re-syncs a goal retuned after course creation (word-projection picker) onto courseSettings', async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    // Initial pick: 10 min. completeOnboarding copies it to courseSettings.
    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
      dailyTimeGoalMinutes: 10,
    });
    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );
    await drainScheduled(t);

    // The word-projection step retunes the goal. That picker only writes
    // the onboardingProgress row, after the courseSettings copy was made.
    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 10,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
      dailyTimeGoalMinutes: 30,
    });

    await asUser.mutation(api.features.onboarding.finalizeOnboarding, {});

    const courseSettings = await t.run(async (ctx) =>
      ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .first(),
    );
    expect(courseSettings?.dailyTimeGoalMinutes).toBe(30);
  });

  it('works when the user has no progress row (defensive, userSettings stays well-formed)', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });

    // No saveOnboardingProgress call; finalize is allowed and should not crash.
    const { alreadyFinalized } = await asUser.mutation(
      api.features.onboarding.finalizeOnboarding,
      {},
    );
    expect(alreadyFinalized).toBe(false);

    const settings = await asUser.query(
      api.features.courses.getUserSettings,
      {},
    );
    expect(settings?.hasCompletedOnboarding).toBe(true);
  });

  it('is idempotent, a second call reports alreadyFinalized and does not re-stamp completedAt', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 7,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
    });
    await asUser.mutation(api.features.onboarding.finalizeOnboarding, {});

    const firstCompletedAt = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('onboardingProgress')
        .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
        .first();
      return row?.completedAt;
    });
    expect(typeof firstCompletedAt).toBe('number');

    const second = await asUser.mutation(
      api.features.onboarding.finalizeOnboarding,
      {},
    );
    expect(second.alreadyFinalized).toBe(true);

    const secondCompletedAt = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('onboardingProgress')
        .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
        .first();
      return row?.completedAt;
    });
    expect(secondCompletedAt).toBe(firstCompletedAt);
  });

  it('re-syncs a review-mode pick made after course creation onto courseSettings (old-flow resume)', async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    // Old-flow shape: the course was created while the progress row still
    // said audio (or nothing) …
    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
    });
    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );
    await drainScheduled(t);

    // … and the user then picked Writing/Transcribe on the review-mode step.
    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 7,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'full',
      writingInputMode: 'transcribe',
    });

    await asUser.mutation(api.features.onboarding.finalizeOnboarding, {});

    const courseSettings = await t.run(async (ctx) =>
      ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .first(),
    );
    expect(courseSettings?.reviewMode).toBe('full');
    expect(courseSettings?.writingInputMode).toBe('transcribe');
  });
  it('clears a previously saved writing style when the user switches to Shadowing', async () => {
    // Regression: the wizard sends `writingInputMode: null` for Shadowing,
    // but null used to collapse to `undefined` on the way out, and the
    // Convex client strips undefined args, so the patch left 'transcribe' on
    // the progress row. completeOnboarding then copied it onto courseSettings
    // and the user silently landed in Transcribe the first time they opened
    // Writing mode.
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 7,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'full',
      writingInputMode: 'transcribe',
    });
    // The user backs up and picks Shadowing instead.
    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 7,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
      writingInputMode: null,
    });

    const progress = await t.run(async (ctx) =>
      ctx.db
        .query('onboardingProgress')
        .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
        .first(),
    );
    expect(progress?.writingInputMode).toBeUndefined();

    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );
    await drainScheduled(t);

    const courseSettings = await t.run(async (ctx) =>
      ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .first(),
    );
    expect(courseSettings?.reviewMode).toBe('audio');
    expect(courseSettings?.writingInputMode).toBeUndefined();
  });

  it("clears an EXISTING course's writing style on a Shadowing pick (old-flow resume)", async () => {
    // The mirror of the re-sync test above: finalizeOnboarding must treat an
    // absent writingInputMode as "Shadowing, no writing style" rather than
    // "user didn't answer", or a course that already carries 'transcribe'
    // keeps it forever.
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, 'user_A');
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'full',
      writingInputMode: 'transcribe',
    });
    const { courseId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );
    await drainScheduled(t);

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 7,
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      currentLevel: 'beginner',
      reviewMode: 'audio',
      writingInputMode: null,
    });
    await asUser.mutation(api.features.onboarding.finalizeOnboarding, {});

    const courseSettings = await t.run(async (ctx) =>
      ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
        .first(),
    );
    expect(courseSettings?.reviewMode).toBe('audio');
    expect(courseSettings?.writingInputMode).toBeUndefined();
  });
});

describe('warmupOnboardingTranslations', () => {
  async function seedPlacementSentences(
    t: TestConvex<typeof schema>,
    count: number,
  ) {
    await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert('collections', {
        name: 'Placement',
        textCount: count,
        origin: 'premade',
      });
      for (let i = 0; i < count; i++) {
        const textId = await ctx.db.insert('texts', {
          text: `placement ${i}`,
          language: 'en',
          userCreated: false,
          collectionId,
          collectionRank: i,
        });
        await ctx.db.insert('placementTestSentences', {
          level: 1 + (i % 20),
          position: i % 5,
          textId,
        });
      }
    });
  }

  it('rejects unknown language codes', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.features.onboarding.warmupOnboardingTranslations, {
        languages: ['xx_not_a_language'],
      }),
    ).rejects.toThrow(/Unknown language code/);
  });

  it('is a no-op for an empty languages list', async () => {
    const t = convexTest(schema, modules);
    await seedPlacementSentences(t, 3);
    const result = await t.mutation(
      internal.features.onboarding.warmupOnboardingTranslations,
      { languages: [] },
    );
    expect(result).toEqual({ languages: 0, texts: 0, batches: 0 });
  });

  it('fans out placement sentences + the first texts of each level collection for a single language', async () => {
    const t = convexTest(schema, modules);
    await seedPlacementSentences(t, 7);
    // Two level collections with 6 curriculum texts each → first 5 of each.
    await seedActiveDataset(t, [1, 2]);

    const result = await t.mutation(
      internal.features.onboarding.warmupOnboardingTranslations,
      { languages: ['fr'] },
    );
    expect(result.languages).toBe(1);
    // 7 placement texts + 2 collections × first 5 texts (no overlap).
    expect(result.texts).toBe(17);
    // One language → up to 100 texts per batch → a single batch.
    expect(result.batches).toBe(1);
  });

  it('splits batches so texts × languages stays bounded', async () => {
    const t = convexTest(schema, modules);
    await seedPlacementSentences(t, 60);

    const result = await t.mutation(
      internal.features.onboarding.warmupOnboardingTranslations,
      { languages: ['fr', 'de', 'es'] },
    );
    // 3 languages → 33 texts per batch → 60 texts need 2 batches.
    expect(result.texts).toBe(60);
    expect(result.batches).toBe(2);
  });
  it("skips user forks so they can't consume the per-collection window", async () => {
    // Regression: the per-collection query used `by_collection_and_rank`
    // without the `userCreated: false` filter every other premade-level read
    // applies. A user fork sitting at a low rank ate one of the five slots.
    // Paying for a private fork's translations while a curriculum text that
    // the placement flow actually shows stayed cold.
    const t = convexTest(schema, modules);
    const byCode = await seedActiveDataset(t, [1]);
    await t.run(async (ctx) => {
      // Two forks ranked ahead of the curriculum texts (rank 0..5).
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert('texts', {
          text: `fork ${i}`,
          language: 'en',
          userCreated: true,
          userId: 'user_A',
          collectionId: Object.values(byCode)[0],
          collectionRank: -10 + i,
        });
      }
    });

    await t.mutation(
      internal.features.onboarding.warmupOnboardingTranslations,
      { languages: ['fr'] },
    );

    // The COUNT alone can't tell the two behaviours apart (take(5) returns
    // five rows either way), assert on which texts were actually fanned out.
    const scheduledTextIds = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect();
      return jobs.flatMap(
        (job) => (job.args[0] as { textIds: Id<'texts'>[] }).textIds,
      );
    });
    const texts = await t.run(async (ctx) =>
      Promise.all(scheduledTextIds.map((id) => ctx.db.get(id))),
    );
    expect(texts).toHaveLength(5);
    expect(texts.every((text) => text?.userCreated === false)).toBe(true);
  });
});

describe('getOnboardingProgress', () => {
  it('returns a fully-populated in-progress row field-by-field', async () => {
    const t = convexTest(schema, modules);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert('onboardingProgress', {
        userId: 'user_A',
        step: 9,
        reviewMode: 'audio',
        currentLevel: 'intermediate',
        targetLanguages: ['es'],
        baseLanguages: ['en'],
        acquisitionSource: 'reddit',
        acquisitionSourceFreeText: 'saw a post about it',
        learningGoals: ['travel', 'work'],
        learningGoalFreeText: 'order food abroad',
        dailyTimeGoalMinutes: 20,
        firstLessonCardsRated: 4,
        firstLessonSessionId: 'sess_1',
        firstLessonSummary: {
          cardsRated: 10,
          sessionId: 'sess_1',
          dailyReviewsToday: 10,
          dailyTimeMsToday: 300_000,
          dailyNewWordsToday: 12,
        },
        placementTest: {
          strategyVersion: 2,
          strategy: 'staircase',
          history: [
            { level: 8, knew: true },
            { level: 10, knew: false },
          ],
          finalLevel: 9,
        },
      }),
    );

    const asUser = t.withIdentity({ subject: 'user_A' });
    const progress = await asUser.query(
      api.features.courses.getOnboardingProgress,
      {},
    );

    expect(progress).toEqual({
      _id: rowId,
      _creationTime: expect.any(Number),
      userId: 'user_A',
      step: 9,
      reviewMode: 'audio',
      currentLevel: 'intermediate',
      targetLanguages: ['es'],
      baseLanguages: ['en'],
      acquisitionSource: 'reddit',
      acquisitionSourceFreeText: 'saw a post about it',
      learningGoals: ['travel', 'work'],
      learningGoalFreeText: 'order food abroad',
      dailyTimeGoalMinutes: 20,
      firstLessonCardsRated: 4,
      firstLessonSessionId: 'sess_1',
      firstLessonSummary: {
        cardsRated: 10,
        sessionId: 'sess_1',
        dailyReviewsToday: 10,
        dailyTimeMsToday: 300_000,
        dailyNewWordsToday: 12,
      },
      placementTest: {
        strategyVersion: 2,
        strategy: 'staircase',
        history: [
          { level: 8, knew: true },
          { level: 10, knew: false },
        ],
        finalLevel: 9,
      },
    });
    expect(progress?.completedAt).toBeUndefined();
  });
});

describe('prepareLanguagePair', () => {
  it('schedules the two immediate warmups and the 60s audio backstop with wrapped language args', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });

    const before = Date.now();
    await asUser.mutation(api.features.onboarding.prepareLanguagePair, {
      sourceLanguage: 'en',
      targetLanguage: 'es',
    });
    const after = Date.now();

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    expect(scheduled).toHaveLength(3);

    // Level-collection warmup: single languages wrapped into arrays.
    const warmup = scheduled.find((s) =>
      s.name.includes('ensureFirstSentencesAcrossLevelCollections'),
    );
    expect(warmup).toBeDefined();
    expect(warmup!.args).toEqual([
      { baseLanguages: ['en'], targetLanguages: ['es'] },
    ]);
    expect(warmup!.scheduledTime).toBeLessThanOrEqual(after);

    const placement = scheduled.find((s) =>
      s.name.includes('enqueueMissingPlacementTranslations'),
    );
    expect(placement).toBeDefined();
    expect(placement!.args).toEqual([
      { targetLanguage: 'es', sourceLanguage: 'en' },
    ]);
    expect(placement!.scheduledTime).toBeLessThanOrEqual(after);

    const backstop = scheduled.find((s) =>
      s.name.includes('ensureAudioForTestTranslations'),
    );
    expect(backstop).toBeDefined();
    expect(backstop!.args).toEqual([
      { targetLanguage: 'es', sourceLanguage: 'en' },
    ]);
    expect(backstop!.scheduledTime).toBeGreaterThanOrEqual(before + 60_000);
    expect(backstop!.scheduledTime).toBeLessThanOrEqual(after + 60_000);

    await drainScheduled(t);
  });

  it('consumes the per-user onboardingContentWarmup budget', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });
    await asUser.mutation(api.features.onboarding.prepareLanguagePair, {
      sourceLanguage: 'en',
      targetLanguage: 'es',
    });
    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'onboardingContentWarmup',
      expect.objectContaining({ key: expect.any(String) }),
    );
    await drainScheduled(t);
  });
});

/**
 * Assert a mutation rejects with a structured ConvexError carrying `code`,
 * and return the error data for further checks.
 */
async function expectStructuredRejection(
  promise: Promise<unknown>,
  code: string,
): Promise<Record<string, unknown>> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError);
    // convex-test re-serializes ConvexError data to a JSON string across the
    // harness boundary (real clients get the structured value back).
    const raw = (e as { data: unknown }).data;
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<
      string,
      unknown
    >;
    expect(data.code).toBe(code);
    return data;
  }
  throw new Error(`expected a ConvexError with code ${code}`);
}

async function scheduledCount(t: TestConvex<typeof schema>): Promise<number> {
  const rows = await t.run(async (ctx) =>
    ctx.db.system.query('_scheduled_functions').collect(),
  );
  return rows.length;
}

describe('public warmup guards (prepareLanguagePair + ensurePlacementTranslations)', () => {
  it('rejects an unsupported target language with UNSUPPORTED_LANGUAGE and schedules nothing', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await expectStructuredRejection(
      asUser.mutation(api.features.onboarding.prepareLanguagePair, {
        sourceLanguage: 'en',
        targetLanguage: 'xx_nope',
      }),
      'UNSUPPORTED_LANGUAGE',
    );
    await expectStructuredRejection(
      asUser.mutation(api.features.onboarding.ensurePlacementTranslations, {
        sourceLanguage: 'en',
        targetLanguage: 'xx_nope',
      }),
      'UNSUPPORTED_LANGUAGE',
    );
    expect(await scheduledCount(t)).toBe(0);
  });

  it('rejects an unsupported SOURCE language too (it becomes a translation target)', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });
    await expectStructuredRejection(
      asUser.mutation(api.features.onboarding.prepareLanguagePair, {
        sourceLanguage: 'klingon',
        targetLanguage: 'es',
      }),
      'UNSUPPORTED_LANGUAGE',
    );
    expect(await scheduledCount(t)).toBe(0);
  });

  it('accepts an English accent variant as the source language', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });
    // en_gb shares its text with `en` (an accent-only variant) but is a real
    // course language with its own voice pool; the guard must accept it.
    await asUser.mutation(api.features.onboarding.prepareLanguagePair, {
      sourceLanguage: 'en_gb',
      targetLanguage: 'es',
    });
    expect(await scheduledCount(t)).toBe(3);
    await drainScheduled(t);
  });

  it('throws a structured RATE_LIMITED error and schedules nothing when the budget is spent', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });
    mockRateLimit.mockResolvedValue({ ok: false, retryAfter: 120_000 });

    const data = await expectStructuredRejection(
      asUser.mutation(api.features.onboarding.prepareLanguagePair, {
        sourceLanguage: 'en',
        targetLanguage: 'es',
      }),
      'RATE_LIMITED',
    );
    expect(data.retryAfter).toBe(120_000);

    await expectStructuredRejection(
      asUser.mutation(api.features.onboarding.ensurePlacementTranslations, {
        sourceLanguage: 'en',
        targetLanguage: 'es',
      }),
      'RATE_LIMITED',
    );
    expect(await scheduledCount(t)).toBe(0);
  });

  it('ensurePlacementTranslations still works for a legitimate call', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_A' });
    // Empty placement corpus → a clean no-op sweep; the point is that the
    // guards let the real flow through.
    const res = await asUser.mutation(
      api.features.onboarding.ensurePlacementTranslations,
      { sourceLanguage: 'en', targetLanguage: 'es' },
    );
    expect(res).toEqual({ enqueued: 0 });
    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'onboardingContentWarmup',
      expect.objectContaining({ key: expect.any(String) }),
    );
  });
});
