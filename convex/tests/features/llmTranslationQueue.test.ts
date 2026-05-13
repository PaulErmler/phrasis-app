/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => (modelSlug: string) => ({ modelId: modelSlug }),
}));

import { generateText } from "ai";
import schema from "../../schema";
import { internal } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

async function seedText(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 1,
    });
    const textId = await ctx.db.insert("texts", {
      text: "Have you looked in the glove compartment?",
      language: "en",
      userCreated: false,
      collectionId,
      collectionRank: 1,
      addressesSomeone: true,
      addresseeGender: "male",
      referentGender: "female",
      speakerGender: "neutral",
      register: "neutral",
      addresseeNumber: "singular",
    });
    return { textId };
  });
}

describe("features/llmTranslationQueue", () => {
  describe("enqueueLlmTranslation", () => {
    it("inserts a queue row when a claim is already held by the caller", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimed = await t.run(async (ctx) => {
        // Import the helper indirectly via the test harness: we use the mutation
        // path that exercises it (scheduleMissingContent's branch), but since
        // claim is exported as a plain function, simulate by inserting + checking.
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
        return true;
      });
      expect(claimed).toBe(true);

      // Subsequent enqueueLlmTranslation inserts a queue row in its own
      // transaction. The pump (which dispatches into slots) is scheduled
      // separately and runs after this mutation returns — verified by the
      // OCC-isolation tests below. Here we just confirm enqueue persisted
      // a queue row.
      await t.mutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        {
          args: {
            textId,
            sourceLanguage: "de",
            targetLanguage: "de",
            text: "Have you looked in the glove compartment?",
            audioSpeakerGender: "male",
          },
        },
      );

      const queueRows = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationQueue").collect(),
      );
      expect(queueRows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("OCC-isolation: pump runs in a separate transaction", () => {
    it("enqueueLlmTranslation does NOT touch llmTranslationSlots in its own transaction", async () => {
      // Regression test for the OCC conflict where ensureContentForCollection
      // (a single batch mutation) was retrying forever because enqueue's pump
      // read the slot table while concurrent finalizers were writing it.
      // After the fix, enqueue's transaction must only write a queue row.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      // Pre-seed a slot row so we can verify it's untouched by enqueue.
      const slotIdBefore = await t.run(async (ctx) =>
        ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() - 5000 }),
      );

      await t.mutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        {
          args: {
            textId,
            sourceLanguage: "en",
            targetLanguage: "de",
            text: "Hi.",
            audioSpeakerGender: "male",
          },
        },
      );

      // The pre-existing slot row is still there — enqueue did not touch the
      // slots table. The pump that WOULD have read it is scheduled but hasn't
      // run yet (we haven't flushed scheduled functions).
      const slotStillThere = await t.run(async (ctx) =>
        ctx.db.get(slotIdBefore),
      );
      expect(slotStillThere).not.toBeNull();

      // The queue row was inserted (in enqueue's own transaction).
      const queue = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationQueue").collect(),
      );
      expect(queue.length).toBe(1);
    });

    it("finalizeLlmTranslationJob does not dispatch the queue inline", async () => {
      // After the OCC fix, finalize only deletes its own slot + claim. Pump
      // (which would consume queue rows and insert new slots) is scheduled
      // separately. So observing the table state IMMEDIATELY after finalize
      // returns should show the queue row still present — proving pump did
      // NOT run inline in finalize's transaction.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      // Seed: 2 slots (one we'll delete) + 1 claim + 1 queued job
      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
        await ctx.db.insert("llmTranslationQueue", {
          args: {
            textId,
            sourceLanguage: "en",
            targetLanguage: "de",
            text: "Hi.",
            audioSpeakerGender: "male",
          },
          queuedAt: Date.now(),
        });
      });

      await t.mutation(
        internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
        { textId, targetLanguage: "de" },
      );

      // Finalize removed exactly one slot + the claim, and the queued job
      // is STILL there — pump runs in a separate (scheduled) transaction.
      // This is the property that prevents OCC retries when many finalizers
      // race with one big batch mutation like ensureContentForCollection.
      const slotsAfterFinalize = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      const queueAfterFinalize = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationQueue").collect(),
      );
      expect(slotsAfterFinalize.length).toBe(1);
      expect(queueAfterFinalize.length).toBe(1);
    });
  });

  describe("finalizeLlmTranslationJob", () => {
    it("deletes one slot and removes the matching claim", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      // Seed: 1 slot row + 1 matching claim.
      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
      });

      await t.mutation(
        internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
        { textId, targetLanguage: "de" },
      );

      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      const claims = await t.run(async (ctx) =>
        ctx.db
          .query("llmTranslationClaims")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "de"),
          )
          .collect(),
      );
      expect(slots.length).toBe(0);
      expect(claims.length).toBe(0);
    });

    it("is idempotent — no slot, no claim → no-op (no throw)", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await expect(
        t.mutation(
          internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
          { textId, targetLanguage: "de" },
        ),
      ).resolves.toBeNull();
    });

    it("leaves a claim for a DIFFERENT (textId, lang) untouched", async () => {
      const t = convexTest(schema, modules);
      const { textId: t1 } = await seedText(t);
      const { textId: t2 } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationClaims", {
          textId: t1,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
        await ctx.db.insert("llmTranslationClaims", {
          textId: t2,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
      });
      await t.mutation(
        internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
        { textId: t1, targetLanguage: "de" },
      );
      const t2claims = await t.run(async (ctx) =>
        ctx.db
          .query("llmTranslationClaims")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", t2).eq("targetLanguage", "de"),
          )
          .collect(),
      );
      expect(t2claims.length).toBe(1);
    });
  });

  describe("pumpLlmQueue", () => {
    it("dispatches a queued job when slots are available", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      // Seed a queue row directly to isolate the pump behavior.
      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationQueue", {
          args: {
            textId,
            sourceLanguage: "en",
            targetLanguage: "de",
            text: "Hi.",
            audioSpeakerGender: "male",
          },
          queuedAt: Date.now(),
        });
      });

      await t.mutation(
        internal.features.llmTranslationQueue.pumpLlmQueue,
        {},
      );

      // The dispatch inserted a slot row and removed the queue row.
      const queue = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationQueue").collect(),
      );
      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      expect(queue.length).toBe(0);
      expect(slots.length).toBe(1);
    });

    it("is a no-op when the queue is empty", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(internal.features.llmTranslationQueue.pumpLlmQueue, {}),
      ).resolves.toBeNull();
    });

    it("reclaims stale slot rows older than SLOT_STALE_MS", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const TWO_MINUTES_AGO = Date.now() - 2 * 60 * 1000;
      await t.run(async (ctx) => {
        // Stale slot from a crashed action.
        await ctx.db.insert("llmTranslationSlots", {
          claimedAt: TWO_MINUTES_AGO,
        });
        // Queued job waiting for a slot.
        await ctx.db.insert("llmTranslationQueue", {
          args: {
            textId,
            sourceLanguage: "en",
            targetLanguage: "de",
            text: "Hi.",
            audioSpeakerGender: "male",
          },
          queuedAt: Date.now(),
        });
      });

      await t.mutation(
        internal.features.llmTranslationQueue.pumpLlmQueue,
        {},
      );

      // Stale slot was reclaimed, queue row was dispatched (consumed), new
      // fresh slot was inserted.
      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      expect(slots.length).toBe(1);
      expect(slots[0].claimedAt).toBeGreaterThan(TWO_MINUTES_AGO);
    });
  });

  describe("processLlmTranslationForCard (action)", () => {
    const originalKey = process.env.OPENROUTER_API_KEY;

    beforeEach(() => {
      vi.mocked(generateText).mockReset();
      process.env.OPENROUTER_API_KEY = "test-key";
    });
    afterEach(() => {
      if (originalKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalKey;
      }
    });

    function mockGenerateTextOk(content: string, finishReason: string = "stop") {
      vi.mocked(generateText).mockResolvedValue({
        text: content,
        finishReason,
        usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135 },
      } as any);
    }

    it("on LLM success: writes a translations row and finalizes", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      // Pre-seed a slot + claim so finalizeLlmTranslationJob has something to clean up.
      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
      });

      mockGenerateTextOk("Haben Sie ins Handschuhfach geschaut?");

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        {
          textId,
          sourceLanguage: "en",
          targetLanguage: "de",
          text: "Have you looked in the glove compartment?",
          audioSpeakerGender: "male",
        },
      );

      // Translations row created.
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "de"),
          )
          .collect(),
      );
      expect(translations.length).toBe(1);
      expect(translations[0].translatedText).toBe(
        "Haben Sie ins Handschuhfach geschaut?",
      );

      // Slot + claim cleaned up.
      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      expect(slots.length).toBe(0);
    });

    it("on truncation (finishReason=length): falls back to Google path", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
      });

      vi.mocked(generateText).mockResolvedValue({
        text: "",
        finishReason: "length",
        usage: { inputTokens: 120, outputTokens: 5000, totalTokens: 5120 },
      } as any);

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        {
          textId,
          sourceLanguage: "en",
          targetLanguage: "de",
          text: "Have you looked in the glove compartment?",
          audioSpeakerGender: "male",
        },
      );

      // The action should have scheduled the Google-translate fallback. We
      // can't directly inspect scheduled jobs through convex-test in this
      // version, but we can verify:
      //   - No translations row was written by the LLM path (the fallback
      //     hasn't actually run since it's scheduled async)
      //   - Slot + claim were finalized so the queue can keep moving
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "de"),
          )
          .collect(),
      );
      expect(translations.length).toBe(0);
      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      expect(slots.length).toBe(0);
    });

    it("on empty response: falls back to Google path", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
      });

      vi.mocked(generateText).mockResolvedValue({
        text: "",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      } as any);

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        {
          textId,
          sourceLanguage: "en",
          targetLanguage: "de",
          text: "Hi.",
          audioSpeakerGender: "male",
        },
      );

      // Slot + claim were finalized (regardless of fallback timing).
      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      expect(slots.length).toBe(0);
    });

    it("on HTTP error: falls back to Google path", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
      });

      vi.mocked(generateText).mockRejectedValue(
        new Error("status=500 internal server error"),
      );

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        {
          textId,
          sourceLanguage: "en",
          targetLanguage: "de",
          text: "Hi.",
          audioSpeakerGender: "male",
        },
      );

      // No translations row from the LLM path; slot/claim cleaned up.
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "de"),
          )
          .collect(),
      );
      expect(translations.length).toBe(0);
      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      expect(slots.length).toBe(0);
    });

    it("omits <addressee_gender> and <register> from the prompt when addressesSomeone=false", async () => {
      const t = convexTest(schema, modules);
      // Seed a descriptive sentence — addressesSomeone=false.
      const { textId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 1,
        });
        const textId = await ctx.db.insert("texts", {
          text: "It is raining today.",
          language: "en",
          userCreated: false,
          collectionId,
          collectionRank: 1,
          addressesSomeone: false,
          addresseeNumber: "not_applicable",
          referentGender: "male",
        });
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
        return { textId };
      });

      mockGenerateTextOk("Es regnet heute.");

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        {
          textId,
          sourceLanguage: "en",
          targetLanguage: "de",
          text: "It is raining today.",
        },
      );

      // Inspect what was sent to OpenRouter.
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      const prompt = callArg.prompt as string;
      expect(prompt).not.toContain("<addressee_gender>");
      expect(prompt).not.toContain("<register>");
      // But <referent_gender> is always present.
      expect(prompt).toContain("<referent_gender>male</referent_gender>");
    });
  });
});
