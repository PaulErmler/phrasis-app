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
    it("with slotId: deletes exactly that slot, leaving others untouched", async () => {
      // Regression test for the OCC-failure hotspot: releasing "the oldest"
      // slot made every concurrent finalizer read+delete the same head row.
      // With slotId, each finalizer's write set is its own row.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const { mine, other } = await t.run(async (ctx) => {
        const mine = await ctx.db.insert("llmTranslationSlots", {
          // Newer than `other` — the legacy behavior would have deleted
          // `other` (the oldest); by-id must delete `mine`.
          claimedAt: Date.now(),
        });
        const other = await ctx.db.insert("llmTranslationSlots", {
          claimedAt: Date.now() - 5_000,
        });
        return { mine, other };
      });

      await t.mutation(
        internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
        { textId, targetLanguage: "de", slotId: mine },
      );

      const mineAfter = await t.run(async (ctx) => ctx.db.get(mine));
      const otherAfter = await t.run(async (ctx) => ctx.db.get(other));
      expect(mineAfter).toBeNull();
      expect(otherAfter).not.toBeNull();
    });

    it("with an already-reclaimed slotId: deletes no other slot", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const { gone, survivor } = await t.run(async (ctx) => {
        const gone = await ctx.db.insert("llmTranslationSlots", {
          claimedAt: Date.now(),
        });
        // Simulate a pump stale-reclaiming the slot mid-flight.
        await ctx.db.delete(gone);
        const survivor = await ctx.db.insert("llmTranslationSlots", {
          claimedAt: Date.now(),
        });
        return { gone, survivor };
      });

      await expect(
        t.mutation(
          internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
          { textId, targetLanguage: "de", slotId: gone },
        ),
      ).resolves.toBeNull();

      const survivorAfter = await t.run(async (ctx) => ctx.db.get(survivor));
      expect(survivorAfter).not.toBeNull();
    });

    it("without slotId (legacy pre-deploy job): still releases one slot", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
      });

      await t.mutation(
        internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
        { textId, targetLanguage: "de" },
      );

      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      expect(slots.length).toBe(1);
    });

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

    it("with keepClaim=true refreshes (not deletes) the owned claim", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const staleAt = Date.now() - 10_000;
      const claimId = await t.run(async (ctx) =>
        ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: staleAt,
        }),
      );

      await t.mutation(
        internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
        { textId, targetLanguage: "de", keepClaim: true, claimId },
      );

      const claim = await t.run(async (ctx) => ctx.db.get(claimId));
      // Claim survives (held across the retry/fallback) and its timestamp is
      // refreshed so a concurrent reconcile can't reclaim it during backoff.
      expect(claim).not.toBeNull();
      expect(claim!.claimedAt).toBeGreaterThan(staleAt);
    });

    it("leaves a FOREIGN claim (reclaimed mid-call → different _id) untouched", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      // Simulate: this attempt was dispatched under `staleClaimId`, but a
      // concurrent reconcile deleted+reinserted the claim, so the current row
      // has a new _id. finalize must NOT delete the new owner's claim.
      const { staleClaimId, currentClaimId } = await t.run(async (ctx) => {
        const staleClaimId = await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now() - 10_000,
        });
        await ctx.db.delete(staleClaimId);
        const currentClaimId = await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
        return { staleClaimId, currentClaimId };
      });

      await t.mutation(
        internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
        {
          textId,
          targetLanguage: "de",
          keepClaim: false,
          claimId: staleClaimId,
        },
      );

      const current = await t.run(async (ctx) => ctx.db.get(currentClaimId));
      expect(current).not.toBeNull();
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

    it("threads the inserted slot's _id into the dispatched worker args", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
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

      await t.mutation(internal.features.llmTranslationQueue.pumpLlmQueue, {});

      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      expect(slots.length).toBe(1);
      const scheduled = await t.run(async (ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      const dispatched = scheduled.filter((s) =>
        s.name.includes("processLlmTranslationForCard"),
      );
      expect(dispatched.length).toBe(1);
      // The worker (and through it the finalizer) releases exactly this slot.
      expect((dispatched[0].args[0] as any).slotId).toBe(slots[0]._id);
    });
  });

  describe("pump scheduling dedup (queuePumpStates)", () => {
    const readPumpState = (t: ReturnType<typeof convexTest>) =>
      t.run(async (ctx) =>
        ctx.db
          .query("queuePumpStates")
          .withIndex("by_key", (q) => q.eq("key", "llm"))
          .first(),
      );
    const countScheduledPumps = async (t: ReturnType<typeof convexTest>) => {
      const scheduled = await t.run(async (ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      return scheduled.filter((s) => s.name.includes("pumpLlmQueue")).length;
    };
    const enqueue = (t: ReturnType<typeof convexTest>, textId: any) =>
      t.mutation(internal.features.llmTranslationQueue.enqueueLlmTranslation, {
        args: {
          textId,
          sourceLanguage: "en",
          targetLanguage: "de",
          text: "Hi.",
          audioSpeakerGender: "male",
        },
      });

    it("N enqueues schedule exactly ONE pump", async () => {
      // The pump storm: every enqueue used to schedule its own pump, and the
      // concurrent pumps' overlapping slot-table scans OCC-retried by the
      // hundreds. Now the 2nd..Nth enqueues no-op on the pending flag.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await enqueue(t, textId);
      await enqueue(t, textId);
      await enqueue(t, textId);

      expect(await countScheduledPumps(t)).toBe(1);
      const state = await readPumpState(t);
      expect(state?.pumpScheduled).toBe(true);
    });

    it("no lost wakeups: an enqueue after a pump ran schedules a fresh pump", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await enqueue(t, textId);
      expect(await countScheduledPumps(t)).toBe(1);

      // The pump clears the flag as its first write, so work enqueued after
      // it started is picked up by a NEW pump rather than silently dropped.
      await t.mutation(internal.features.llmTranslationQueue.pumpLlmQueue, {});
      expect((await readPumpState(t))?.pumpScheduled).toBe(false);

      await enqueue(t, textId);
      expect(await countScheduledPumps(t)).toBe(2);
    });

    it("the pump clears the flag even when the queue is empty", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("queuePumpStates", {
          key: "llm",
          pumpScheduled: true,
          pumpScheduledFor: Date.now(),
        });
      });

      await t.mutation(internal.features.llmTranslationQueue.pumpLlmQueue, {});

      expect((await readPumpState(t))?.pumpScheduled).toBe(false);
    });

    it("wedge recovery: a stale flag (dead scheduled pump) doesn't block scheduling", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      // Flag says a pump is pending, but its run time is a minute in the past
      // (beyond PUMP_WEDGE_MS) — the scheduled invocation died. The next
      // enqueue must schedule anyway instead of wedging the queue forever.
      await t.run(async (ctx) => {
        await ctx.db.insert("queuePumpStates", {
          key: "llm",
          pumpScheduled: true,
          pumpScheduledFor: Date.now() - 60_000,
        });
      });

      await enqueue(t, textId);

      expect(await countScheduledPumps(t)).toBe(1);
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

    it("releases exactly the slot it was dispatched under (slotId)", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      const { mine, other } = await t.run(async (ctx) => {
        const mine = await ctx.db.insert("llmTranslationSlots", {
          claimedAt: Date.now(),
        });
        // A concurrent job's slot — must survive this worker's finalize.
        const other = await ctx.db.insert("llmTranslationSlots", {
          claimedAt: Date.now() - 5_000,
        });
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
        return { mine, other };
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
          slotId: mine,
        },
      );

      const mineAfter = await t.run(async (ctx) => ctx.db.get(mine));
      const otherAfter = await t.run(async (ctx) => ctx.db.get(other));
      expect(mineAfter).toBeNull();
      expect(otherAfter).not.toBeNull();
    });

    // Helpers for inspecting what the worker scheduled on failure. The worker
    // re-enqueues the LLM (enqueueLlmTranslation) on a transient failure and only
    // schedules the Google fallback (processTranslationForCard) once retries are
    // exhausted.
    const readScheduled = (t: ReturnType<typeof convexTest>) =>
      t.run(async (ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
    const llmRetries = (scheduled: any[]) =>
      scheduled.filter((s) => s.name.includes("enqueueLlmTranslation"));
    const googleFallbacks = (scheduled: any[]) =>
      scheduled.filter((s) => s.name.includes("processTranslationForCard"));

    async function seedSlotAndClaim(
      t: ReturnType<typeof convexTest>,
      textId: any,
    ) {
      return t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationSlots", { claimedAt: Date.now() });
        return ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "de",
          claimedAt: Date.now(),
        });
      });
    }

    it("on truncation (finishReason=length): retries the LLM and does NOT fall back to Google yet", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await seedSlotAndClaim(t, textId);

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

      const scheduled = await readScheduled(t);
      // First failure → an LLM retry is scheduled with failureCount incremented
      // to 1, NOT the Google fallback.
      const retries = llmRetries(scheduled);
      expect(retries.length).toBe(1);
      expect((retries[0].args[0] as any).args.failureCount).toBe(1);
      expect(googleFallbacks(scheduled).length).toBe(0);

      // No translation written yet; the slot is freed so the queue keeps moving;
      // the claim is KEPT (held across the retry) so a concurrent reconcile can't
      // re-route the same row.
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
      const claims = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationClaims").collect(),
      );
      expect(claims.length).toBe(1);
    });

    it("on empty response: retries the LLM", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await seedSlotAndClaim(t, textId);

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

      const scheduled = await readScheduled(t);
      expect(llmRetries(scheduled).length).toBe(1);
      expect(googleFallbacks(scheduled).length).toBe(0);
      const slots = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationSlots").collect(),
      );
      expect(slots.length).toBe(0);
    });

    it("on HTTP error: retries the LLM", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await seedSlotAndClaim(t, textId);

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

      const scheduled = await readScheduled(t);
      expect(llmRetries(scheduled).length).toBe(1);
      expect(googleFallbacks(scheduled).length).toBe(0);
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

    it("after the LLM retry budget is exhausted: falls back to Google (no further LLM retry)", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await seedSlotAndClaim(t, textId);

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
          // Far above MAX_LLM_RETRIES so handleLlmFailure takes the terminal
          // Google branch regardless of the exact cap value.
          failureCount: 999,
        },
      );

      const scheduled = await readScheduled(t);
      // Terminal: Google fallback scheduled, no more LLM retries.
      expect(googleFallbacks(scheduled).length).toBe(1);
      expect(llmRetries(scheduled).length).toBe(0);
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
