/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";

import schema from "../../schema";
import { api } from "../../_generated/api";
import type { Id, TableNames } from "../../_generated/dataModel";
import { UNREVERSED_STAT_FIELDS } from "../../db/stats/reverseReviewStats";
import {
  PROGRESS_DISPLAY_INTERVAL,
  UNDO_DEPTH,
} from "../../../lib/constants/learning";

const modules = import.meta.glob("/convex/**/*.ts");

const today = () => new Date().toISOString().slice(0, 10);

/** Seed a user with an active course, stats row, deck, and one due card
 * (including a translation so word tracking runs). Mirrors the seeding in
 * scheduling.test.ts. */
async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 0,
    });
    const courseId = await ctx.db.insert("courses", {
      userId: "user_A",
      baseLanguages: ["en"],
      targetLanguages: ["es"],
    });
    await ctx.db.insert("userSettings", {
      userId: "user_A",
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    await ctx.db.insert("courseStats", {
      userId: "user_A",
      courseId,
      totalRepetitions: 0,
      totalTimeMs: 0,
      totalCards: 0,
      currentStreak: 0,
    });
    await ctx.db.insert("collectionProgress", {
      userId: "user_A",
      courseId,
      collectionId,
      cardsAdded: 1,
      cardsLearned: 0,
    });
    const deckId = await ctx.db.insert("decks", {
      courseId,
      name: "d",
      cardCount: 1,
    });
    const textId = await ctx.db.insert("texts", {
      text: "Hola mundo",
      language: "es",
      userCreated: true,
      userId: "user_A",
      collectionId,
      collectionRank: 1,
    });
    await ctx.db.insert("translations", {
      textId,
      targetLanguage: "en",
      translatedText: "Hello world",
    });
    const cardId = await ctx.db.insert("cards", {
      deckId,
      textId,
      collectionId,
      dueDate: Date.now() - 1000,
      isMastered: false,
      isHidden: false,
      schedulingPhase: "preReview",
      preReviewCount: 0,
    });
    return { cardId, courseId, deckId, textId, collectionId };
  });
}

/** Add a second due card (later dueDate than the first) to an existing deck. */
async function addCard(
  t: ReturnType<typeof convexTest>,
  deckId: Id<"decks">,
  collectionId: Id<"collections">,
  dueOffsetMs = -500,
) {
  return t.run(async (ctx) => {
    const textId = await ctx.db.insert("texts", {
      text: "Buenos días",
      language: "es",
      userCreated: true,
      userId: "user_A",
      collectionId,
      collectionRank: 2,
    });
    return ctx.db.insert("cards", {
      deckId,
      textId,
      collectionId,
      dueDate: Date.now() + dueOffsetMs,
      isMastered: false,
      isHidden: false,
      schedulingPhase: "preReview",
      preReviewCount: 0,
    });
  });
}

const getCard = (t: ReturnType<typeof convexTest>, cardId: Id<"cards">) =>
  t.run((ctx) => ctx.db.get(cardId));

const getDaily = (
  t: ReturnType<typeof convexTest>,
  courseId: Id<"courses">,
) =>
  t.run((ctx) =>
    ctx.db
      .query("dailyStats")
      .withIndex("by_userId_and_courseId_and_date", (q) =>
        q.eq("userId", "user_A").eq("courseId", courseId).eq("date", today()),
      )
      .first(),
  );

const getCourseStats = (
  t: ReturnType<typeof convexTest>,
  courseId: Id<"courses">,
) =>
  t.run((ctx) =>
    ctx.db
      .query("courseStats")
      .withIndex("by_userId_and_courseId", (q) =>
        q.eq("userId", "user_A").eq("courseId", courseId),
      )
      .first(),
  );

