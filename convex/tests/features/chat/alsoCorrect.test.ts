/// <reference types="vite/client" />
import { vi } from "vitest";

// approveCard schedules `generateSentenceMetadata` (a raw scheduler action).
// Same file-level stubs as cardApprovals.test.ts so the chain resolves
// instantly instead of fetching OpenRouter; tests that drain scheduled
// functions then tear down cleanly.
vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "{}" })),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => () => ({}),
}));
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
import { describe, it, expect, afterEach } from "vitest";
import schema from "../../../schema";
import { api, internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { ProposedCardMetadata } from "../../../types";
import { insertAudioFixture } from "../../lib/audioFixtures";
import { translationGenderSlot } from "../../../../lib/speakerGender";
// Module-mocked globally (tests/convexTestSetup.ts), used to assert on the
// voice the replace path enqueues and to prove it enqueues no retranslation.
import { ttsPool, llmPool } from "../../../lib/workpools";

const modules = import.meta.glob("/convex/**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Card whose text row is user-owned (Path A territory): es main text with an
 * en translation, plus card_edits + custom_sentences quota.
 */
async function seedOwnedCard(
  t: TestConvex<typeof schema>,
  opts: { userCreated?: boolean } = {},
) {
  const userCreated = opts.userCreated ?? true;
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
    const deckId = await ctx.db.insert("decks", {
      courseId,
      name: "d",
      cardCount: 1,
    });
    const textId = await ctx.db.insert("texts", {
      text: "Quiero un café.",
      language: "es",
      userCreated,
      ...(userCreated ? { userId: "user_A" } : {}),
      collectionId,
      collectionRank: 1,
    });
    await ctx.db.insert("translations", {
      textId,
      targetLanguage: "en",
      translatedText: "I want a coffee.",
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
    await ctx.db.insert("usageQuotas", {
      userId: "user_A",
      features: {
        card_edits: { balance: 10, included: 10, used: 0, unlimited: false },
        custom_sentences: {
          balance: 10,
          included: 10,
          used: 0,
          unlimited: false,
        },
      },
      lastSyncedAt: Date.now(),
    });
    return { cardId, courseId, deckId, textId, collectionId };
  });
}

/** Raw result. `{ status: 'created', approvalId }` or `{ status: 'identical' }`. */
async function createApprovalResult(
  t: TestConvex<typeof schema>,
  cardId: Id<"cards">,
  translations: { language: string; text: string }[],
  proposedMetadata?: ProposedCardMetadata,
  overrides?: { threadId?: string; toolCallId?: string },
) {
  return t.mutation(
    internal.features.chat.cardApprovals.createAlsoCorrectApprovalInternal,
    {
      threadId: overrides?.threadId ?? "thread_1",
      messageId: "m1",
      toolCallId: overrides?.toolCallId ?? "tc1",
      cardId,
      translations,
      proposedMetadata,
      userId: "user_A",
    },
  );
}

/** Convenience for the common case: asserts a row was created and returns its id. */
async function createApproval(
  t: TestConvex<typeof schema>,
  cardId: Id<"cards">,
  translations: { language: string; text: string }[],
  proposedMetadata?: ProposedCardMetadata,
  overrides?: { threadId?: string; toolCallId?: string },
): Promise<Id<"cardApprovals">> {
  const result = await createApprovalResult(
    t,
    cardId,
    translations,
    proposedMetadata,
    overrides,
  );
  if (result.status !== "created") {
    throw new Error(`expected an approval row, got status "${result.status}"`);
  }
  return result.approvalId;
}

describe("features/chat/alsoCorrect", () => {
  describe("createAlsoCorrectApprovalInternal", () => {
    it("merges a changed-language fragment over the card's full set", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCard(t);
      const approvalId = await createApproval(t, cardId, [
        { language: "es", text: "Me gustaría un café." },
      ]);
      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.kind).toBe("alsoCorrect");
      expect(approval?.cardId).toBe(cardId);
      expect(approval?.status).toBe("pending");
      expect(approval?.changedLanguages).toEqual(["es"]);
      // Full merged set, base language first (the processApproval convention).
      expect(approval?.translations).toEqual([
        { language: "en", text: "I want a coffee." },
        { language: "es", text: "Me gustaría un café." },
      ]);
    });

    // The single most common Writing-mode case: the user typed the sentence
    // correctly (or missed a diacritic), so the model's "keep their wording,
    // fix punctuation/diacritics" output IS the card. That must be a silent
    // no-op, throwing rendered a red "Could not save your version" box on a
    // right answer.
    it("reports a no-op (not an error) for a proposal identical to the card", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCard(t);
      const result = await createApprovalResult(t, cardId, [
        { language: "es", text: "Quiero un café." },
      ]);
      expect(result).toEqual({ status: "identical" });
      const rows = await t.run(async (ctx) =>
        ctx.db.query("cardApprovals").collect(),
      );
      expect(rows).toHaveLength(0);
    });

    it("accepts a metadata-only proposal (identical text)", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCard(t);
      const approvalId = await createApproval(
        t,
        cardId,
        [{ language: "es", text: "Quiero un café." }],
        { speakerGender: "female" },
      );
      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.changedLanguages).toEqual([]);
      expect(approval?.proposedMetadata).toEqual({ speakerGender: "female" });
    });

    it("rejects languages outside the course", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCard(t);
      await expect(
        createApproval(t, cardId, [{ language: "fr", text: "Un café." }]),
      ).rejects.toThrow(/not in course/);
    });

    it("rejects a card the user does not own", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCard(t);
      await expect(
        t.mutation(
          internal.features.chat.cardApprovals
            .createAlsoCorrectApprovalInternal,
          {
            threadId: "thread_1",
            messageId: "m1",
            toolCallId: "tc1",
            cardId,
            translations: [{ language: "es", text: "Me gustaría un café." }],
            userId: "user_B",
          },
        ),
      ).rejects.toThrow(/authorized/);
    });
  });

  describe("approveCard on an alsoCorrect approval (add as new card)", () => {
    it("creates the chat-collection text and stamps resolution newCard", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedOwnedCard(t);
      const approvalId = await createApproval(t, cardId, [
        { language: "es", text: "Me gustaría un café." },
      ]);
      const asUser = t.withIdentity({ subject: "user_A" });
      vi.useFakeTimers();
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId },
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(res.success).toBe(true);

      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.status).toBe("approved");
      expect(approval?.resolution).toBe("newCard");

      // New text created in the chat collection; the original card untouched.
      const newText = await t.run(async (ctx) => ctx.db.get(res.textId!));
      expect(newText?.text).toBe("I want a coffee.");
      const collection = await t.run(async (ctx) =>
        ctx.db.get(newText!.collectionId),
      );
      expect(collection?.origin).toBe("chat");
      const originalText = await t.run(async (ctx) => ctx.db.get(textId));
      expect(originalText?.text).toBe("Quiero un café.");
    });
  });

  describe("replaceCardFromApproval", () => {
    it("Path A: patches the user-owned text in place and resolves the approval", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedOwnedCard(t);
      const approvalId = await createApproval(t, cardId, [
        { language: "es", text: "Me gustaría un café." },
      ]);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId, timezone: "UTC" },
      );
      expect(res.success).toBe(true);

      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.text).toBe("Me gustaría un café.");
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.textId).toBe(textId);

      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.status).toBe("approved");
      expect(approval?.resolution).toBe("replaced");
      expect(approval?.textId).toBe(textId);

      // Billed as a card edit.
      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      expect(quota?.features.card_edits.balance).toBe(9);
    });

    it("Path B: a shared/dataset text is copied to a user-owned one", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, deckId } = await seedOwnedCard(t, {
        userCreated: false,
      });
      const approvalId = await createApproval(t, cardId, [
        { language: "es", text: "Me gustaría un café." },
      ]);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId, timezone: "UTC" },
      );

      // Shared text untouched; the deck's (replacement) card points at a new
      // user-owned copy carrying the new phrasing.
      const sharedText = await t.run(async (ctx) => ctx.db.get(textId));
      expect(sharedText === null || sharedText.text === "Quiero un café.").toBe(
        true,
      );
      const cards = await t.run(async (ctx) =>
        (await ctx.db.query("cards").collect()).filter(
          (c) => c.deckId === deckId,
        ),
      );
      expect(cards).toHaveLength(1);
      const newText = await t.run(async (ctx) => ctx.db.get(cards[0].textId));
      expect(newText?.text).toBe("Me gustaría un café.");
      expect(newText?.userCreated).toBe(true);
      expect(newText?.userId).toBe("user_A");
    });

    // The manual edit dialog treats a retyped curriculum translation as a
    // complaint: it flags the shared row and suggests the user's wording to a
    // retranslation. Accepting an "also correct" alternative from the tutor is
    // not that claim, so this path must leave the shared row alone.
    it("does not flag the shared curriculum row (unlike a manual edit)", async () => {
      const t = convexTest(schema, modules);
      vi.mocked(llmPool.enqueueAction).mockClear();
      const { cardId, textId } = await seedOwnedCard(t, { userCreated: false });
      // Change "en", a translation row rather than the text's own language,
      // so the manual path's guards would all pass here.
      const approvalId = await createApproval(t, cardId, [
        { language: "en", text: "I'd like a coffee." },
      ]);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId, timezone: "UTC" },
      );

      const sharedTranslation = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "en"),
          )
          .first(),
      );
      expect(sharedTranslation?.flagCount).toBeUndefined();
      expect(sharedTranslation?.translatedText).toBe("I want a coffee.");

      const retranslations = vi
        .mocked(llmPool.enqueueAction)
        .mock.calls.map((c) => c[2] as { textId: Id<"texts">; ruleOverride?: string })
        .filter((a) => a.textId === textId);
      expect(retranslations).toHaveLength(0);
    });

    // The learn view suppresses its chat-thread rotation for exactly the card
    // a replace produced, so the mutation has to report that id. Path B swaps
    // the card document; Path A patches in place and must report the same id.
    it("reports the replacement card id (new on Path B, unchanged on Path A)", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });

      const shared = await seedOwnedCard(t, { userCreated: false });
      const pathBApproval = await createApproval(t, shared.cardId, [
        { language: "es", text: "Me gustaría un café." },
      ]);
      const pathB = await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId: pathBApproval, timezone: "UTC" },
      );
      expect(pathB.cardId).not.toBe(shared.cardId);
      expect(await t.run(async (ctx) => ctx.db.get(pathB.cardId))).not.toBeNull();

      const owned = await seedOwnedCard(t);
      const pathAApproval = await createApproval(
        t,
        owned.cardId,
        [{ language: "es", text: "Me apetece un café." }],
        undefined,
        { threadId: "thread_2", toolCallId: "tc2" },
      );
      const pathA = await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId: pathAApproval, timezone: "UTC" },
      );
      expect(pathA.cardId).toBe(owned.cardId);
    });

    // Path B deletes the old card document, so a second pending proposal for
    // the same card would dead-end on "Card not found". The button silently
    // doing nothing on every retry. Same-thread siblings are retargeted.
    it("retargets other pending proposals in the thread after a Path B replace", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCard(t, { userCreated: false });
      const first = await createApproval(t, cardId, [
        { language: "es", text: "Me gustaría un café." },
      ]);
      const second = await createApproval(
        t,
        cardId,
        [{ language: "es", text: "Me apetece un café." }],
        undefined,
        { toolCallId: "tc2" },
      );

      const asUser = t.withIdentity({ subject: "user_A" });
      const { cardId: replacementId } = await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId: first, timezone: "UTC" },
      );

      const stillPending = await t.run(async (ctx) => ctx.db.get(second));
      expect(stillPending?.status).toBe("pending");
      expect(stillPending?.cardId).toBe(replacementId);

      // And it is actually usable, rather than throwing "Card not found".
      await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId: second, timezone: "UTC" },
      );
      expect(
        (await t.run(async (ctx) => ctx.db.get(second)))?.status,
      ).toBe("approved");
    });

    // Path B rebuilds the card document field by field. Every counter it
    // carries is history that an edit must not reset, and none of them have a
    // backfill. A drop is unrecoverable.
    it("Path B preserves reviewCountByMode across the card replacement", async () => {
      const t = convexTest(schema, modules);
      const { cardId, deckId } = await seedOwnedCard(t, { userCreated: false });
      await t.run(async (ctx) =>
        ctx.db.patch(cardId, { reviewCountByMode: { audio: 12, full: 4 } }),
      );

      const approvalId = await createApproval(t, cardId, [
        { language: "es", text: "Me gustaría un café." },
      ]);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId, timezone: "UTC" },
      );

      const cards = await t.run(async (ctx) =>
        (await ctx.db.query("cards").collect()).filter(
          (c) => c.deckId === deckId,
        ),
      );
      expect(cards).toHaveLength(1);
      expect(cards[0].reviewCountByMode).toEqual({ audio: 12, full: 4 });
    });

    // `translations` is the full course-language set merged at PROPOSAL time.
    // Writing it wholesale would diff a stale snapshot against the card and
    // silently revert an edit the user made to an untouched language in the
    // meantime, so only `changedLanguages` may be written.
    it("does not revert a concurrent edit to an unchanged language", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedOwnedCard(t);
      const approvalId = await createApproval(t, cardId, [
        { language: "es", text: "Me gustaría un café." },
      ]);

      // User fixes the English AFTER the proposal was captured.
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("translations")
          .withIndex("by_textId", (q) => q.eq("textId", textId))
          .filter((q) => q.eq(q.field("targetLanguage"), "en"))
          .unique();
        await ctx.db.patch(row!._id, {
          translatedText: "I'm going to the store.",
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const { cardId: replacementId } = await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId, timezone: "UTC" },
      );

      const finalTextId = (await t.run(async (ctx) =>
        ctx.db.get(replacementId),
      ))!.textId;
      const rows = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_textId", (q) => q.eq("textId", finalTextId))
          .collect(),
      );
      const en = rows.find((r) => r.targetLanguage === "en");
      expect(en?.translatedText).toBe("I'm going to the store.");
      const es = rows.find((r) => r.targetLanguage === "es");
      // The proposed language still landed.
      expect(es?.translatedText ?? "Me gustaría un café.").toBe(
        "Me gustaría un café.",
      );
    });

    it("metadata-only replace on a shared text still copies to a user-owned row", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, deckId } = await seedOwnedCard(t, {
        userCreated: false,
      });
      const approvalId = await createApproval(
        t,
        cardId,
        [{ language: "es", text: "Quiero un café." }],
        { speakerGender: "female", register: "informal" },
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId, timezone: "UTC" },
      );

      const cards = await t.run(async (ctx) =>
        (await ctx.db.query("cards").collect()).filter(
          (c) => c.deckId === deckId,
        ),
      );
      expect(cards).toHaveLength(1);
      // The shared row must never be patched. Metadata landed on the copy.
      expect(cards[0].textId).not.toBe(textId);
      const newText = await t.run(async (ctx) => ctx.db.get(cards[0].textId));
      expect(newText?.userCreated).toBe(true);
      expect(newText?.speakerGender).toBe("female");
      expect(newText?.audioSpeakerGender).toBe("female");
      expect(newText?.register).toBe("informal");
    });

    it("text + gender replace enqueues the re-synthesis with the PROPOSED voice gender", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedOwnedCard(t);
      // Card currently voiced female, with existing es audio.
      await t.run(async (ctx) => {
        await ctx.db.patch(textId, {
          speakerGender: "female",
          audioSpeakerGender: "female",
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        await insertAudioFixture(ctx, {
          textId,
          language: "es",
          voiceName: "Leda",
          voiceGender: "female",
          storageId,
          ttsQuality: "validated",
          ttsProvider: "gemini",
        });
      });

      // The tú→usted-style case the tool prompt targets: the sentence AND
      // the speaker gender change together.
      const approvalId = await createApproval(
        t,
        cardId,
        [{ language: "es", text: "Me gustaría un café." }],
        { speakerGender: "male" },
      );
      vi.mocked(ttsPool.enqueueAction).mockClear();
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId, timezone: "UTC" },
      );

      // The replace deletes the stale es audio and enqueues the re-synthesis
      // inside applyCardEdit. That synthesis must already use the proposed
      // male voice: the later prepareCardContent pass is blocked by the TTS
      // claim this enqueue just took, so it cannot correct a wrong voice.
      const esJobs = vi
        .mocked(ttsPool.enqueueAction)
        .mock.calls.filter(
          ([, , jobArgs]) =>
            (jobArgs as { language: string }).language === "es",
        );
      expect(esJobs.length).toBeGreaterThan(0);
      for (const [, , jobArgs] of esJobs) {
        expect((jobArgs as { voiceGender: string }).voiceGender).toBe("male");
      }
    });

    it("gender change re-stamps translations, schedules prepareCardContent, and the payload-mismatch branch re-voices audio", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedOwnedCard(t);
      // Card currently voiced female with matching stamps + audio payloads.
      const { assetId, blobId } = await t.run(async (ctx) => {
        await ctx.db.patch(textId, {
          speakerGender: "female",
          audioSpeakerGender: "female",
        });
        const rows = await ctx.db
          .query("translations")
          .withIndex("by_textId", (q) => q.eq("textId", textId))
          .collect();
        for (const row of rows) {
          await ctx.db.patch(row._id, { speakerGender: "female" });
        }
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        const fixture = await insertAudioFixture(ctx, {
          textId,
          language: "es",
          voiceName: "Leda",
          voiceGender: "female",
          storageId,
          ttsQuality: "validated",
          ttsProvider: "gemini",
        });
        return { assetId: fixture.assetId, blobId: storageId };
      });

      const approvalId = await createApproval(
        t,
        cardId,
        [{ language: "es", text: "Quiero un café." }],
        { speakerGender: "male" },
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(
        api.features.chat.cardApprovals.replaceCardFromApproval,
        { approvalId, timezone: "UTC" },
      );

      // Transactional effects: the text flips to male and every translation
      // row is re-stamped with its explicit tri-state slot — the male slot on
      // languages that mark speaker gender, 'neutral' where the rendering
      // serves both genders (the English row here).
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.audioSpeakerGender).toBe("male");
      expect(text?.speakerGender).toBe("male");
      const stamps = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_textId", (q) => q.eq("textId", textId))
          .collect(),
      );
      expect(stamps.length).toBeGreaterThan(0);
      for (const row of stamps) {
        expect(row.speakerGender).toBe(
          translationGenderSlot(row.targetLanguage, "male"),
        );
      }

      // The re-voice pass was scheduled…
      const jobs = await t.run(async (ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      const prepareJobs = jobs.filter((j) =>
        j.name.includes("prepareCardContent"),
      );
      expect(prepareJobs.length).toBeGreaterThan(0);

      // …and running it leaves the female-voiced pointer in place as the
      // sibling VARIANT (the ensure sweep never deletes on gender grounds
      // any more) while the male voice is scheduled additively; the asset +
      // blob stay in the audioAssets cache either way.
      await t.mutation(internal.features.decks.prepareCardContent, {
        textId,
        baseLanguages: ["en"],
        targetLanguages: ["es"],
      });
      const audioRows = await t.run(async (ctx) =>
        ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", "es"),
          )
          .collect(),
      );
      expect(audioRows).toHaveLength(1);
      const cached = await t.run(async (ctx) => ({
        asset: await ctx.db.get(assetId),
        blobUrl: await ctx.storage.getUrl(blobId),
      }));
      expect(cached.asset).not.toBeNull();
      expect(cached.blobUrl).not.toBeNull();
    });

    it("rejects a createCard approval, another user, and non-pending rows", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCard(t);
      // Plain createCard approval → replace unsupported.
      const plainId = await t.run(async (ctx) =>
        ctx.db.insert("cardApprovals", {
          threadId: "thread_1",
          messageId: "m1",
          toolCallId: "tc-plain",
          translations: [
            { language: "en", text: "Hello" },
            { language: "es", text: "Hola" },
          ],
          userId: "user_A",
          status: "pending",
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(
          api.features.chat.cardApprovals.replaceCardFromApproval,
          { approvalId: plainId, timezone: "UTC" },
        ),
      ).rejects.toThrow(/does not support/);

      const approvalId = await createApproval(t, cardId, [
        { language: "es", text: "Me gustaría un café." },
      ]);
      // Foreign user.
      const asOther = t.withIdentity({ subject: "user_B" });
      await expect(
        asOther.mutation(
          api.features.chat.cardApprovals.replaceCardFromApproval,
          { approvalId, timezone: "UTC" },
        ),
      ).rejects.toThrow();
      // Already processed.
      await t.run(async (ctx) =>
        ctx.db.patch(approvalId, { status: "rejected" }),
      );
      await expect(
        asUser.mutation(
          api.features.chat.cardApprovals.replaceCardFromApproval,
          { approvalId, timezone: "UTC" },
        ),
      ).rejects.toThrow(/already processed/);
    });
  });

  describe("getApprovalsByThread", () => {
    it("returns the alsoCorrect fields", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCard(t);
      await createApproval(
        t,
        cardId,
        [{ language: "es", text: "Me gustaría un café." }],
        { register: "formal" },
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.chat.cardApprovals.getApprovalsByThread,
        { threadId: "thread_1" },
      );
      expect(res).toHaveLength(1);
      expect(res[0].kind).toBe("alsoCorrect");
      expect(res[0].cardId).toBe(cardId);
      expect(res[0].changedLanguages).toEqual(["es"]);
      expect(res[0].proposedMetadata).toEqual({ register: "formal" });
    });
  });
});
