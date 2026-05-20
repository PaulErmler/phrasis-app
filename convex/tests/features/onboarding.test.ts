/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";

// Stub the aggregate component — production code instantiates
// `new TableAggregate(components.cardsByState, ...)` at module-load, and
// the aggregate component is not registered with convex-test here.
vi.mock("@convex-dev/aggregate", () => {
  class TableAggregate {
    constructor(_component: unknown, _opts: unknown) {}
    async insertIfDoesNotExist(): Promise<void> {}
    async replaceOrInsert(): Promise<void> {}
    async deleteIfExists(): Promise<void> {}
    async count(): Promise<number> {
      return 0;
    }
  }
  return { TableAggregate };
});

import schema from "../../schema";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  ONBOARDING_INITIAL_SEED_CARDS,
  ONBOARDING_CARDS_BATCH_SIZE,
  MAX_ONBOARDING_FREE_TEXT_LENGTH,
} from "../../../lib/constants/onboarding";

const modules = import.meta.glob("/convex/**/*.ts");

/**
 * `completeOnboarding` schedules background warmup via `ctx.scheduler.runAfter`
 * (translation queue, audio warmup). Those scheduled functions fire *after*
 * the test's synchronous mutation returns, but by then the convex-test
 * harness has torn down their `_scheduled_functions` row — they crash inside
 * the harness with "Cannot read properties of null (reading 'state')" and
 * surface as unhandled rejections that pollute the test output.
 *
 * None of that affects the assertions we make (we read DB state straight
 * after the mutation, before any scheduled work runs).
 *
 * Suppression strategy:
 *   1. **unhandledRejection** — vitest's worker listener
 *      (init.D98-gwRW.js:105) reports the error only when
 *      `processListeners('unhandledRejection').length === 1`. We register a
 *      second listener that pattern-matches the known scheduler-teardown
 *      crashes; for those, do nothing (vitest's listener returns early
 *      because `length > 1`). For genuinely unexpected unhandled rejections
 *      we re-throw to a microtask so vitest still surfaces them.
 *   2. **console.error** — convex-test's scheduler logs failed scheduled
 *      functions via `console.error`. Filter the known patterns so the
 *      report stays readable.
 */
const SCHEDULER_NOISE = /(Cannot read properties of null \(reading 'state'\)|Transaction already committed or rolled back|Error when running scheduled function|AUTUMN_SECRET_KEY environment variable)/;

// Register the noise filters at MODULE TOP LEVEL (not in beforeAll/afterAll).
// The deferred scheduled functions can fire after vitest's afterAll cleanup —
// if we'd removed the listener by then, the rejection slips through to
// vitest's worker handler.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (SCHEDULER_NOISE.test(msg)) return;
  // Re-throw asynchronously so legitimate unhandled rejections still surface.
  setTimeout(() => {
    throw reason instanceof Error ? reason : new Error(String(reason));
  }, 0);
});

const realConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const msg = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
  if (SCHEDULER_NOISE.test(msg)) return;
  realConsoleError(...args);
};