describe("features/scheduling — undoLastReview", () => {
  it("throws unauthenticated; count is 0", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.features.scheduling.undoLastReview, { timezone: "UTC" }),
    ).rejects.toThrow();
    expect(
      await t.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(0);
  });

  it("returns nothing_to_undo when no reviews were made", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asUser = t.withIdentity({ subject: "user_A" });
    const res = await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    expect(res).toEqual({ status: "nothing_to_undo" });
  });

  it("restores the card's exact pre-review scheduling state", async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seed(t);
    const before = await getCard(t, cardId);
    const asUser = t.withIdentity({ subject: "user_A" });

    // 'understood' jumps the card straight into the FSRS review phase, so the
    // undo must also unset fsrsState/isGraduated again.
    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: "understood",
      timezone: "UTC",
      timeSpentMs: 4_000,
    });
    const reviewed = await getCard(t, cardId);
    expect(reviewed?.schedulingPhase).toBe("review");
    expect(reviewed?.fsrsState).toBeDefined();
    expect(reviewed?.lastReviewedAt).toBeDefined();

    const res = await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    expect(res.status).toBe("undone");
    if (res.status === "undone") expect(res.cardId).toBe(cardId);

    const after = await getCard(t, cardId);
    expect(after?.schedulingPhase).toBe("preReview");
    expect(after?.preReviewCount).toBe(0);
    expect(after?.dueDate).toBe(before?.dueDate); // exact, jitter and all
    expect(after?.fsrsState).toBeUndefined();
    expect(after?.isGraduated).toBeUndefined();
    expect(after?.lastReviewedAt).toBeUndefined();
    // Word tracking deliberately survives the undo (prevents double-tracking).
    expect(after?.wordsTrackedLanguages).toEqual(
      reviewed?.wordsTrackedLanguages,
    );
  });

  it("reverses counting stats but keeps time, streak, and words", async () => {
    const t = convexTest(schema, modules);
    const { cardId, courseId, collectionId } = await seed(t);
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: "understood",
      timezone: "UTC",
      timeSpentMs: 4_000,
      reviewMode: "audio",
    });
    await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });

    const stats = await getCourseStats(t, courseId);
    expect(stats?.totalRepetitions).toBe(0);
    expect(stats?.totalCards).toBe(0); // first review reversed
    expect(stats?.totalReviewsByMode?.audio ?? 0).toBe(0);
    expect(stats?.totalTimeMs).toBe(4_000); // time kept
    expect(stats?.currentStreak).toBe(1); // streak kept
    expect(stats?.lastActivityDate).toBe(today());
    expect(stats?.totalWordCount).toBe(4); // words kept (hola mundo hello world)

    const daily = await getDaily(t, courseId);
    expect(daily?.reps).toBe(0);
    expect(daily?.cardsReviewed).toBe(0);
    expect(daily?.newCards).toBe(0);
    expect(daily?.ratingCounts?.understood).toBe(0);
    expect(daily?.reviewsByMode?.audio).toBe(0);
    expect(daily?.timeMs).toBe(4_000); // time kept
    expect(daily?.timeMsByMode?.audio).toBe(4_000);
    expect((daily?.hourBuckets ?? []).reduce((a, b) => a + b, 0)).toBe(0);
    expect(daily?.reviewsByCardState?.new).toBe(0);

    const [weekly, monthly, yearly, langStats, dailyLang, progress] =
      await t.run(async (ctx) => {
        return Promise.all([
          ctx.db.query("weeklyStats").first(),
          ctx.db.query("monthlyStats").first(),
          ctx.db.query("yearlyStats").first(),
          ctx.db.query("languageStats").collect(),
          ctx.db.query("dailyLanguageStats").collect(),
          ctx.db
            .query("collectionProgress")
            .withIndex("by_userId_and_courseId_and_collectionId", (q) =>
              q
                .eq("userId", "user_A")
                .eq("courseId", courseId)
                .eq("collectionId", collectionId),
            )
            .first(),
        ]);
      });
    expect(weekly?.totalRepetitions).toBe(0);
    expect(weekly?.totalNewCards).toBe(0);
    expect(weekly?.totalTimeMs).toBe(4_000); // time kept
    expect(weekly?.activeDays).toBe(1); // activity kept
    expect(monthly?.totalRepetitions).toBe(0);
    expect(yearly?.totalRepetitions).toBe(0);
    for (const row of langStats) {
      expect(row.totalRepetitions).toBe(0);
      expect(row.totalNewCards).toBe(0);
      expect(row.totalTimeMs).toBe(2_000); // split across 2 languages, kept
      expect(row.totalWords).toBe(2); // words kept
    }
    for (const row of dailyLang) {
      expect(row.reps).toBe(0);
      expect(row.newCards).toBe(0);
      expect(row.timeMs).toBe(2_000);
      expect(row.newWordsCount).toBe(2);
    }
    expect(progress?.cardsLearned).toBe(0); // first review reversed
  });

  it("does not double-count first-review stats or words on re-review", async () => {
    const t = convexTest(schema, modules);
    const { cardId, courseId, collectionId } = await seed(t);
    const asUser = t.withIdentity({ subject: "user_A" });

    const review = () =>
      asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: "understood",
        timezone: "UTC",
        timeSpentMs: 1_000,
      });
    await review();
    await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    await review();

    const stats = await getCourseStats(t, courseId);
    expect(stats?.totalRepetitions).toBe(1);
    expect(stats?.totalCards).toBe(1);
    expect(stats?.totalWordCount).toBe(4); // not doubled
    expect(stats?.totalTimeMs).toBe(2_000); // both time spends kept

    const userWords = await t.run((ctx) => ctx.db.query("userWords").collect());
    expect(userWords.length).toBe(4); // not doubled

    const progress = await t.run((ctx) =>
      ctx.db
        .query("collectionProgress")
        .withIndex("by_userId_and_courseId_and_collectionId", (q) =>
          q
            .eq("userId", "user_A")
            .eq("courseId", courseId)
            .eq("collectionId", collectionId),
        )
        .first(),
    );
    expect(progress?.cardsLearned).toBe(1);
  });

  it("caps the stack at UNDO_DEPTH and pops LIFO through intermediate states", async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seed(t);
    const asUser = t.withIdentity({ subject: "user_A" });

    // Review the same card UNDO_DEPTH + 1 times, snapshotting the card after
    // each review. Pick a phase-appropriate rating each round so this stays
    // valid for any UNDO_DEPTH (the card can graduate out of preReview).
    const snapshots: Array<{
      dueDate: number;
      preReviewCount: number;
      schedulingPhase: string;
    }> = [];
    for (let i = 0; i < UNDO_DEPTH + 1; i++) {
      const card = await getCard(t, cardId);
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: card?.schedulingPhase === "preReview" ? "stillLearning" : "again",
        timezone: "UTC",
      });
      const after = await getCard(t, cardId);
      snapshots.push({
        dueDate: after!.dueDate,
        preReviewCount: after!.preReviewCount,
        schedulingPhase: after!.schedulingPhase,
      });
    }

    // UNDO_DEPTH + 1 reviews, but the stack is trimmed to UNDO_DEPTH.
    expect(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(UNDO_DEPTH);

    // Each undo steps LIFO back through the exact intermediate states
    // (jittered dueDates and all).
    for (let k = 1; k <= UNDO_DEPTH; k++) {
      const res = await asUser.mutation(
        api.features.scheduling.undoLastReview,
        { timezone: "UTC" },
      );
      expect(res.status).toBe("undone");
      const card = await getCard(t, cardId);
      const expected = snapshots[snapshots.length - 1 - k];
      expect(card?.dueDate).toBe(expected.dueDate);
      expect(card?.preReviewCount).toBe(expected.preReviewCount);
      expect(card?.schedulingPhase).toBe(expected.schedulingPhase);
    }

    // Depth exhausted — the oldest review's log entry was trimmed away, so
    // the very first review can't be undone.
    const res = await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    expect(res).toEqual({ status: "nothing_to_undo" });
    expect(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(0);
  });

  it("still undoes a card that was mastered after the review (without unmastering it)", async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seed(t);
    const before = await getCard(t, cardId);
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: "understood",
      timezone: "UTC",
    });
    await asUser.mutation(api.features.scheduling.masterCard, { cardId });

    const res = await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    expect(res.status).toBe("undone");
    const after = await getCard(t, cardId);
    expect(after?.isMastered).toBe(true); // mastery untouched
    expect(after?.schedulingPhase).toBe("preReview"); // scheduling restored
    expect(after?.dueDate).toBe(before?.dueDate);
  });

  it("skips entries whose card was deleted and undoes the next one", async () => {
    const t = convexTest(schema, modules);
    const { cardId: cardA, deckId, collectionId } = await seed(t);
    const cardB = await addCard(t, deckId, collectionId);
    const beforeA = await getCard(t, cardA);
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId: cardA,
      rating: "stillLearning",
      timezone: "UTC",
    });
    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId: cardB,
      rating: "stillLearning",
      timezone: "UTC",
    });
    await t.run((ctx) => ctx.db.delete(cardB));

    const res = await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    expect(res.status).toBe("undone");
    if (res.status === "undone") expect(res.cardId).toBe(cardA);
    const afterA = await getCard(t, cardA);
    expect(afterA?.preReviewCount).toBe(0);
    expect(afterA?.dueDate).toBe(beforeA?.dueDate);
    // B's discarded entry is gone too.
    expect(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(0);
  });

  it("makes the undone card the next card for review again", async () => {
    const t = convexTest(schema, modules);
    const { cardId: cardA, deckId, collectionId } = await seed(t);
    await addCard(t, deckId, collectionId);
    const asUser = t.withIdentity({ subject: "user_A" });

    const first = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    expect(first?._id).toBe(cardA);

    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId: cardA,
      rating: "stillLearning",
      timezone: "UTC",
    });
    const next = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    expect(next?._id).not.toBe(cardA);

    await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    const restored = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    expect(restored?._id).toBe(cardA);
  });

  it("undoes radio plays: rotation restored, radio stats reversed, time kept", async () => {
    const t = convexTest(schema, modules);
    const { cardId: cardA, courseId, deckId, collectionId } = await seed(t);
    await addCard(t, deckId, collectionId);
    await t.run(async (ctx) => {
      await ctx.db.insert("courseSettings", {
        courseId,
        initialReviewCount: 3,
        schedulingMode: "radio",
      });
    });
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.scheduling.advanceRadioCard, {
      cardId: cardA,
      timezone: "UTC",
      timeSpentMs: 3_000,
    });
    const played = await getCard(t, cardA);
    expect(played?.radioRoundCounter).toBe(1);
    expect(played?.radioPlayCount).toBe(1);

    expect(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(1);
    const res = await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    expect(res.status).toBe("undone");

    const after = await getCard(t, cardA);
    expect(after?.radioRoundCounter).toBeUndefined();
    expect(after?.radioOrderKey).toBeUndefined();
    expect(after?.radioPlayCount).toBeUndefined();
    expect(after?.lastReviewedAt).toBeUndefined();

    const stats = await getCourseStats(t, courseId);
    expect(stats?.totalRepetitions).toBe(0);
    expect(stats?.totalReviewsByMode?.radio ?? 0).toBe(0);
    expect(stats?.totalTimeMs).toBe(3_000); // time kept
    const daily = await getDaily(t, courseId);
    expect(daily?.reps).toBe(0);
    expect(daily?.cardsReviewed).toBe(0);
    expect(daily?.reviewsByMode?.radio).toBe(0);
    expect(daily?.timeMs).toBe(3_000);

    // Radio queue serves the undone card first again (counter back to floor).
    const nextRadio = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    expect(nextRadio?._id).toBe(cardA);
  });

  it("scopes undo to the current study context (mode switch greys out; newer entries block older ones)", async () => {
    const t = convexTest(schema, modules);
    const { cardId: cardA, courseId, deckId, collectionId } = await seed(t);
    const cardB = await addCard(t, deckId, collectionId);
    const settingsId = await t.run((ctx) =>
      ctx.db.insert("courseSettings", { courseId, initialReviewCount: 3 }),
    );
    const asUser = t.withIdentity({ subject: "user_A" });

    // Review A under the default context (learnAndReview / both).
    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId: cardA,
      rating: "stillLearning",
      timezone: "UTC",
    });
    expect(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(1);

    // Switch to radio: A's entry no longer matches → greyed out.
    await t.run((ctx) => ctx.db.patch(settingsId, { schedulingMode: "radio" }));
    expect(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(0);
    expect(
      await asUser.mutation(api.features.scheduling.undoLastReview, {
        timezone: "UTC",
      }),
    ).toEqual({ status: "nothing_to_undo" });

    // Switch back without reviewing: A undoable again.
    await t.run((ctx) =>
      ctx.db.patch(settingsId, { schedulingMode: "learnAndReview" }),
    );
    expect(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(1);

    // Radio-play B under radio, then switch back: B's newer mismatching entry
    // permanently blocks A's.
    await t.run((ctx) => ctx.db.patch(settingsId, { schedulingMode: "radio" }));
    await asUser.mutation(api.features.scheduling.advanceRadioCard, {
      cardId: cardB,
      timezone: "UTC",
    });
    await t.run((ctx) =>
      ctx.db.patch(settingsId, { schedulingMode: "learnAndReview" }),
    );
    expect(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(0);

    // Undo B's play while in radio → A becomes reachable again.
    await t.run((ctx) => ctx.db.patch(settingsId, { schedulingMode: "radio" }));
    const undoneRadio = await asUser.mutation(
      api.features.scheduling.undoLastReview,
      { timezone: "UTC" },
    );
    expect(undoneRadio.status).toBe("undone");
    await t.run((ctx) =>
      ctx.db.patch(settingsId, { schedulingMode: "learnAndReview" }),
    );
    expect(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(1);
  });

  it("never replays a celebration after undo + re-review, and the displayed count stays at the milestone", async () => {
    const t = convexTest(schema, modules);
    const { cardId, courseId } = await seed(t);
    // Land the next review exactly on the milestone.
    await t.run(async (ctx) => {
      await ctx.db.insert("dailyStats", {
        userId: "user_A",
        courseId,
        date: today(),
        reps: PROGRESS_DISPLAY_INTERVAL - 1,
        newCards: 0,
        timeMs: 0,
        cardsReviewed: PROGRESS_DISPLAY_INTERVAL - 1,
        reviewsByMode: {
          audio: PROGRESS_DISPLAY_INTERVAL - 1,
          full: 0,
          radio: 0,
        },
      });
    });
    const asUser = t.withIdentity({ subject: "user_A" });

    const milestone = await asUser.mutation(
      api.features.scheduling.reviewCard,
      { cardId, rating: "stillLearning", timezone: "UTC" },
    );
    expect(milestone.triggerCelebration).toBe(true);
    expect(milestone.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);

    // Undo: the real count drops below the milestone, but the DISPLAYED count
    // (and the in-learn progress bar) stays floored at the celebration mark.
    const undone = await asUser.mutation(
      api.features.scheduling.undoLastReview,
      { timezone: "UTC" },
    );
    expect(undone.status).toBe("undone");
    if (undone.status === "undone") {
      expect(undone.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);
    }
    const daily = await getDaily(t, courseId);
    expect(daily?.reviewsByMode?.audio).toBe(PROGRESS_DISPLAY_INTERVAL - 1);
    expect(daily?.lastCelebratedAtCount).toBe(PROGRESS_DISPLAY_INTERVAL);
    const query = await asUser.query(
      api.features.scheduling.getCardForReview,
      { timezone: "UTC" },
    );
    expect(query?.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);

    // Re-review: crosses the milestone again, but no second celebration and
    // the displayed count doesn't jump.
    const rereview = await asUser.mutation(
      api.features.scheduling.reviewCard,
      { cardId, rating: "stillLearning", timezone: "UTC" },
    );
    expect(rereview.triggerCelebration).toBe(false);
    expect(rereview.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);
  });

  it("reverses accuracy, review-depth accuracy, and default-rating counters", async () => {
    const t = convexTest(schema, modules);
    const { cardId, courseId } = await seed(t);
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: "good",
      timezone: "UTC",
      forceReviewPhase: true,
      reviewMode: "full",
      accuracy: 0.8,
      accuracyStrict: 0.8,
      accuracyLenient: 0.95,
      wasDefaultRating: true,
    });
    await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });

    const stats = await getCourseStats(t, courseId);
    expect(stats?.totalAccuracySum ?? 0).toBe(0);
    expect(stats?.totalAccuracyCount ?? 0).toBe(0);
    // The punctuation-split trio must reverse together with the legacy pair —
    // a stranded sum or count would skew the average permanently.
    expect(stats?.totalAccuracyStrictSum ?? 0).toBe(0);
    expect(stats?.totalAccuracyLenientSum ?? 0).toBe(0);
    expect(stats?.totalAccuracyDualCount ?? 0).toBe(0);
    expect(stats?.totalReviewsByMode?.full ?? 0).toBe(0);
    const daily = await getDaily(t, courseId);
    expect(daily?.accuracySum ?? 0).toBe(0);
    expect(daily?.accuracyCount ?? 0).toBe(0);
    expect(daily?.accuracyStrictSum ?? 0).toBe(0);
    expect(daily?.accuracyLenientSum ?? 0).toBe(0);
    expect(daily?.accuracyDualCount ?? 0).toBe(0);
    expect(daily?.defaultRatingUsed ?? 0).toBe(0);
    expect(daily?.ratingCounts?.good).toBe(0);
    const depthRows = await t.run((ctx) =>
      ctx.db.query("reviewDepthAccuracy").collect(),
    );
    for (const row of depthRows) {
      expect(row.accuracySum).toBe(0);
      expect(row.count).toBe(0);
    }
  });

  it("isolates undo stacks per user", async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seed(t);
    const asUserA = t.withIdentity({ subject: "user_A" });
    const asUserB = t.withIdentity({ subject: "user_B" });

    await asUserA.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: "stillLearning",
      timezone: "UTC",
    });

    // User B has no active course/stack — nothing to pop, and A's entry
    // survives untouched.
    expect(
      await asUserB.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(0);
    const res = await asUserB.mutation(
      api.features.scheduling.undoLastReview,
      { timezone: "UTC" },
    );
    expect(res).toEqual({ status: "nothing_to_undo" });
    expect(
      await asUserA.query(api.features.scheduling.getUndoableReviewCount, {}),
    ).toBe(1);
  });
});

