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
// Stub the action-retrier so `retrier.run(ctx, fnRef, args)` delegates to
// `ctx.runAction` instead of the (unregistered) component. Needed by the
// tests that replay the scheduled `generateSentenceMetadata` job.
vi.mock("@convex-dev/action-retrier", () => {
  class ActionRetrier {
    constructor(_component: unknown, _opts: unknown) {}
    async run(ctx: any, fnRef: any, args: any): Promise<string> {
      await ctx.runAction(fnRef, args);
      return "job_stub";
    }
  }
  return { ActionRetrier };
});

import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { USER_PROVIDED_TRANSLATION_SOURCE } from "../../../lib/translationProvenance";
import { MAX_CARD_TEXT_LENGTH } from "../../../lib/constants/learning";
import { DEFAULT_INITIAL_REVIEW_COUNT } from "../../../lib/scheduling";

const modules = import.meta.glob("/convex/**/*.ts");

async function seedActiveCourseWithQuota(t: TestConvex<typeof schema>) {
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
            addressesSomeone: true,
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

    it("persists the caller-supplied translationSource on each translation row", async () => {
      // Simulates the EnterTextsView save flow where some rows came back
      // from autofill (carry an LLM model id) and others were user-typed
      // (carry `'user-provided'`).
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const courseId = await ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["es", "fr"],
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
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.customTexts.createCustomText,
        {
          translations: [
            { language: "en", text: "Hello", translationSource: "user-provided" },
            {
              language: "es",
              text: "Hola",
              translationSource: "openrouter/some-model-none",
            },
            // fr deliberately omits translationSource. Accepted, and the
            // server fills in the honest provenance (see below).
            { language: "fr", text: "Bonjour" },
          ],
          timezone: "UTC",
        },
      );
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_textId", (q) => q.eq("textId", res.textId))
          .collect(),
      );
      const byLang = Object.fromEntries(
        translations.map((tr) => [tr.targetLanguage, tr.translationSource]),
      );
      expect(byLang.es).toBe("openrouter/some-model-none");
      // `fr` omitted a source → the server defaults it to `user-provided`
      // rather than storing an untagged row. The entry reached us from a form
      // the user typed into, and an untagged row reads as machine output to
      // every provenance guard.
      expect(byLang.fr).toBe(USER_PROVIDED_TRANSLATION_SOURCE);
    });

    it("pure-manual save schedules a metadata job that the job validator accepts (regression)", async () => {
      // Regression for a production ArgumentValidationError: the no-metadata
      // branch forwarded `args.translations` (carrying `translationSource` /
      // `regionVariant`) into `generateSentenceMetadata`, whose validator
      // only allowed `{language, text}`. The mutation itself succeeded, so
      // the failure was silent. Replay the scheduled job exactly as the
      // scheduler would to prove the forwarded args pass validation.
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.customTexts.createCustomText,
        {
          translations: [
            {
              language: "en",
              text: "God keeps whole civilizations together.",
              translationSource: "user-provided",
            },
            {
              language: "es",
              text: "Dios mantiene unidas civilizaciones enteras.",
              translationSource: "user-provided",
              regionVariant: "es-US",
            },
          ],
          timezone: "UTC",
          // no metadata → pure-manual branch
        },
      );

      const jobs = await t.run(async (ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      const metadataJobs = jobs.filter((j) =>
        j.name.includes("generateSentenceMetadata"),
      );
      expect(metadataJobs).toHaveLength(1);
      const jobArgs = metadataJobs[0].args[0] as any;
      // The job carries the text's owner for exception attribution.
      expect(jobArgs.userId).toBe("user_A");

      await t.action(
        internal.features.sentenceMetadata.generateSentenceMetadata,
        jobArgs,
      );

      // The metadata step ran instead of dying on args validation: the card
      // was unblocked with a coin-flipped voice gender.
      const text = await t.run(async (ctx) => ctx.db.get(res.textId));
      expect(["male", "female"]).toContain(text?.audioSpeakerGender);
    });

    it("throws INVALID_TIMEZONE for a malformed timezone", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.customTexts.createCustomText, {
          translations: [
            { language: "en", text: "Hello" },
            { language: "es", text: "Hola" },
          ],
          timezone: "Not/A_Zone",
        }),
      ).rejects.toThrow(/INVALID_TIMEZONE/);
    });

    it("throws INVALID_LANGUAGES when a language appears twice", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      // en twice + es → nothing missing, nothing extra; only the duplicate
      // sub-condition of the language check can fire here.
      const rejection = expect(
        asUser.mutation(api.features.customTexts.createCustomText, {
          translations: [
            { language: "en", text: "Hello" },
            { language: "en", text: "Hi" },
            { language: "es", text: "Hola" },
          ],
          timezone: "UTC",
        }),
      ).rejects;
      await rejection.toThrow(/INVALID_LANGUAGES/);
      await rejection.toThrow(/Missing: \[\]\. Extra: \[\]/);
    });

    it("throws EMPTY_TEXT for a zero-length entry", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.customTexts.createCustomText, {
          translations: [
            { language: "en", text: "" },
            { language: "es", text: "Hola" },
          ],
          timezone: "UTC",
        }),
      ).rejects.toThrow(/EMPTY_TEXT/);
    });

    it("throws TEXT_TOO_LONG past MAX_CARD_TEXT_LENGTH", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.customTexts.createCustomText, {
          translations: [
            { language: "en", text: "x".repeat(MAX_CARD_TEXT_LENGTH + 1) },
            { language: "es", text: "Hola" },
          ],
          timezone: "UTC",
        }),
      ).rejects.toThrow(/TEXT_TOO_LONG/);
      // Validation precedes consumeQuota, nothing is charged.
      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      expect(quota?.features.custom_sentences.used).toBe(0);
    });
  });

  describe("createCustomText: custom collection get-or-create", () => {
    async function getSettings(
      t: TestConvex<typeof schema>,
      courseId: Awaited<ReturnType<typeof seedActiveCourseWithQuota>>["courseId"],
    ) {
      return t.run(async (ctx) =>
        ctx.db
          .query("courseSettings")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .first(),
      );
    }

    const validArgs = (suffix = "") => ({
      translations: [
        { language: "en", text: `Hello${suffix}` },
        { language: "es", text: `Hola${suffix}` },
      ],
      timezone: "UTC",
    });

    it("creates the Custom collection and inserts a courseSettings row when none exists", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.customTexts.createCustomText,
        validArgs(),
      );

      const text = await t.run(async (ctx) => ctx.db.get(res.textId));
      const collection = await t.run(async (ctx) =>
        ctx.db.get(text!.collectionId!),
      );
      expect(collection?.name).toBe("Custom");
      expect(collection?.origin).toBe("custom");

      const settings = await getSettings(t, courseId);
      expect(settings?.customCollectionId).toBe(collection?._id);
      expect(settings?.activeCustomCollectionIds).toEqual([collection?._id]);
      expect(settings?.initialReviewCount).toBe(DEFAULT_INITIAL_REVIEW_COUNT);
    });

    it("patches existing courseSettings and appends to activeCustomCollectionIds", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourseWithQuota(t);
      const existingCollectionId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("collections", {
          name: "Chat",
          textCount: 0,
          origin: "chat",
        });
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 7,
          chatCollectionId: id,
          activeCustomCollectionIds: [id],
        });
        return id;
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.customTexts.createCustomText,
        validArgs(),
      );

      const text = await t.run(async (ctx) => ctx.db.get(res.textId));
      const settings = await getSettings(t, courseId);
      expect(settings?.customCollectionId).toBe(text?.collectionId);
      expect(settings?.activeCustomCollectionIds).toEqual([
        existingCollectionId,
        text?.collectionId,
      ]);
      // The pre-existing settings row is patched, not replaced.
      expect(settings?.initialReviewCount).toBe(7);
      expect(settings?.chatCollectionId).toBe(existingCollectionId);
    });

    it("reuses the same custom collection for subsequent texts", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const first = await asUser.mutation(
        api.features.customTexts.createCustomText,
        validArgs(" 1"),
      );
      const second = await asUser.mutation(
        api.features.customTexts.createCustomText,
        validArgs(" 2"),
      );

      const [firstText, secondText] = await t.run(async (ctx) =>
        Promise.all([ctx.db.get(first.textId), ctx.db.get(second.textId)]),
      );
      expect(secondText?.collectionId).toBe(firstText?.collectionId);

      const customCollections = await t.run(async (ctx) => {
        const all = await ctx.db.query("collections").collect();
        return all.filter((c) => c.origin === "custom");
      });
      expect(customCollections).toHaveLength(1);
      expect(customCollections[0].textCount).toBe(2);

      const settings = await getSettings(t, courseId);
      expect(settings?.customCollectionId).toBe(firstText?.collectionId);
      expect(settings?.activeCustomCollectionIds).toEqual([
        firstText?.collectionId,
      ]);
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

    it("throws INVALID_LANGUAGES when a source language is not in the active course", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      // Active course is en→es; fr is not in the course.
      await expect(
        asUser.action(api.features.customTexts.autoFillTranslations, {
          texts: [{ language: "fr", text: "Bonjour" }],
          targetLanguages: ["es"],
        }),
      ).rejects.toThrow(/fr/);
    });

    it("throws INVALID_LANGUAGES when a target language is not in the active course", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      // Active course is en→es; de is not in the course.
      await expect(
        asUser.action(api.features.customTexts.autoFillTranslations, {
          texts: [{ language: "en", text: "Hello" }],
          targetLanguages: ["de"],
        }),
      ).rejects.toThrow(/de/);
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
            addressesSomeone: true,
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
      // Every autofill row carries a `translationSource` tag now. The
      // autofill model id plus its `none` (no-thinking) reasoning suffix.
      // The exact slug is owned by OPENROUTER_MODELS.translationAutoFill in
      // convex/config/aiModels.ts; we just assert the shape
      // (language/text/translationSource) rather than re-spelling it here.
      expect(res.translations).toHaveLength(1);
      expect(res.translations[0]).toMatchObject({
        language: "es",
        text: "Hola",
      });
      expect(res.translations[0].translationSource).toMatch(/-none$/);
      expect(res.metadata.register).toBe("neutral");
      // Verify the system prompt was passed through.
      expect(generateText).toHaveBeenCalled();
      const call = vi.mocked(generateText).mock.calls.at(-1)![0] as {
        system?: string;
      };
      expect(call.system).toMatch(/multilingual translator/i);
    });
  });

  describe("createCustomTextsBatch", () => {
    it("rejects unauthenticated", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(api.features.customTexts.createCustomTextsBatch, {
          items: [{ translations: [{ language: "en", text: "hi" }] }],
          timezone: "UTC",
        }),
      ).rejects.toThrow();
    });

    it("rejects empty batch", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.customTexts.createCustomTextsBatch, {
          items: [],
          timezone: "UTC",
        }),
      ).rejects.toThrow();
    });

    it("rejects when items exceed MAX_IMPORT_BATCH", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const items = Array.from({ length: 501 }, (_, i) => ({
        translations: [
          { language: "en", text: `Hello ${i}` },
          { language: "es", text: `Hola ${i}` },
        ],
      }));
      await expect(
        asUser.mutation(api.features.customTexts.createCustomTextsBatch, {
          items,
          timezone: "UTC",
        }),
      ).rejects.toThrow();
    });

    it("creates multiple texts, decrements quota, patches collection textCount", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const items = [
        {
          translations: [
            { language: "en", text: "Hello" },
            { language: "es", text: "Hola" },
          ],
        },
        {
          translations: [
            { language: "en", text: "Goodbye" },
            { language: "es", text: "Adiós" },
          ],
        },
        {
          translations: [
            { language: "en", text: "Thanks" },
            { language: "es", text: "Gracias" },
          ],
        },
      ];
      const res = await asUser.mutation(
        api.features.customTexts.createCustomTextsBatch,
        { items, timezone: "UTC" },
      );
      expect(res.createdTextIds).toHaveLength(3);
      expect(res.skipped).toHaveLength(0);

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      expect(quota?.features.custom_sentences.balance).toBe(7);
      expect(quota?.features.custom_sentences.used).toBe(3);

      const collection = await t.run(async (ctx) =>
        ctx.db.query("collections").first(),
      );
      expect(collection?.textCount).toBe(3);

      // Bulk-import path is exclusively manual. Every inserted translation
      // must carry the `'user-provided'` tag so a future strategy swap won't
      // overwrite text the user typed.
      const allTranslations = await t.run(async (ctx) =>
        Promise.all(
          res.createdTextIds.map((textId) =>
            ctx.db
              .query("translations")
              .withIndex("by_textId", (q) => q.eq("textId", textId))
              .collect(),
          ),
        ),
      );
      for (const rows of allTranslations) {
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.translationSource).toBe("user-provided");
        }
      }
    });

    it("schedules metadata jobs the job validator accepts, tagged with the owner (regression)", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.customTexts.createCustomTextsBatch,
        {
          items: [
            {
              translations: [
                { language: "en", text: "One" },
                { language: "es", text: "Uno" },
              ],
            },
            {
              translations: [
                { language: "en", text: "Two" },
                { language: "es", text: "Dos" },
              ],
            },
          ],
          timezone: "UTC",
        },
      );
      expect(res.createdTextIds).toHaveLength(2);

      const jobs = await t.run(async (ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      const metadataJobs = jobs.filter((j) =>
        j.name.includes("generateSentenceMetadata"),
      );
      expect(metadataJobs).toHaveLength(2);
      for (const job of metadataJobs) {
        expect((job.args[0] as any).userId).toBe("user_A");
      }
      // Replay one job through the real action to prove the forwarded args
      // pass its validator.
      await t.action(
        internal.features.sentenceMetadata.generateSentenceMetadata,
        metadataJobs[0].args[0] as any,
      );
    });

    it("returns skipped entries for invalid rows without aborting the batch", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourseWithQuota(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const longText = "x".repeat(200);
      const items = [
        {
          translations: [
            { language: "en", text: "Hello" },
            { language: "es", text: "Hola" },
          ],
        },
        // Invalid: en missing
        {
          translations: [{ language: "es", text: "Solo español" }],
        },
        // Invalid: too long
        {
          translations: [
            { language: "en", text: longText },
            { language: "es", text: "Demasiado largo" },
          ],
        },
        {
          translations: [
            { language: "en", text: "Second valid" },
            { language: "es", text: "Segundo válido" },
          ],
        },
      ];
      const res = await asUser.mutation(
        api.features.customTexts.createCustomTextsBatch,
        { items, timezone: "UTC" },
      );
      expect(res.createdTextIds).toHaveLength(2);
      expect(res.skipped.map((s) => s.code).sort()).toEqual(
        ["INVALID_LANGUAGES", "TEXT_TOO_LONG"].sort(),
      );
      // Only the 2 valid items should be quota-consumed.
      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      expect(quota?.features.custom_sentences.used).toBe(2);
    });

    it("throws USAGE_LIMIT when valid items exceed quota balance", async () => {
      const t = convexTest(schema, modules);
      // Seed with balance=1
      await t.run(async (ctx) => {
        const courseId = await ctx.db.insert("courses", {
          userId: "user_B",
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        });
        await ctx.db.insert("userSettings", {
          userId: "user_B",
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        await ctx.db.insert("usageQuotas", {
          userId: "user_B",
          features: {
            custom_sentences: { balance: 1, included: 1, used: 0, unlimited: false },
            card_edits: { balance: 1, included: 1, used: 0, unlimited: false },
            translation_auto_fill: { balance: 1, included: 1, used: 0, unlimited: false },
          },
          lastSyncedAt: Date.now(),
        });
      });
      const asUser = t.withIdentity({ subject: "user_B" });
      await expect(
        asUser.mutation(api.features.customTexts.createCustomTextsBatch, {
          items: [
            {
              translations: [
                { language: "en", text: "A" },
                { language: "es", text: "A" },
              ],
            },
            {
              translations: [
                { language: "en", text: "B" },
                { language: "es", text: "B" },
              ],
            },
          ],
          timezone: "UTC",
        }),
      ).rejects.toThrow();
    });
  });
});
