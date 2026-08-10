/// <reference types="vite/client" />
import { vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "{}" })),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => () => ({}),
}));
// Stub the action-retrier so `retrier.run(ctx, fnRef, args)` delegates to
// `ctx.runAction` instead of the component.
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
import { internal } from "../../_generated/api";
import { validateSentenceMetadata } from "../../features/sentenceMetadata";

const modules = import.meta.glob("/convex/**/*.ts");

describe("features/sentenceMetadata", () => {
  describe("validateSentenceMetadata", () => {
    it("accepts a valid metadata object", () => {
      const result = validateSentenceMetadata({
        register: "formal",
        addresseeNumber: "singular",
        speakerGender: "female",
        addresseeGender: "male",
        addressesSomeone: true,
      });
      expect(result).toEqual({
        register: "formal",
        addresseeNumber: "singular",
        speakerGender: "female",
        addresseeGender: "male",
        addressesSomeone: true,
      });
    });

    it("rejects non-object inputs", () => {
      expect(() => validateSentenceMetadata(null)).toThrow();
      expect(() => validateSentenceMetadata("string")).toThrow();
    });

    it("rejects invalid field values", () => {
      expect(() =>
        validateSentenceMetadata({
          register: "casual",
          addresseeNumber: "singular",
          speakerGender: "neutral",
          addresseeGender: "neutral",
          addressesSomeone: true,
        }),
      ).toThrow();
    });

    it("rejects missing fields", () => {
      expect(() =>
        validateSentenceMetadata({
          register: "formal",
        }),
      ).toThrow();
    });

    it("rejects non-boolean addressesSomeone", () => {
      expect(() =>
        validateSentenceMetadata({
          register: "neutral",
          addresseeNumber: "not_applicable",
          speakerGender: "neutral",
          addresseeGender: "not_applicable",
          addressesSomeone: "true",
        }),
      ).toThrow();
    });
  });

  async function seedText(t: TestConvex<typeof schema>) {
    return t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "custom-user_A",
        textCount: 1,
      });
      const textId = await ctx.db.insert("texts", {
        text: "Hola",
        language: "es",
        userCreated: true,
        userId: "user_A",
        collectionId,
        collectionRank: 1,
      });
      return { textId };
    });
  }

  describe("fetchSentenceMetadata", () => {
    it("patches texts row with validated metadata from LLM", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      vi.mocked(generateText).mockResolvedValueOnce({
        text: JSON.stringify({
          register: "informal",
          addresseeNumber: "singular",
          speakerGender: "female",
          addresseeGender: "neutral",
        }),
      } as any);

      await t.action(internal.features.sentenceMetadata.fetchSentenceMetadata, {
        textId,
        translations: [{ language: "es", text: "Hola" }],
        schedulePrepareCard: false,
        baseLanguages: ["en"],
        targetLanguages: ["es"],
      });

      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.register).toBe("informal");
      expect(text?.speakerGender).toBe("female");
      // Definitive female speaker fixes audioSpeakerGender to female.
      expect(text?.audioSpeakerGender).toBe("female");
    });

    it("normalizes addresseeNumber 'neutral' to 'not_applicable'", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      vi.mocked(generateText).mockResolvedValueOnce({
        text: JSON.stringify({
          register: "neutral",
          addresseeNumber: "neutral",
          speakerGender: "neutral",
          addresseeGender: "not_applicable",
        }),
      } as any);

      await t.action(internal.features.sentenceMetadata.fetchSentenceMetadata, {
        textId,
        translations: [{ language: "es", text: "Está lloviendo" }],
        schedulePrepareCard: false,
        baseLanguages: ["en"],
        targetLanguages: ["es"],
      });

      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.addresseeNumber).toBe("not_applicable");
    });

    it("drops invalid fields and patches the valid ones without throwing", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      vi.mocked(generateText).mockResolvedValueOnce({
        text: JSON.stringify({
          register: "casual", // invalid — should be dropped
          addresseeNumber: "singular",
          speakerGender: "female",
          addresseeGender: "bogus", // invalid — should be dropped
        }),
      } as any);

      await t.action(internal.features.sentenceMetadata.fetchSentenceMetadata, {
        textId,
        translations: [{ language: "es", text: "Estoy cansada" }],
        schedulePrepareCard: false,
        baseLanguages: ["en"],
        targetLanguages: ["es"],
      });

      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.register).toBeUndefined();
      expect(text?.addresseeGender).toBeUndefined();
      expect(text?.addresseeNumber).toBe("singular");
      expect(text?.speakerGender).toBe("female");
      // Definitive female speaker still fixes audioSpeakerGender.
      expect(text?.audioSpeakerGender).toBe("female");
    });

    it("does not throw on unparseable LLM output", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      vi.mocked(generateText).mockResolvedValueOnce({
        text: "sorry, I cannot produce JSON right now",
      } as any);

      await expect(
        t.action(internal.features.sentenceMetadata.fetchSentenceMetadata, {
          textId,
          translations: [{ language: "es", text: "Hola" }],
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        }),
      ).resolves.toBeNull();

      const text = await t.run(async (ctx) => ctx.db.get(textId));
      // No metadata fields set, but audioSpeakerGender was still coin-flipped.
      expect(text?.register).toBeUndefined();
      expect(text?.addresseeNumber).toBeUndefined();
      expect(text?.speakerGender).toBeUndefined();
      expect(text?.addresseeGender).toBeUndefined();
      expect(
        text?.audioSpeakerGender === "male" ||
          text?.audioSpeakerGender === "female",
      ).toBe(true);
    });

    it("rethrows LLM infrastructure failures so the retrier still sees them", async () => {
      // The exception-attribution wrapper must capture-and-rethrow, not
      // swallow — a swallowed error would defeat retrier backoff.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      vi.mocked(generateText).mockRejectedValueOnce(new Error("network down"));

      await expect(
        t.action(internal.features.sentenceMetadata.fetchSentenceMetadata, {
          textId,
          translations: [{ language: "es", text: "Hola" }],
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
          userId: "user_A",
        }),
      ).rejects.toThrow("network down");
    });
  });

  describe("generateSentenceMetadata", () => {
    it("orchestrates unblock + retried LLM fetch", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      vi.mocked(generateText).mockResolvedValueOnce({
        text: JSON.stringify({
          register: "neutral",
          addresseeNumber: "not_applicable",
          speakerGender: "neutral",
          addresseeGender: "not_applicable",
        }),
      } as any);

      await t.action(
        internal.features.sentenceMetadata.generateSentenceMetadata,
        {
          textId,
          translations: [{ language: "es", text: "Hola" }],
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );

      const text = await t.run(async (ctx) => ctx.db.get(textId));
      // Metadata was applied through the retrier path.
      expect(text?.register).toBe("neutral");
      // audioSpeakerGender was coin-flipped on the first pass and preserved
      // since the LLM returned a non-definitive "neutral" speakerGender.
      expect(text?.audioSpeakerGender === "male" || text?.audioSpeakerGender === "female").toBe(true);
    });

    it("accepts translation entries carrying provenance fields (regression)", async () => {
      // Producers (`createCustomText`, chat approval) forward entries that
      // can carry `translationSource` / `regionVariant`. The job validator
      // used to allow only `{language, text}` and threw an
      // ArgumentValidationError at execution time — silently, since the
      // scheduling mutation had already returned success.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      vi.mocked(generateText).mockResolvedValueOnce({ text: "{}" } as any);

      await t.action(
        internal.features.sentenceMetadata.generateSentenceMetadata,
        {
          textId,
          translations: [
            {
              language: "es",
              text: "Hola",
              translationSource: "user-provided",
              regionVariant: "es-US",
            },
            {
              language: "en",
              text: "Hello",
              translationSource: "openrouter/some-model-none",
            },
          ],
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
          userId: "user_A",
        },
      );

      // The metadata step ran instead of dying on args validation: the card
      // was unblocked with a coin-flipped voice gender.
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(["male", "female"]).toContain(text?.audioSpeakerGender);
    });
  });

  describe("applyMetadataAndPrepareCard", () => {
    it("patches audioSpeakerGender from metadata", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: {
            register: "formal",
            addresseeNumber: "singular",
            speakerGender: "male",
            addresseeGender: "neutral",
          },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.audioSpeakerGender).toBe("male");
      expect(text?.register).toBe("formal");
      expect(text?.speakerGender).toBe("male");
    });

    it("coin-flips referentGender on every call when missing", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: undefined,
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(["male", "female"]).toContain(text?.referentGender);
    });

    it("does not re-roll referentGender once committed", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      // First call commits a value.
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: undefined,
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const after1 = await t.run(async (ctx) => ctx.db.get(textId));
      const firstReferent = after1?.referentGender;
      // Run again — must not change.
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: undefined,
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const after2 = await t.run(async (ctx) => ctx.db.get(textId));
      expect(after2?.referentGender).toBe(firstReferent);
    });

    it("coin-flips addresseeGender when addressesSomeone=true and LLM says neutral", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: {
            register: "informal",
            addresseeNumber: "singular",
            speakerGender: "neutral",
            addresseeGender: "neutral",
            addressesSomeone: true,
          },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.addressesSomeone).toBe(true);
      expect(["male", "female"]).toContain(text?.addresseeGender);
    });

    it("does NOT coin-flip addresseeGender when addressesSomeone=false", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: {
            register: "neutral",
            addresseeNumber: "not_applicable",
            speakerGender: "neutral",
            addresseeGender: "not_applicable",
            addressesSomeone: false,
          },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.addressesSomeone).toBe(false);
      // Descriptive sentences: addresseeGender retains the LLM's literal value;
      // no coin-flip happens.
      expect(text?.addresseeGender).toBe("not_applicable");
    });

    it("preserves a previously-committed addresseeGender on second call", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      // First call commits male/female via coin-flip.
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: {
            register: "informal",
            addresseeNumber: "singular",
            speakerGender: "neutral",
            addresseeGender: "neutral",
            addressesSomeone: true,
          },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const after1 = await t.run(async (ctx) => ctx.db.get(textId));
      const first = after1?.addresseeGender;
      expect(["male", "female"]).toContain(first);

      // Second call with the same neutral incoming value — must NOT re-roll.
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: {
            register: "informal",
            addresseeNumber: "singular",
            speakerGender: "neutral",
            addresseeGender: "neutral",
            addressesSomeone: true,
          },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const after2 = await t.run(async (ctx) => ctx.db.get(textId));
      expect(after2?.addresseeGender).toBe(first);
    });

    // Chat approval and custom-text creation insert their translations before
    // any gender exists, leaving them unstamped — indistinguishable from the
    // pre-field "legacy" rows the gender-drift sweep treats as suspect. The
    // metadata step now finishes the record.
    it("stamps the resolved gender onto translations inserted before it ran", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const translationId = await t.run(async (ctx) =>
        ctx.db.insert("translations", {
          textId,
          targetLanguage: "en",
          translatedText: "Hello",
          translationSource: "openai/gpt-5-chat-none",
        }),
      );

      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: {
            register: "neutral",
            addresseeNumber: "singular",
            speakerGender: "female",
            addresseeGender: "neutral",
          },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.speakerGender).toBe("female");
    });

    // The retrier's second call can land a definitive gender that overturns
    // the first call's coin flip. Text and translations must move together —
    // otherwise the stamp would turn a "legacy" row into a "drifted" one.
    it("re-stamps translations when a later definitive gender overturns the coin flip", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const translationId = await t.run(async (ctx) =>
        ctx.db.insert("translations", {
          textId,
          targetLanguage: "en",
          translatedText: "Hello",
          translationSource: "openai/gpt-5-chat-none",
        }),
      );

      // Call 1: the unblock pass, no metadata → coin-flipped gender.
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: undefined,
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );

      // Call 2: metadata lands a definitive gender.
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: {
            register: "neutral",
            addresseeNumber: "singular",
            speakerGender: "male",
            addresseeGender: "neutral",
          },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );

      const text = await t.run(async (ctx) => ctx.db.get(textId));
      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(text?.audioSpeakerGender).toBe("male");
      expect(row?.speakerGender).toBe("male");
    });

    // Every caller of this mutation creates user-created cards, so the premade
    // case is unreachable today — but stamping there would be silently wrong,
    // not merely useless. An unstamped row on a premade text is genuinely
    // "legacy" (written before the field existed, plausibly under the other
    // gender); marking it as agreeing with the newly-resolved gender clears
    // both `isLegacy` and `isDrifted`, which suppresses the
    // `isLegacyAlongsideDriftedAudio` heal path in `scheduleMissingContent`
    // and leaves wrong-grammar text paired with re-voiced audio.
    it("leaves translations on a premade text unstamped", async () => {
      const t = convexTest(schema, modules);
      const { textId, translationId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 1,
        });
        const premadeTextId = await ctx.db.insert("texts", {
          text: "Hola",
          language: "es",
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        return {
          textId: premadeTextId,
          translationId: await ctx.db.insert("translations", {
            textId: premadeTextId,
            targetLanguage: "en",
            translatedText: "Hello",
            translationSource: "google/gemini-3.1-flash-lite-high",
          }),
        };
      });

      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: {
            register: "neutral",
            addresseeNumber: "singular",
            speakerGender: "female",
            addresseeGender: "neutral",
          },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );

      const text = await t.run(async (ctx) => ctx.db.get(textId));
      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      // The text still records the resolved gender — only the translation
      // stamp is withheld.
      expect(text?.audioSpeakerGender).toBe("female");
      expect(row?.speakerGender).toBeUndefined();
    });
  });
});