describe("features/scheduling — record/reverse drift guard", () => {
  // Generic mirror check: snapshot every stat table, run a review + undo
  // through the real mutations, and require every field to be back at its
  // pre-review value unless UNREVERSED_STAT_FIELDS (the keep-list exported
  // by reverseReviewStats.ts) names it as deliberately kept. A stat added to
  // recordReviewStats without a matching reversal (or keep-list entry) fails
  // here — hand-picked field assertions can't catch that.
  it("undo restores every stat field a review changed, except the documented keep-list", async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seed(t);
    const asUser = t.withIdentity({ subject: "user_A" });

    const tables = Object.keys(UNREVERSED_STAT_FIELDS) as TableNames[];
    // Plain nested objects (table -> _id -> row): t.run results must be
    // Convex-serializable, so no Maps.
    const snapshot = () =>
      t.run(async (ctx) => {
        const out: Record<
          string,
          Record<string, Record<string, unknown>>
        > = {};
        for (const table of tables) {
          const rows = await ctx.db.query(table).collect();
          out[table] = Object.fromEntries(
            rows.map((r) => [String(r._id), r as Record<string, unknown>]),
          );
        }
        return out;
      });

    const before = await snapshot();
    // Exercise every optional counter path: mode counts, accuracy fields,
    // default-rating counters, hour buckets, first-review (new-card) fields.
    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: "understood",
      timezone: "UTC",
      timeSpentMs: 4_000,
      reviewMode: "full",
      accuracy: 0.8,
      wasDefaultRating: true,
    });
    await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    const after = await snapshot();

    // "Reversed" for a row the review itself created means every counter is
    // back at zero (recursively — arrays like hourBuckets, nested objects
    // like reviewsByMode). Strings/booleans on new rows are identity fields
    // (userId, date, week, ...), not counters.
    const isZeroed = (v: unknown): boolean =>
      v == null ||
      (typeof v === "number" && v === 0) ||
      (Array.isArray(v) && v.every(isZeroed)) ||
      (typeof v === "object" &&
        Object.values(v as object).every(isZeroed));

    // The only numeric field that is a row KEY rather than a counter
    // (reviewDepthAccuracy rows are keyed by userId/courseId/reviewNumber).
    const numericKeyFields = new Set(["reviewNumber"]);

    const violations: string[] = [];
    for (const table of tables) {
      const keep = new Set(UNREVERSED_STAT_FIELDS[table]);
      for (const [id, row] of Object.entries(after[table])) {
        const prev = before[table][id];
        for (const [field, value] of Object.entries(row)) {
          if (
            field === "_id" ||
            field === "_creationTime" ||
            keep.has(field) ||
            numericKeyFields.has(field)
          )
            continue;
          if (prev) {
            // Reversal may write an explicit zero where the field was absent
            // before (undefined -> 0, undefined -> {audio:0,full:0}) — that
            // still counts as restored.
            if (
              JSON.stringify(value) !== JSON.stringify(prev[field]) &&
              !(isZeroed(value) && isZeroed(prev[field]))
            ) {
              violations.push(
                `${table}.${field}: ${JSON.stringify(prev[field])} -> ${JSON.stringify(value)}`,
              );
            }
          } else if (
            typeof value !== "string" &&
            typeof value !== "boolean" &&
            !isZeroed(value)
          ) {
            violations.push(
              `${table}.${field} (review-created row): ${JSON.stringify(value)}`,
            );
          }
        }
      }
    }
    expect(
      violations,
      "fields changed by reviewCard that undoLastReview neither restored nor UNREVERSED_STAT_FIELDS documents as kept",
    ).toEqual([]);
  });

  it("bundles undoableCount into getCardForReview, matching the standalone query", async () => {
    const t = convexTest(schema, modules);
    const { cardId, deckId, collectionId } = await seed(t);
    // Second due card so getCardForReview stays non-null after the first
    // card's review pushes its dueDate forward.
    await addCard(t, deckId, collectionId);
    const asUser = t.withIdentity({ subject: "user_A" });

    let card = await asUser.query(api.features.scheduling.getCardForReview, {});
    expect(card?.undoableCount).toBe(0);

    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: "stillLearning",
      timezone: "UTC",
    });

    card = await asUser.query(api.features.scheduling.getCardForReview, {});
    expect(card).not.toBeNull();
    expect(card?.undoableCount).toBe(1);
    expect(card?.undoableCount).toBe(
      await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
    );

    await asUser.mutation(api.features.scheduling.undoLastReview, {
      timezone: "UTC",
    });
    card = await asUser.query(api.features.scheduling.getCardForReview, {});
    expect(card?.undoableCount).toBe(0);
  });
});