async function seedQuota(t: ReturnType<typeof convexTest>, userId: string) {
  await t.run(async (ctx) =>
    ctx.db.insert("usageQuotas", {
      userId,
      features: {
        courses: { balance: 5, included: 5, used: 0, unlimited: false },
        sentences: { balance: 100, included: 100, used: 0, unlimited: false },
        multiple_languages: { balance: 1, included: 1, used: 0, unlimited: true },
        chat_messages: { balance: 100, included: 100, used: 0, unlimited: false },
        custom_sentences: { balance: 100, included: 100, used: 0, unlimited: false },
        transcriptions: { balance: 100, included: 100, used: 0, unlimited: false },
        card_edits: { balance: 100, included: 100, used: 0, unlimited: false },
        translation_auto_fill: { balance: 100, included: 100, used: 0, unlimited: false },
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
  t: ReturnType<typeof convexTest>,
): Promise<Id<"collections">> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("collections", {
      name: "Essential",
      textCount: 12,
      origin: "premade",
    });
    for (let i = 0; i < 12; i++) {
      await ctx.db.insert("texts", {
        text: `essential ${i}`,
        language: "en",
        userCreated: false,
        collectionId: id,
        collectionRank: i,
      });
    }
    return id;
  });
}

/**
 * Seed the `placement-test-pool` collection with 5 English texts.
 */
async function seedPlacementPool(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"collections">> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("collections", {
      name: "placement-test-pool",
      textCount: 5,
      displayName: "Placement Test Pool",
      origin: "premade",
    });
    for (let i = 0; i < 5; i++) {
      await ctx.db.insert("texts", {
        text: `placement ${i}`,
        language: "en",
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
async function drainScheduled(t: ReturnType<typeof convexTest>) {
  try {
    await t.finishInProgressScheduledFunctions();
  } catch {
    // Scheduled functions can fail in the test harness when they hit real
    // network paths — that's fine; we only care about the in-memory state
    // the synchronous mutation already produced.
  }
}

describe("completeOnboarding", () => {
  it("creates a course, deck, and seeds exactly ONBOARDING_INITIAL_SEED_CARDS cards with the matching batch size on settings", async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, "user_A");
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ["es"],
      baseLanguages: ["en"],
      currentLevel: "beginner",
      reviewMode: "audio",
    });

    const { courseId, deckId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );

    expect(courseId).toBeDefined();
    expect(deckId).toBeDefined();

    const cards = await t.run(async (ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_deckId", (q) => q.eq("deckId", deckId))
        .collect(),
    );
    // Onboarding seeds the initial-seed count upfront; the first lesson runs
    // longer (10 reviews) and the gap is filled by the auto-add path.
    expect(cards.length).toBe(ONBOARDING_INITIAL_SEED_CARDS);

    const settings = await t.run(async (ctx) =>
      ctx.db
        .query("courseSettings")
        .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
        .first(),
    );
    expect(settings?.cardsToAddBatchSize).toBe(ONBOARDING_CARDS_BATCH_SIZE);
    expect(settings?.autoAddCards).toBe(true);

    await drainScheduled(t);
  });

  it("is idempotent — a second call returns the same course/deck and does not double-consume quota", async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, "user_A");
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ["es"],
      baseLanguages: ["en"],
      currentLevel: "beginner",
      reviewMode: "audio",
    });

    const first = await asUser.mutation(api.features.courses.completeOnboarding, {});
    await drainScheduled(t);
    const second = await asUser.mutation(api.features.courses.completeOnboarding, {});

    expect(second.courseId).toEqual(first.courseId);
    expect(second.deckId).toEqual(first.deckId);

    const quota = await t.run(async (ctx) =>
      ctx.db
        .query("usageQuotas")
        .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
        .first(),
    );
    expect(quota?.features.courses.used).toBe(1);

    // Cards should still be exactly the initial seed — no double-seeding on
    // the second call. Without the idempotency guard this would be
    // 2 * ONBOARDING_INITIAL_SEED_CARDS (or fail elsewhere).
    const cards = await t.run(async (ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_deckId", (q) => q.eq("deckId", first.deckId))
        .collect(),
    );
    expect(cards.length).toBe(ONBOARDING_INITIAL_SEED_CARDS);

    await drainScheduled(t);
  });

  it("pins the active course on userSettings without flipping hasCompletedOnboarding", async () => {
    const t = convexTest(schema, modules);
    await seedEssentialCollection(t);
    await seedQuota(t, "user_A");
    const asUser = t.withIdentity({ subject: "user_A" });

    // The onboarding-answer fields (acquisitionSource, learningGoals,
    // dailyTimeGoalMinutes, placementTest) live only on
    // `onboardingProgress` and are discarded on finalizeOnboarding —
    // userSettings only carries identity + activeCourseId + tutorial state.
    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ["es"],
      baseLanguages: ["en"],
      currentLevel: "beginner",
      reviewMode: "audio",
      acquisitionSource: "reddit",
      learningGoals: ["travel", "work"],
      dailyTimeGoalMinutes: 20,
      placementTest: {
        strategy: "staircase",
        history: [
          { level: 8, knew: true },
          { level: 10, knew: false },
        ],
        finalLevel: 9,
      },
    });
    await asUser.mutation(api.features.courses.completeOnboarding, {});

    const settings = await asUser.query(api.features.courses.getUserSettings, {});
    expect(settings?.hasCompletedOnboarding).toBe(false);
    expect(settings?.activeCourseId).toBeDefined();

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
    await seedQuota(t, "user_A");
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 6,
      targetLanguages: ["es"],
      baseLanguages: ["en"],
      currentLevel: "beginner",
      reviewMode: "audio",
    });
    const { deckId } = await asUser.mutation(
      api.features.courses.completeOnboarding,
      {},
    );

    const cards = await t.run(async (ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_deckId", (q) => q.eq("deckId", deckId))
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

describe("saveOnboardingProgress — free-text length guard", () => {
  it("accepts free-text up to MAX_ONBOARDING_FREE_TEXT_LENGTH", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_A" });

    await expect(
      asUser.mutation(api.features.courses.saveOnboardingProgress, {
        step: 2,
        acquisitionSourceFreeText: "x".repeat(MAX_ONBOARDING_FREE_TEXT_LENGTH),
        learningGoalFreeText: "y".repeat(MAX_ONBOARDING_FREE_TEXT_LENGTH),
      }),
    ).resolves.toBeDefined();
  });

  it("rejects acquisitionSourceFreeText longer than the cap", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_A" });

    await expect(
      asUser.mutation(api.features.courses.saveOnboardingProgress, {
        step: 2,
        acquisitionSourceFreeText: "x".repeat(MAX_ONBOARDING_FREE_TEXT_LENGTH + 1),
      }),
    ).rejects.toThrow(/acquisitionSourceFreeText/);
  });

  it("rejects learningGoalFreeText longer than the cap", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_A" });

    await expect(
      asUser.mutation(api.features.courses.saveOnboardingProgress, {
        step: 3,
        learningGoalFreeText: "x".repeat(MAX_ONBOARDING_FREE_TEXT_LENGTH + 1),
      }),
    ).rejects.toThrow(/learningGoalFreeText/);
  });
});

