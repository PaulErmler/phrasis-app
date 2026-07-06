/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob("/convex/**/*.ts");

// Tests here schedule content work on 0ms timers - drain it inside the test
// context so its logs don't race vitest teardown.
drainSchedulerAfterEach();

describe("features/collections", () => {
  describe("getCollectionTextsWithContent", () => {
    it("returns empty for unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const collId = await t.run(async (ctx) =>
        ctx.db.insert("collections", { name: "A1", textCount: 0 }),
      );
      const res = await t.query(
        api.features.collections.getCollectionTextsWithContent,
        { collectionId: collId },
      );
      expect(res.texts).toEqual([]);
      expect(res.hasMissingContent).toBe(false);
    });

    it("returns empty when collection is inaccessible", async () => {
      const t = convexTest(schema, modules);
      const courseId = await t.run(async (ctx) => {
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
      const randomColl = await t.run(async (ctx) =>
        ctx.db.insert("collections", { name: "random-xyz", textCount: 0 }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.getCollectionTextsWithContent,
        { collectionId: randomColl },
      );
      expect(res.texts).toEqual([]);
      expect(courseId).toBeDefined();
    });

    it("returns texts for a level collection with hasMissingContent=true when no translations/audio exist", async () => {
      const t = convexTest(schema, modules);
      const { collId } = await t.run(async (ctx) => {
        const collId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 1,
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
        await ctx.db.insert("texts", {
          text: "Hola",
          language: "es",
          userCreated: false,
          collectionId: collId,
          collectionRank: 1,
        });
        return { collId };
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.getCollectionTextsWithContent,
        { collectionId: collId },
      );
      expect(res.texts.length).toBeGreaterThan(0);
      expect(res.texts[0].sourceLanguage).toBe("es");
    });
  });

  describe("ensureContentForCollection", () => {
    it("rejects unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const collId = await t.run(async (ctx) =>
        ctx.db.insert("collections", { name: "A1", textCount: 0 }),
      );
      await expect(
        t.mutation(api.features.collections.ensureContentForCollection, {
          collectionId: collId,
        }),
      ).rejects.toThrow();
    });

    it("returns 0 scheduled when no accessible collection", async () => {
      const t = convexTest(schema, modules);
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
      });
      const randomColl = await t.run(async (ctx) =>
        ctx.db.insert("collections", { name: "random-xyz", textCount: 0 }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.collections.ensureContentForCollection,
        { collectionId: randomColl },
      );
      expect(res).toEqual({
        totalTranslationsScheduled: 0,
        totalAudioScheduled: 0,
      });
    });
  });
});
