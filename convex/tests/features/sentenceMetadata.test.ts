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

import { convexTest } from "convex-test";
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
      });
      expect(result).toEqual({
        register: "formal",
        addresseeNumber: "singular",
        speakerGender: "female",
        addresseeGender: "male",
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
  });

  async function seedText(t: ReturnType<typeof convexTest>) {
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
  });
});