describe("finalizeOnboarding", () => {
  it("flips hasCompletedOnboarding, deletes progress, and pre-marks in-lesson tutorials", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 12,
      targetLanguages: ["es"],
      baseLanguages: ["en"],
      currentLevel: "beginner",
    });

    const { alreadyFinalized } = await asUser.mutation(
      api.features.onboarding.finalizeOnboarding,
      {},
    );
    expect(alreadyFinalized).toBe(false);

    const settings = await asUser.query(api.features.courses.getUserSettings, {});
    expect(settings?.hasCompletedOnboarding).toBe(true);
    expect(settings?.completedTutorials).toContain("full_review_intro");
    expect(settings?.completedTutorials).toContain("audio_review_intro");
    // home_tour is intentionally NOT pre-marked.
    expect(settings?.completedTutorials).not.toContain("home_tour");

    const progress = await asUser.query(
      api.features.courses.getOnboardingProgress,
      {},
    );
    expect(progress).toBeNull();
  });

  it("is idempotent — a second call reports alreadyFinalized and does not duplicate tutorial entries", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.courses.saveOnboardingProgress, {
      step: 12,
      targetLanguages: ["es"],
      baseLanguages: ["en"],
      currentLevel: "beginner",
    });
    await asUser.mutation(api.features.onboarding.finalizeOnboarding, {});
    const second = await asUser.mutation(
      api.features.onboarding.finalizeOnboarding,
      {},
    );

    expect(second.alreadyFinalized).toBe(true);

    const settings = await asUser.query(api.features.courses.getUserSettings, {});
    const completed = settings?.completedTutorials ?? [];
    expect(
      completed.filter((id) => id === "full_review_intro").length,
    ).toBe(1);
    expect(
      completed.filter((id) => id === "audio_review_intro").length,
    ).toBe(1);
  });
});
