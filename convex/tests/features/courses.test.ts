/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

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

    it("returns cooldown when archived recently", async () => {
      const t = convexTest(schema, modules);
      await seedQuota(t, "user_A");
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
});
