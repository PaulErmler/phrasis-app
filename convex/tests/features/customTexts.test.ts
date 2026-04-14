/// <reference types="vite/client" />
import { vi } from "vitest";

// Mock external AI SDK + openrouter + component-registering internal modules
// to keep edge runtime happy.
vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "{}" })),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => () => ({}),
}));

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import schema from "../../schema";
import { api } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

async function seedActiveCourseWithQuota(t: ReturnType<typeof convexTest>) {
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
    await ctx.db.insert("usageQuotas", {
      userId: "user_A",
      features: {
        custom_sentences: { balance: 10, included: 10, used: 0, unlimited: false },
        card_edits: { balance: 10, included: 10, used: 0, unlimited: false },
        translation_auto_fill: { balance: 10, included: 10, used: 0, unlimited: false },
      },
      lastSyncedAt: Date.now(),
    });
    return { courseId };
  });
}

describe("features/customTexts", () => {
  describe("createCustomText", () => {
    it("rejects unauthenticated", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(api.features.customTexts.createCustomText, {
          translations: [{ language: "en", text: "hi" }],
          timezone: "UTC",
        }),
      ).rejects.toThrow();
    });

    it("rejects if languages do not match course languages", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.customTexts.createCustomText, {
          translations: [{ language: "en", text: "hi" }],
          timezone: "UTC",
        }),
      ).rejects.toThrow();
    });

    it("creates a custom text with full set of course translations", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.customTexts.createCustomText,
        {
          translations: [
            { language: "en", text: "Hello" },
            { language: "es", text: "Hola" },
          ],
          timezone: "UTC",
          metadata: {
            register: "neutral",
            addresseeNumber: "singular",
            speakerGender: "neutral",
            addresseeGender: "neutral",
          },
        },
      );
      expect(res.textId).toBeDefined();
      const text = await t.run(async (ctx) => ctx.db.get(res.textId));
      expect(text?.text).toBe("Hello");
      // The other course language is stored as a translation row.
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_textId", (q) => q.eq("textId", res.textId))
          .collect(),
      );
      expect(translations.map((tr) => tr.targetLanguage)).toContain("es");
      // Custom sentence quota decremented.
      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      expect(quota?.features.custom_sentences.balance).toBe(9);
      expect(quota?.features.custom_sentences.used).toBe(1);
    });
  });

  describe("autoFillTranslations", () => {
    it("rejects unauthenticated", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.action(api.features.customTexts.autoFillTranslations, {
          texts: [{ language: "en", text: "hi" }],
          targetLanguages: ["es"],
        }),
      ).rejects.toThrow();
    });

    it("calls OpenRouter with the system prompt", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      vi.mocked(generateText).mockResolvedValueOnce({
        text: JSON.stringify({
          translations: { es: "Hola" },
          metadata: {
            register: "neutral",
            addresseeNumber: "singular",
            speakerGender: "neutral",
            addresseeGender: "neutral",
          },
        }),
      } as any);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.action(
        api.features.customTexts.autoFillTranslations,
        {
          texts: [{ language: "en", text: "Hello" }],
          targetLanguages: ["es"],
        },
      );
      expect(res.translations).toEqual([{ language: "es", text: "Hola" }]);
      expect(res.metadata.register).toBe("neutral");
      // Verify the system prompt was passed through.
      expect(generateText).toHaveBeenCalled();
      const call = vi.mocked(generateText).mock.calls.at(-1)![0] as {
        system?: string;
      };
      expect(call.system).toMatch(/multilingual translator/i);
    });
  });
});
