/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";
import {
  PLAYBACK_SPEED_MAX,
  PLAYBACK_SPEED_MIN,
} from "../../../lib/constants/audioPlayback";
import { MAX_CARDS_PER_BATCH } from "../../../lib/constants/learning";

const modules = import.meta.glob("/convex/**/*.ts");

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

// Seed a quota doc with a custom `courses` feature, leaving the other features
// generous. Used to exercise the plan-aware unarchive cooldown.
async function seedCoursesQuota(
  t: ReturnType<typeof convexTest>,
  userId: string,
  courses: { balance: number; included: number; unlimited?: boolean },
) {
  await t.run(async (ctx) =>
    ctx.db.insert("usageQuotas", {
      userId,
      features: {
        courses: {
          balance: courses.balance,
          included: courses.included,
          used: Math.max(0, courses.included - courses.balance),
          unlimited: courses.unlimited ?? false,
        },
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

describe("features/courses", () => {
  describe("getUserSettings", () => {
    it("returns null when unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.courses.getUserSettings, {});
      expect(res).toBeNull();
    });

    it("returns settings for authenticated user", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) =>
        ctx.db.insert("userSettings", {
          userId: "user_A",
          hasCompletedOnboarding: true,
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.courses.getUserSettings, {});
      expect(res?.userId).toBe("user_A");
      expect(res?.hasCompletedOnboarding).toBe(true);
    });
  });

  describe("getUserCourses", () => {
    it("returns empty for unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.courses.getUserCourses, {});
      expect(res).toEqual([]);
    });

    it("returns active courses before archived", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["es"],
          isArchived: true,
          archivedAt: Date.now(),
        });
        await ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["fr"],
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const courses = await asUser.query(api.features.courses.getUserCourses, {});
      expect(courses).toHaveLength(2);
      expect(courses[0].isArchived).not.toBe(true);
      expect(courses[1].isArchived).toBe(true);
    });
  });

  describe("saveOnboardingProgress", () => {
    it("requires authentication", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(api.features.courses.saveOnboardingProgress, { step: 1 }),
      ).rejects.toThrow();
    });

    it("creates progress and user settings", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      const progress = await asUser.mutation(
        api.features.courses.saveOnboardingProgress,
        {
          step: 2,
          targetLanguages: ["es"],
          baseLanguages: ["en"],
          currentLevel: "beginner",
        },
      );
      expect(progress.step).toBe(2);
      expect(progress.userId).toBe("user_A");

      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      expect(settings?.hasCompletedOnboarding).toBe(false);
    });
  });

  describe("setActiveCourse", () => {
    it("rejects when course belongs to another user", async () => {
      const t = convexTest(schema, modules);
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_B",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.courses.setActiveCourse, { courseId }),
      ).rejects.toThrow();
    });

    it("sets active course for owner", async () => {
      const t = convexTest(schema, modules);
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.setActiveCourse, { courseId });
      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      expect(settings?.activeCourseId).toBe(courseId);
    });
  });

  describe("archiveCourse / unarchiveCourse", () => {
    it("archives an owned course", async () => {
      const t = convexTest(schema, modules);
      await seedQuota(t, "user_A");
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.archiveCourse, { courseId });
      const course = await t.run(async (ctx) => ctx.db.get(courseId));
      expect(course?.isArchived).toBe(true);
    });

    it("returns cooldown when archived recently on a single-course (free/basic) plan", async () => {
      const t = convexTest(schema, modules);
      await seedCoursesQuota(t, "user_A", { balance: 1, included: 1 });
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
          isArchived: true,
          archivedAt: Date.now(),
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const result = await asUser.mutation(
        api.features.courses.unarchiveCourse,
        { courseId },
      );
      expect(result.status).toBe("cooldown");
    });

    it("unarchives immediately on a multi-course plan even when archived recently", async () => {
      const t = convexTest(schema, modules);
      await seedCoursesQuota(t, "user_A", { balance: 4, included: 5 });
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
          isArchived: true,
          archivedAt: Date.now(),
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const result = await asUser.mutation(
        api.features.courses.unarchiveCourse,
        { courseId },
      );
      expect(result.status).toBe("success");
      const course = await t.run(async (ctx) => ctx.db.get(courseId));
      expect(course?.isArchived).toBeUndefined();
    });

    it("returns usage_limit when no course quota remains", async () => {
      const t = convexTest(schema, modules);
      await seedCoursesQuota(t, "user_A", { balance: 0, included: 5 });
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
          isArchived: true,
          archivedAt: Date.now(),
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const result = await asUser.mutation(
        api.features.courses.unarchiveCourse,
        { courseId },
      );
      expect(result.status).toBe("usage_limit");
    });
  });

  describe("setCurrentSessionId", () => {
    it("inserts a courseSettings row with the sessionId on first call", async () => {
      const t = convexTest(schema, modules);
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.setActiveCourse, { courseId });
      await asUser.mutation(api.features.courses.setCurrentSessionId, {
        courseId,
        sessionId: "session-abc",
      });
      const settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.currentSessionId).toBe("session-abc");
    });

    it("patches an existing courseSettings row without touching other fields", async () => {
      const t = convexTest(schema, modules);
      const courseId = await t.run(async (ctx) => {
        const cid = await ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
        });
        await ctx.db.insert("courseSettings", {
          courseId: cid,
          initialReviewCount: 5,
          autoPlayAudio: true,
          studyContentFilter: "custom",
        });
        return cid;
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.setActiveCourse, { courseId });
      await asUser.mutation(api.features.courses.setCurrentSessionId, {
        courseId,
        sessionId: "session-xyz",
      });
      const settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.currentSessionId).toBe("session-xyz");
      // Pre-existing fields survive — the mutation only patches the one field.
      expect(settings?.initialReviewCount).toBe(5);
      expect(settings?.autoPlayAudio).toBe(true);
      expect(settings?.studyContentFilter).toBe("custom");
    });

    it("rotates the id on subsequent calls (no append, just overwrite)", async () => {
      const t = convexTest(schema, modules);
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.setActiveCourse, { courseId });
      await asUser.mutation(api.features.courses.setCurrentSessionId, {
        courseId,
        sessionId: "first",
      });
      await asUser.mutation(api.features.courses.setCurrentSessionId, {
        courseId,
        sessionId: "second",
      });
      const settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.currentSessionId).toBe("second");
    });

    it("rejects when the course belongs to another user", async () => {
      const t = convexTest(schema, modules);
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_B",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.courses.setCurrentSessionId, {
          courseId,
          sessionId: "nope",
        }),
      ).rejects.toThrow();
    });
  });

  describe("completeTutorial", () => {
    it("records the tutorial id", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) =>
        ctx.db.insert("userSettings", {
          userId: "user_A",
          hasCompletedOnboarding: true,
          completedTutorials: [],
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.completeTutorial, {
        tutorialId: "home_tour",
      });
      const tutorials = await asUser.query(
        api.features.courses.getCompletedTutorials,
        {},
      );
      expect(tutorials).toContain("home_tour");
    });
  });

  describe("setCurrentSessionId", () => {
    async function seedOwnedCourse(t: ReturnType<typeof convexTest>) {
      return t.run(async (ctx) => {
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
        return courseId;
      });
    }

    it("patches currentSessionId on an existing courseSettings row", async () => {
      const t = convexTest(schema, modules);
      const courseId = await seedOwnedCourse(t);
      const settingsId = await t.run(async (ctx) =>
        ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 5,
          currentSessionId: "old-session",
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.setCurrentSessionId, {
        courseId,
        sessionId: "new-session",
      });
      const row = await t.run(async (ctx) => ctx.db.get(settingsId));
      expect(row?.currentSessionId).toBe("new-session");
      // initialReviewCount is preserved on the patch.
      expect(row?.initialReviewCount).toBe(5);
    });

    it("inserts a courseSettings row with the default initialReviewCount when missing", async () => {
      const t = convexTest(schema, modules);
      const courseId = await seedOwnedCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.setCurrentSessionId, {
        courseId,
        sessionId: "seed-session",
      });
      const row = await t.run(async (ctx) =>
        ctx.db
          .query("courseSettings")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .first(),
      );
      expect(row?.currentSessionId).toBe("seed-session");
      // Server picks the default when inserting from scratch.
      expect(row?.initialReviewCount).toBe(5);
    });

    it("rejects when the course belongs to a different user", async () => {
      const t = convexTest(schema, modules);
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_B",
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        }),
      );
      await t.run(async (ctx) =>
        ctx.db.insert("userSettings", {
          userId: "user_A",
          hasCompletedOnboarding: true,
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.courses.setCurrentSessionId, {
          courseId,
          sessionId: "anything",
        }),
      ).rejects.toThrow(/does not belong/i);
    });
  });

  describe("updatePinnedCardActions", () => {
    async function seedAuthenticated(t: ReturnType<typeof convexTest>) {
      await t.run(async (ctx) =>
        ctx.db.insert("userSettings", {
          userId: "user_A",
          hasCompletedOnboarding: true,
        }),
      );
    }

    it("persists a valid action list verbatim", async () => {
      const t = convexTest(schema, modules);
      await seedAuthenticated(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.updatePinnedCardActions, {
        actions: ["favorite", "edit", "regenerateAudio"],
      });
      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      expect(settings?.pinnedCardActions).toEqual([
        "favorite",
        "edit",
        "regenerateAudio",
      ]);
    });

    it("strips unknown action keys via normalizePinnedCardActions", async () => {
      const t = convexTest(schema, modules);
      await seedAuthenticated(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.updatePinnedCardActions, {
        actions: ["favorite", "bogus", "edit", "also-bogus"],
      });
      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      expect(settings?.pinnedCardActions).toEqual(["favorite", "edit"]);
    });

    it("dedupes and clamps to MAX_PINNED_CARD_ACTIONS", async () => {
      const t = convexTest(schema, modules);
      await seedAuthenticated(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.updatePinnedCardActions, {
        actions: [
          "favorite",
          "favorite",
          "master",
          "hide",
          "edit",
          "regenerateAudio",
          "flag", // 6th distinct — past the max of 5
        ],
      });
      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      expect(settings?.pinnedCardActions).toEqual([
        "favorite",
        "master",
        "hide",
        "edit",
        "regenerateAudio",
      ]);
    });

    it("falls back to the default action set when given an empty array", async () => {
      const t = convexTest(schema, modules);
      await seedAuthenticated(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.updatePinnedCardActions, {
        actions: [],
      });
      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      // DEFAULT_PINNED_CARD_ACTIONS in lib/cardActions.ts
      expect(settings?.pinnedCardActions).toEqual([
        "favorite",
        "master",
        "hide",
        "edit",
      ]);
    });

    it("creates a userSettings row when none exists yet", async () => {
      const t = convexTest(schema, modules);
      // No seed — settings row absent on first call.
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.updatePinnedCardActions, {
        actions: ["edit"],
      });
      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      expect(settings?.pinnedCardActions).toEqual(["edit"]);
      expect(settings?.hasCompletedOnboarding).toBe(false);
    });
  });

  describe("updateCourseSettings — audio playback", () => {
    const makeActiveCourse = async (
      t: ReturnType<typeof convexTest>,
    ): Promise<{
      asUser: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;
      courseId: string;
    }> => {
      const courseId = await t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.setActiveCourse, { courseId });
      return { asUser, courseId };
    };

    // Regression: showRomanization was in the validator + PATCHABLE_KEYS but
    // missing from the INSERT branch, so a brand-new courseSettings row dropped
    // it. (See convex/features/courses.ts insert object.)
    it("persists showRomanization on first insert", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        showRomanization: true,
      });
      const settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.showRomanization).toBe(true);
    });

    it("persists the Practice Listening (target-before-base) fields on insert", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        playTargetBeforeBase: true,
        playTargetAfterBase: false,
        targetBeforeRepetitions: { de: 3 },
        targetBeforeRepetitionPauses: { de: 4 },
        targetBeforePlaybackSpeeds: { de: 0.7 },
        pauseTargetToBase: 6,
      });
      const s = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(s?.playTargetBeforeBase).toBe(true);
      expect(s?.playTargetAfterBase).toBe(false);
      expect(s?.targetBeforeRepetitions).toEqual({ de: 3 });
      expect(s?.targetBeforeRepetitionPauses).toEqual({ de: 4 });
      expect(s?.targetBeforePlaybackSpeeds).toEqual({ de: 0.7 });
      expect(s?.pauseTargetToBase).toBe(6);
    });

    it("clamps targetBeforePlaybackSpeeds to the allowed range server-side", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        targetBeforePlaybackSpeeds: { de: 99, fr: 0.01 },
      });
      const s = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(s?.targetBeforePlaybackSpeeds).toEqual({
        de: PLAYBACK_SPEED_MAX,
        fr: PLAYBACK_SPEED_MIN,
      });
    });

    it("persists and clamps the 'Only new' Practice-Listening limit", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      // A valid value persists as-is.
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        targetBeforeOnlyNewReps: 3,
      });
      let s = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(s?.targetBeforeOnlyNewReps).toBe(3);

      // Out-of-range clamps to 10; 0 (∞) is allowed and round-trips.
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        targetBeforeOnlyNewReps: 50,
      });
      s = await asUser.query(api.features.courses.getActiveCourseSettings, {});
      expect(s?.targetBeforeOnlyNewReps).toBe(10);

      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        targetBeforeOnlyNewReps: 0,
      });
      s = await asUser.query(api.features.courses.getActiveCourseSettings, {});
      expect(s?.targetBeforeOnlyNewReps).toBe(0);
    });

    it("clamps cardsToAddBatchSize to MAX_CARDS_PER_BATCH on first insert", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      // No courseSettings row yet, so this exercises the INSERT branch (not the
      // patch branch) — the insert path previously skipped the clamp.
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        cardsToAddBatchSize: 999,
      });
      const s = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(s?.cardsToAddBatchSize).toBe(MAX_CARDS_PER_BATCH);
    });

    it("forces Practice Speaking on when a write would leave both target toggles off", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        playTargetBeforeBase: false,
        playTargetAfterBase: false,
      });
      const s = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(s?.playTargetBeforeBase).toBe(false);
      expect(s?.playTargetAfterBase).toBe(true);
    });

    it("leaves Practice Speaking off when Practice Listening is on (guard not over-eager)", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        playTargetBeforeBase: true,
        playTargetAfterBase: false,
      });
      const s = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(s?.playTargetBeforeBase).toBe(true);
      expect(s?.playTargetAfterBase).toBe(false);
    });

    it("heals to Practice Speaking when the last toggle is turned off on an existing row", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      // Existing valid state: Practice Listening on, Practice Speaking off.
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        playTargetBeforeBase: true,
        playTargetAfterBase: false,
      });
      // Turn Listening off WITHOUT touching Speaking → would be both-off; the
      // guard heals using the existing (after:false) value.
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        playTargetBeforeBase: false,
      });
      const s = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(s?.playTargetBeforeBase).toBe(false);
      expect(s?.playTargetAfterBase).toBe(true);
    });
  });
});
