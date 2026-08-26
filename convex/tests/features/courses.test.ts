/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import {
  PLAYBACK_SPEED_MAX,
  PLAYBACK_SPEED_MIN,
} from "../../../lib/constants/audioPlayback";
import { MAX_CARDS_PER_BATCH } from "../../../lib/constants/learning";

const modules = import.meta.glob("/convex/**/*.ts");

async function seedQuota(t: TestConvex<typeof schema>, userId: string) {
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
  t: TestConvex<typeof schema>,
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
      expect(settings?.hideDueCounts).toBe(true);
    });

    // completeOnboarding copies this value verbatim onto courseSettings, so
    // an unclamped write here was a side door around updateCourseSettings'
    // guard. Infinity rendered the home ring as "14 / Infinity min", NaN
    // made it claim no goal was ever set.
    it("clamps dailyTimeGoalMinutes into the custom-goal window", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      const progress = await asUser.mutation(
        api.features.courses.saveOnboardingProgress,
        { step: 4, dailyTimeGoalMinutes: 500 },
      );
      expect(progress.dailyTimeGoalMinutes).toBe(120);

      const low = await asUser.mutation(
        api.features.courses.saveOnboardingProgress,
        { step: 4, dailyTimeGoalMinutes: 0.2 },
      );
      expect(low.dailyTimeGoalMinutes).toBe(1);
    });

    it("drops a non-finite dailyTimeGoalMinutes instead of storing it", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      // Establish a sane value first, then try to poison it.
      await asUser.mutation(api.features.courses.saveOnboardingProgress, {
        step: 4,
        dailyTimeGoalMinutes: 25,
      });
      const progress = await asUser.mutation(
        api.features.courses.saveOnboardingProgress,
        { step: 5, dailyTimeGoalMinutes: Infinity },
      );
      // The poison write is ignored; the stored value survives.
      expect(progress.dailyTimeGoalMinutes).toBe(25);
      expect(progress.step).toBe(5);

      const nan = await asUser.mutation(
        api.features.courses.saveOnboardingProgress,
        { step: 5, dailyTimeGoalMinutes: NaN },
      );
      expect(nan.dailyTimeGoalMinutes).toBe(25);
    });
  });

  describe("getTodayStats: client-supplied today", () => {
    // The regression this exists for: todayStr came from Date.now() inside
    // the query, and a query never re-runs because time passed, after local
    // midnight the ring/streak kept showing yesterday until an unrelated
    // write. The client now passes its own (clamped ±1 day) date.
    async function seedTwoDays(t: TestConvex<typeof schema>) {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      await t.run(async (ctx) => {
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
        for (const [date, reps] of [
          [today, 3],
          [yesterday, 7],
        ] as const) {
          await ctx.db.insert("dailyStats", {
            userId: "user_A",
            courseId,
            date,
            reps,
            newCards: 0,
            timeMs: 0,
            cardsReviewed: reps,
          });
        }
      });
      return { today, yesterday };
    }

    it("serves the row for the passed day within the ±1 window", async () => {
      const t = convexTest(schema, modules);
      const { today, yesterday } = await seedTwoDays(t);
      const asUser = t.withIdentity({ subject: "user_A" });

      const noArg = await asUser.query(api.features.courses.getTodayStats, {
        timezone: "UTC",
      });
      expect(noArg?.reps).toBe(3);

      const explicit = await asUser.query(api.features.courses.getTodayStats, {
        timezone: "UTC",
        today,
      });
      expect(explicit?.reps).toBe(3);

      const prev = await asUser.query(api.features.courses.getTodayStats, {
        timezone: "UTC",
        today: yesterday,
      });
      expect(prev?.reps).toBe(7);
    });

    it("clamps out-of-window and malformed dates to the server day", async () => {
      const t = convexTest(schema, modules);
      await seedTwoDays(t);
      const asUser = t.withIdentity({ subject: "user_A" });

      const farPast = await asUser.query(api.features.courses.getTodayStats, {
        timezone: "UTC",
        today: "2020-01-01",
      });
      expect(farPast?.reps).toBe(3);

      const junk = await asUser.query(api.features.courses.getTodayStats, {
        timezone: "UTC",
        today: "not-a-date",
      });
      expect(junk?.reps).toBe(3);
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
      // Pre-existing fields survive. The mutation only patches the one field.
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
    async function seedOwnedCourse(t: TestConvex<typeof schema>) {
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
    async function seedAuthenticated(t: TestConvex<typeof schema>) {
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
      // No seed. Settings row absent on first call.
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
      expect(settings?.hideDueCounts).toBe(true);
    });
  });

  describe("updateUserSettings", () => {
    it("rejects unauthenticated calls", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(api.features.courses.updateUserSettings, {
          hideDueCounts: true,
        }),
      ).rejects.toThrow();
    });

    it("patches hideDueCounts on an existing row without backfilling other fields", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) =>
        ctx.db.insert("userSettings", {
          userId: "user_A",
          hasCompletedOnboarding: true,
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.updateUserSettings, {
        hideDueCounts: true,
      });
      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      expect(settings?.hideDueCounts).toBe(true);
      expect(settings?.hasCompletedOnboarding).toBe(true);
    });

    it("lets an existing user turn counts back on", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) =>
        ctx.db.insert("userSettings", {
          userId: "user_A",
          hasCompletedOnboarding: true,
          hideDueCounts: true,
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.updateUserSettings, {
        hideDueCounts: false,
      });
      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      expect(settings?.hideDueCounts).toBe(false);
    });

    it("creates a settings row when none exists yet", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.updateUserSettings, {
        hideDueCounts: false,
      });
      const settings = await asUser.query(
        api.features.courses.getUserSettings,
        {},
      );
      expect(settings?.hideDueCounts).toBe(false);
      expect(settings?.hasCompletedOnboarding).toBe(false);
    });
  });

  describe("updateCourseSettings: audio playback", () => {
    const makeActiveCourse = async (
      t: TestConvex<typeof schema>,
    ): Promise<{
      asUser: ReturnType<TestConvex<typeof schema>["withIdentity"]>;
      courseId: Id<"courses">;
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

    // Same class of regression as showRomanization above: a new field has to
    // land in the validator, PATCHABLE_KEYS *and* the hand-written insert
    // object. Missing the last one silently drops the very first write.
    it("persists ignorePunctuation on first insert", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        ignorePunctuation: true,
      });
      const settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.ignorePunctuation).toBe(true);
    });

    it("defaults ignorePunctuation to undefined (punctuation counts)", async () => {
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
      expect(settings?.ignorePunctuation).toBeUndefined();
    });

    it("toggles ignorePunctuation back off on an existing row", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        ignorePunctuation: true,
      });
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        ignorePunctuation: false,
      });
      const settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.ignorePunctuation).toBe(false);
    });

    // Daily goal. Editable post-onboarding (removed from the validator's
    // omit list), clamped to 1..120, and never touching the frozen
    // onboardingProgress row that preserves the user's original answer.
    it("persists dailyTimeGoalMinutes on first insert and on patch", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        dailyTimeGoalMinutes: 30,
      });
      let settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.dailyTimeGoalMinutes).toBe(30);

      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        dailyTimeGoalMinutes: 10,
      });
      settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.dailyTimeGoalMinutes).toBe(10);
    });

    it("clamps dailyTimeGoalMinutes to 1..120 and rounds fractions", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);

      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        dailyTimeGoalMinutes: 0,
      });
      let settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.dailyTimeGoalMinutes).toBe(1);

      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        dailyTimeGoalMinutes: 999,
      });
      settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.dailyTimeGoalMinutes).toBe(120);

      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        dailyTimeGoalMinutes: 14.6,
      });
      settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.dailyTimeGoalMinutes).toBe(15);
    });

    it("drops non-finite numeric values instead of storing them", async () => {
      // NaN/±Infinity are valid float64s, so they pass v.number() and
      // survive Math.max/min/round, without the finite guard a NaN goal
      // poisons the daily-goal ring and every projection.
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        dailyTimeGoalMinutes: 30,
      });

      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        await asUser.mutation(api.features.courses.updateCourseSettings, {
          courseId,
          dailyTimeGoalMinutes: bad,
          targetBeforeOnlyNewReps: bad,
          targetBeforeUntilGoodReps: bad,
        });
      }
      const settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.dailyTimeGoalMinutes).toBe(30);
      expect(settings?.targetBeforeOnlyNewReps ?? undefined).not.toBeNaN();
      expect(settings?.targetBeforeUntilGoodReps ?? undefined).not.toBeNaN();
    });

    it("leaves onboardingProgress.dailyTimeGoalMinutes untouched when the goal changes", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("onboardingProgress", {
          userId: "user_A",
          step: 99,
          dailyTimeGoalMinutes: 20,
        });
      });

      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        dailyTimeGoalMinutes: 60,
      });

      const progress = await t.run(async (ctx) =>
        ctx.db
          .query("onboardingProgress")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .unique(),
      );
      expect(progress?.dailyTimeGoalMinutes).toBe(20);
    });

    // Same three-place regression class again. Validator, PATCHABLE_KEYS and
    // the hand-written insert object.
    it("persists autoRateFromAccuracy on first insert", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        autoRateFromAccuracy: false,
      });
      const settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.autoRateFromAccuracy).toBe(false);
    });

    it("persists autoRateThresholds on first insert", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        autoRateThresholds: { hard: 40, good: 70 },
      });
      const settings = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(settings?.autoRateThresholds).toEqual({ hard: 40, good: 70 });
    });

    it("rejects auto-rate thresholds that are not ascending", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await expect(
        asUser.mutation(api.features.courses.updateCourseSettings, {
          courseId,
          autoRateThresholds: { hard: 90, good: 20 },
        }),
      ).rejects.toThrow(/ascending/);
    });

    it("rejects auto-rate thresholds outside 0-100", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await expect(
        asUser.mutation(api.features.courses.updateCourseSettings, {
          courseId,
          autoRateThresholds: { hard: 50, good: 140 },
        }),
      ).rejects.toThrow(/between 0 and 100/);
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

    // The other four playback-speed records go through the same clamp loop as
    // targetBeforePlaybackSpeeds above. Pin each one on the insert branch.
    it.each([
      "languagePlaybackSpeeds",
      "languagePlaybackSpeedsFull",
      "languagePlaybackSpeedsTranscribe",
      "transcribeAfterPlaybackSpeeds",
    ] as const)("clamps %s to the allowed range server-side", async (field) => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        [field]: { de: 99, fr: 0.01 },
      });
      const s = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(s?.[field]).toEqual({
        de: PLAYBACK_SPEED_MAX,
        fr: PLAYBACK_SPEED_MIN,
      });
    });

    it("silently drops non-finite playback speeds instead of storing them", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        languagePlaybackSpeeds: { de: 1.5, fr: Number.NaN },
      });
      const s = await asUser.query(
        api.features.courses.getActiveCourseSettings,
        {},
      );
      expect(s?.languagePlaybackSpeeds).toEqual({ de: 1.5 });
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

    it("clamps showTranslationOnlyNewReps to 0-10 (0 = ∞) like the listening limit", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        showTranslationOnlyNewReps: 50,
      });
      let s = await asUser.query(api.features.courses.getActiveCourseSettings, {});
      expect(s?.showTranslationOnlyNewReps).toBe(10);

      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        showTranslationOnlyNewReps: 0,
      });
      s = await asUser.query(api.features.courses.getActiveCourseSettings, {});
      expect(s?.showTranslationOnlyNewReps).toBe(0);
    });

    it("clamps targetBeforeUntilGoodReps to 1-10 (no ∞ position)", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        targetBeforeUntilGoodReps: 0,
      });
      let s = await asUser.query(api.features.courses.getActiveCourseSettings, {});
      expect(s?.targetBeforeUntilGoodReps).toBe(1);

      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        targetBeforeUntilGoodReps: 50,
      });
      s = await asUser.query(api.features.courses.getActiveCourseSettings, {});
      expect(s?.targetBeforeUntilGoodReps).toBe(10);

      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        targetBeforeListeningStrategy: "untilGood",
      });
      s = await asUser.query(api.features.courses.getActiveCourseSettings, {});
      expect(s?.targetBeforeListeningStrategy).toBe("untilGood");
    });

    it("clamps cardsToAddBatchSize to MAX_CARDS_PER_BATCH on first insert", async () => {
      const t = convexTest(schema, modules);
      const { asUser, courseId } = await makeActiveCourse(t);
      // No courseSettings row yet, so this exercises the INSERT branch (not the
      // patch branch), the insert path previously skipped the clamp.
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

  describe("updateCourseSettings: insert/patch field parity", () => {
    const makeCourse = async (t: TestConvex<typeof schema>) =>
      t.run(async (ctx) =>
        ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
        }),
      );

    const readSettingsRow = async (
      t: TestConvex<typeof schema>,
      courseId: Awaited<ReturnType<typeof makeCourse>>,
    ) =>
      t.run(async (ctx) =>
        ctx.db
          .query("courseSettings")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .unique(),
      );

    // Every updateCourseSettings arg except courseId, each set to an in-range
    // value distinguishable from the schema/server defaults. A field present in
    // the validator + PATCHABLE_KEYS but missing from the hand-written insert
    // object fails the toMatchObject below. The regression class the comments
    // in the describe above call out, guarded here for all fields at once.
    // Clamped fields use in-range values so clamps are no-ops, and
    // playTargetBeforeBase stays true so the both-toggles-off guard is inert.
    const fullArgs = {
      initialReviewCount: 7,
      cardsToAddBatchSize: 9,
      autoAddCards: true,
      highlightWords: true,
      autoPlayAudio: true,
      autoAdvance: true,
      languageRepetitions: { de: 2 },
      languageRepetitionPauses: { de: 3 },
      languagePlaybackSpeeds: { de: 0.8 },
      pauseBaseToBase: 1,
      pauseBaseToTarget: 2,
      pauseTargetToTarget: 3,
      pauseBeforeAutoAdvance: 4,
      highlightWordsFull: true,
      autoPlayAudioFull: true,
      languageRepetitionsFull: { de: 4 },
      languageRepetitionPausesFull: { de: 5 },
      languagePlaybackSpeedsFull: { de: 0.9 },
      pauseBaseToBaseFull: 5,
      pauseBaseToTargetFull: 6,
      pauseTargetToTargetFull: 7,
      pauseBeforeAutoAdvanceFull: 8,
      highlightWordsTranscribe: true,
      autoPlayAudioTranscribe: true,
      languageRepetitionsTranscribe: { de: 6 },
      languageRepetitionPausesTranscribe: { de: 7 },
      languagePlaybackSpeedsTranscribe: { de: 1.1 },
      pauseTargetToTargetTranscribe: 9,
      transcribeAfterRepetitions: { de: 8 },
      transcribeAfterRepetitionPauses: { de: 9 },
      transcribeAfterPlaybackSpeeds: { de: 1.2 },
      playTargetBeforeBase: true,
      playTargetAfterBase: false,
      targetBeforeRepetitions: { de: 10 },
      targetBeforeRepetitionPauses: { de: 11 },
      targetBeforePlaybackSpeeds: { de: 1.3 },
      pauseTargetToBase: 10,
      targetBeforeOnlyNewReps: 4,
      showProgressBar: true,
      progressDisplayEnabled: true,
      hideTargetLanguages: true,
      autoRevealLanguages: true,
      hideBaseLanguages: true,
      autoRevealBaseLanguages: true,
      hideBaseLanguagesFull: true,
      autoRevealBaseOnSubmit: true,
      showRomanization: true,
      baseLanguageOrder: ["en"] as string[],
      targetLanguageOrder: ["de"] as string[],
      instantProceedAudio: true,
      instantProceedFull: true,
      reviewMode: "full",
      fullReviewTargetAudioMode: "afterSubmit",
      writingInputMode: "transcribe",
      ignorePunctuation: true,
      autoRateFromAccuracy: false,
      autoRateThresholds: { hard: 35, good: 65 },
      schedulingMode: "radio",
      studyContentFilter: "custom",
    } as const;

    it("insert branch persists every arg field verbatim", async () => {
      const t = convexTest(schema, modules);
      const courseId = await makeCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      // 59 = every arg in the validator except courseId; keep in sync.
      expect(Object.keys(fullArgs)).toHaveLength(59);
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        ...fullArgs,
      });
      const row = await readSettingsRow(t, courseId);
      expect(row).toMatchObject(fullArgs);
    });

    it("patch branch yields a row identical to the insert branch", async () => {
      const t = convexTest(schema, modules);
      const insertCourseId = await makeCourse(t);
      const patchCourseId = await makeCourse(t);
      await t.run(async (ctx) =>
        ctx.db.insert("courseSettings", {
          courseId: patchCourseId,
          initialReviewCount: 5,
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId: insertCourseId,
        ...fullArgs,
      });
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId: patchCourseId,
        ...fullArgs,
      });
      const inserted = await readSettingsRow(t, insertCourseId);
      const patched = await readSettingsRow(t, patchCourseId);
      const strip = (row: Record<string, unknown> | null) =>
        Object.fromEntries(
          Object.entries(row ?? {}).filter(
            ([key]) => !["_id", "_creationTime", "courseId"].includes(key),
          ),
        );
      expect(patched).toMatchObject(fullArgs);
      expect(strip(patched)).toEqual(strip(inserted));
    });
  });
});
