/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getFunctionName } from "convex/server";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
// Module-mocked globally (tests/convexTestSetup.ts): enqueues resolve to
// unique fake workIds so claim stamping and job args are assertable.
import { llmPool, ttsPool } from "@/convex/lib/workpools";
import { scheduleMissingContent } from "../../features/decks";
import { buildTextContentBatchForLanguages } from "../../lib/cardContent";
import { getTtsProviderForLanguage } from "@/lib/languages";
import { drainSchedulerAfterEach } from "../lib/drainScheduler";

const modules = import.meta.glob("/convex/**/*.ts");

const mockLlmEnqueue = vi.mocked(llmPool.enqueueAction);
const mockTtsEnqueue = vi.mocked(ttsPool.enqueueAction);

drainSchedulerAfterEach();

beforeEach(() => {
  mockLlmEnqueue.mockClear();
  mockTtsEnqueue.mockClear();
});

const WORD_TIMINGS = [{ word: "x", start: 0, end: 0.5 }];

/**
 * Seed one premade English text (stored gender male) with COMPLETE base
 * content for the given target languages, so a subsequent sweep has no base
 * work left and only the preference-overlay section can produce writes.
 */
async function seedPremadeText(
  t: TestConvex<typeof schema>,
  opts: {
    sourceText?: string;
    targets: { language: string; text: string }[];
  },
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 1,
    });
    const textId = await ctx.db.insert("texts", {
      text: opts.sourceText ?? "I am tired.",
      language: "en",
      userCreated: false,
      collectionId,
      collectionRank: 1,
      addressesSomeone: false,
      speakerGender: "male",
      audioSpeakerGender: "male",
      referentGender: "female",
      register: "neutral",
      addresseeNumber: "not_applicable",
      // Sentinel: attempted, failed — keeps the annotation sweep quiet.
      ipaText: "",
      ipaSource: "test",
    });

    const storeAudio = async (language: string, spokenText: string) => {
      const storageId = await ctx.storage.store(new Blob(["fake-audio"]));
      const assetId = await ctx.db.insert("audioAssets", {
        language,
        voiceGender: "male",
        spokenTextHash: await sha256HexAsync(spokenText),
        spokenText,
        storageId,
        voiceName: "test-voice-m",
        ttsProvider: getTtsProviderForLanguage(language),
        ttsQuality: "validated",
        speed: 1,
        wordTimings: WORD_TIMINGS,
      });
      await ctx.db.insert("audioRecordings", { textId, language, assetId });
    };

    await storeAudio("en", opts.sourceText ?? "I am tired.");
    for (const target of opts.targets) {
      await ctx.db.insert("translations", {
        textId,
        targetLanguage: target.language,
        translatedText: target.text,
        translationSource: "test-model-none",
        speakerGender: "male",
        ipaText: "",
        ipaSource: "test",
      });
      await storeAudio(target.language, target.text);
    }
    return { textId };
  });
}

// The production sha256Hex is sync (convex/lib/sha256). Import it lazily so
// the seed helper above can live outside t.run closures cleanly.
async function sha256HexAsync(text: string): Promise<string> {
  const { sha256Hex } = await import("../../lib/sha256");
  return sha256Hex(text);
}

async function seedUserSettings(
  t: TestConvex<typeof schema>,
  userId: string,
  preference?: "male" | "female" | "mixed",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("userSettings", {
      userId,
      hasCompletedOnboarding: true,
      speakerGenderPreference: preference,
    });
  });
}

const getVariant = (
  t: TestConvex<typeof schema>,
  textId: Id<"texts">,
  targetLanguage: string,
  gender: "male" | "female",
) =>
  t.run(async (ctx) =>
    ctx.db
      .query("translationVariants")
      .withIndex("by_text_language_and_gender", (q) =>
        q
          .eq("textId", textId)
          .eq("targetLanguage", targetLanguage)
          .eq("speakerGender", gender),
      )
      .first(),
  );

describe("speaker-gender preference", () => {
  describe("setSpeakerGenderPreference", () => {
    it("creates the settings row when none exists and round-trips through getUserSettings", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.setSpeakerGenderPreference, {
        preference: "female",
      });
      const settings = await asUser.query(api.features.courses.getUserSettings, {});
      expect(settings?.speakerGenderPreference).toBe("female");
      expect(settings?.hasCompletedOnboarding).toBe(false);
    });

    it("patches an existing settings row, including back to 'mixed'", async () => {
      const t = convexTest(schema, modules);
      await seedUserSettings(t, "user_A", "male");
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.courses.setSpeakerGenderPreference, {
        preference: "mixed",
      });
      const settings = await asUser.query(api.features.courses.getUserSettings, {});
      expect(settings?.speakerGenderPreference).toBe("mixed");
      expect(settings?.hasCompletedOnboarding).toBe(true);
    });
  });

  describe("applyMetadataAndPrepareCard gender resolution", () => {
    async function seedCustomText(t: TestConvex<typeof schema>) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "Custom",
          textCount: 1,
          origin: "custom",
        });
        const textId = await ctx.db.insert("texts", {
          text: "Estoy cansada.",
          language: "es",
          userCreated: true,
          userId: "user_A",
          collectionId,
          collectionRank: 1,
        });
        return { textId };
      });
    }

    it("uses the owner's preference when the LLM verdict is not definitive", async () => {
      const t = convexTest(schema, modules);
      await seedUserSettings(t, "user_A", "male");
      const { textId } = await seedCustomText(t);
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: { speakerGender: "neutral", addressesSomeone: false },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.audioSpeakerGender).toBe("male");
      // The linguistic verdict itself is preserved, not overwritten.
      expect(text?.speakerGender).toBe("neutral");
    });

    it("a definitive LLM verdict always beats the preference (inherently gendered uploads keep their voice)", async () => {
      const t = convexTest(schema, modules);
      await seedUserSettings(t, "user_A", "male");
      const { textId } = await seedCustomText(t);
      await t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: { speakerGender: "female", addressesSomeone: false },
          schedulePrepareCard: false,
          baseLanguages: ["en"],
          targetLanguages: ["es"],
        },
      );
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text?.audioSpeakerGender).toBe("female");
      expect(text?.speakerGender).toBe("female");
    });
  });

  describe("scheduleMissingContent overlay", () => {
    const runSweep = (
      t: TestConvex<typeof schema>,
      textId: Id<"texts">,
      preference: "male" | "female" | "mixed",
      targetLanguages: string[],
    ) =>
      t.run(async (ctx) => {
        const text = await ctx.db.get(textId);
        return scheduleMissingContent(
          ctx as any,
          textId,
          text!,
          ["en"],
          targetLanguages,
          { speakerGenderPreference: preference },
        );
      });

    it("claims a gendered variant for marking languages and asset-only audio for the rest", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPremadeText(t, {
        targets: [
          { language: "es", text: "Estoy cansado." },
          { language: "tr", text: "Yorgunum." },
        ],
      });

      await runSweep(t, textId, "female", ["es", "tr"]);

      // Spanish (marking, first-person source): a pending variant row was
      // claimed and the shared worker enqueued in variant mode.
      const variant = await getVariant(t, textId, "es", "female");
      expect(variant).not.toBeNull();
      expect(variant?.translatedText).toBeUndefined();
      expect(variant?.claimedAt).toBeDefined();
      expect(variant?.workId).toMatch(/^test-llm-work-/);
      const llmCalls = mockLlmEnqueue.mock.calls;
      expect(llmCalls).toHaveLength(1);
      expect(getFunctionName(llmCalls[0][1] as any)).toBe(
        getFunctionName(
          internal.features.llmTranslationQueue.processLlmTranslationForCard,
        ),
      );
      expect(llmCalls[0][2]).toMatchObject({
        targetLanguage: "es",
        variantGender: "female",
        audioSpeakerGender: "female",
      });

      // Turkish (non-marking) and the English source: asset-only synthesis
      // at the preferred gender, never touching the pointer rows.
      const ttsLangs = mockTtsEnqueue.mock.calls.map(
        (c) => (c[2] as any).language,
      );
      expect(ttsLangs.sort()).toEqual(["en", "tr"]);
      for (const call of mockTtsEnqueue.mock.calls) {
        const jobArgs = call[2] as any;
        expect(jobArgs.assetOnly).toBe(true);
        expect(jobArgs.voiceGender).toBe("female");
      }
      // No variant audio yet — the variant translation hasn't landed.
      expect(ttsLangs).not.toContain("es");
    });

    it("does nothing when the preference matches the stored gender, is 'mixed', or the text is user-created", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPremadeText(t, {
        targets: [{ language: "es", text: "Estoy cansado." }],
      });

      await runSweep(t, textId, "male", ["es"]); // matches stored gender
      await runSweep(t, textId, "mixed", ["es"]);
      expect(mockLlmEnqueue).not.toHaveBeenCalled();
      expect(mockTtsEnqueue).not.toHaveBeenCalled();
      expect(await getVariant(t, textId, "es", "male")).toBeNull();
      expect(await getVariant(t, textId, "es", "female")).toBeNull();

      await t.run(async (ctx) => {
        await ctx.db.patch(textId, { userCreated: true, userId: "user_A" });
      });
      await runSweep(t, textId, "female", ["es"]);
      expect(mockLlmEnqueue).not.toHaveBeenCalled();
      expect(mockTtsEnqueue).not.toHaveBeenCalled();
    });

    it("skips the variant for non-first-person sentences but still fills preferred audio", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPremadeText(t, {
        sourceText: "The sky is blue.",
        targets: [{ language: "es", text: "El cielo es azul." }],
      });

      await runSweep(t, textId, "female", ["es"]);

      expect(await getVariant(t, textId, "es", "female")).toBeNull();
      expect(mockLlmEnqueue).not.toHaveBeenCalled();
      const ttsLangs = mockTtsEnqueue.mock.calls.map(
        (c) => (c[2] as any).language,
      );
      expect(ttsLangs.sort()).toEqual(["en", "es"]);
    });
  });

  describe("storeTranslationVariantAndScheduleTTS", () => {
    it("stores the variant, releases its claim, and chains asset-only TTS at the variant gender", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPremadeText(t, {
        targets: [{ language: "es", text: "Estoy cansado." }],
      });
      const variantId = await t.run(async (ctx) =>
        ctx.db.insert("translationVariants", {
          textId,
          targetLanguage: "es",
          speakerGender: "female",
          claimedAt: Date.now(),
          workId: "test-llm-work-manual",
        }),
      );

      await t.mutation(
        internal.features.decks.storeTranslationVariantAndScheduleTTS,
        {
          variantId,
          translatedText: "Estoy cansada.",
          voiceName: "Leda",
          translationSource: "test-model-none",
        },
      );

      const variant = await t.run(async (ctx) => ctx.db.get(variantId));
      expect(variant?.translatedText).toBe("Estoy cansada.");
      expect(variant?.claimedAt).toBeUndefined();
      expect(variant?.workId).toBeUndefined();
      expect(variant?.translationVersion).toBeDefined();

      expect(mockTtsEnqueue).toHaveBeenCalledTimes(1);
      const jobArgs = mockTtsEnqueue.mock.calls[0][2] as any;
      expect(jobArgs).toMatchObject({
        language: "es",
        text: "Estoy cansada.",
        assetOnly: true,
        voiceGender: "female",
      });
      // The base translations/audio pointers were not touched.
      const baseRow = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "es"),
          )
          .first(),
      );
      expect(baseRow?.translatedText).toBe("Estoy cansado.");
    });
  });

  describe("storeAudioRecording assetOnly", () => {
    it("writes the asset without creating or repointing the (textId, language) pointer", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPremadeText(t, {
        targets: [{ language: "es", text: "Estoy cansado." }],
      });
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(["variant-audio"])),
      );
      await t.mutation(internal.features.decks.storeAudioRecording, {
        textId,
        language: "es",
        voiceName: "test-voice-f",
        storageId,
        ttsQuality: "validated",
        ttsProvider: getTtsProviderForLanguage("es"),
        voiceGender: "female",
        speed: 1,
        spokenText: "Estoy cansada.",
        assetOnly: true,
      });

      const { asset, pointers } = await t.run(async (ctx) => {
        const hash = await sha256HexAsync("Estoy cansada.");
        const asset = await ctx.db
          .query("audioAssets")
          .withIndex("by_key", (q) =>
            q
              .eq("language", "es")
              .eq("voiceGender", "female")
              .eq("regionVariant", undefined)
              .eq("spokenTextHash", hash),
          )
          .first();
        const pointers = await ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", "es"),
          )
          .collect();
        return { asset, pointers };
      });
      expect(asset).not.toBeNull();
      // Only the seeded male-audio pointer exists; nothing points at the
      // female overlay asset.
      expect(pointers).toHaveLength(1);
      expect(pointers[0].assetId).not.toBe(asset!._id);
    });
  });

  describe("reader overlay (buildTextContentBatchForLanguages)", () => {
    const buildContent = (
      t: TestConvex<typeof schema>,
      textId: Id<"texts">,
      preference: "male" | "female" | "mixed",
    ) =>
      t.run(async (ctx) => {
        const text = await ctx.db.get(textId);
        const map = await buildTextContentBatchForLanguages(
          ctx as any,
          [
            {
              key: "0",
              textId,
              sourceText: text!.text,
              sourceLanguage: text!.language,
              sourceIpa: text!.ipaText ?? undefined,
              userCreated: text!.userCreated,
              audioSpeakerGender: text!.audioSpeakerGender ?? undefined,
            },
          ],
          ["en"],
          ["es"],
          { speakerGenderPreference: preference },
        );
        return map.get("0")!;
      });

    async function seedReadyVariantWithAudio(
      t: TestConvex<typeof schema>,
      textId: Id<"texts">,
      opts?: { withSourceOverlayAudio?: boolean },
    ) {
      await t.run(async (ctx) => {
        await ctx.db.insert("translationVariants", {
          textId,
          targetLanguage: "es",
          speakerGender: "female",
          translatedText: "Estoy cansada.",
          translationSource: "test-model-none",
          ipaText: "",
          ipaSource: "test",
        });
        const storeFemaleAsset = async (language: string, spokenText: string) => {
          const storageId = await ctx.storage.store(new Blob(["overlay-audio"]));
          await ctx.db.insert("audioAssets", {
            language,
            voiceGender: "female",
            spokenTextHash: await sha256HexAsync(spokenText),
            spokenText,
            storageId,
            voiceName: "test-voice-f",
            ttsProvider: getTtsProviderForLanguage(language),
            ttsQuality: "validated",
            speed: 1,
            wordTimings: WORD_TIMINGS,
          });
        };
        await storeFemaleAsset("es", "Estoy cansada.");
        if (opts?.withSourceOverlayAudio !== false) {
          const text = await ctx.db.get(textId);
          await storeFemaleAsset("en", text!.text);
        }
      });
    }

    it("serves the variant wording and preferred-gender audio once both exist", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPremadeText(t, {
        targets: [{ language: "es", text: "Estoy cansado." }],
      });
      await seedReadyVariantWithAudio(t, textId);

      const content = await buildContent(t, textId, "female");
      const es = content.translations.find((tr) => tr.language === "es");
      expect(es?.text).toBe("Estoy cansada.");
      const esAudio = content.audioRecordings.find((a) => a.language === "es");
      expect(esAudio?.voiceName).toBe("test-voice-f");
      expect(esAudio?.url).toBeTruthy();
      const enAudio = content.audioRecordings.find((a) => a.language === "en");
      expect(enAudio?.voiceName).toBe("test-voice-f");
      expect(content.hasMissingContent).toBe(false);
    });

    it("falls back to the base row (and flags missing content) while the variant generates", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPremadeText(t, {
        targets: [{ language: "es", text: "Estoy cansado." }],
      });

      const content = await buildContent(t, textId, "female");
      const es = content.translations.find((tr) => tr.language === "es");
      expect(es?.text).toBe("Estoy cansado.");
      const esAudio = content.audioRecordings.find((a) => a.language === "es");
      expect(esAudio?.voiceName).toBe("test-voice-m");
      expect(content.hasMissingContent).toBe(true);
    });

    it("never mixes the variant wording with base-gender audio (atomic swap)", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPremadeText(t, {
        targets: [{ language: "es", text: "Estoy cansado." }],
      });
      // Variant text ready, but its female audio asset does NOT exist yet.
      await t.run(async (ctx) => {
        await ctx.db.insert("translationVariants", {
          textId,
          targetLanguage: "es",
          speakerGender: "female",
          translatedText: "Estoy cansada.",
          ipaText: "",
          ipaSource: "test",
        });
      });

      const content = await buildContent(t, textId, "female");
      const es = content.translations.find((tr) => tr.language === "es");
      expect(es?.text).toBe("Estoy cansado.");
      const esAudio = content.audioRecordings.find((a) => a.language === "es");
      expect(esAudio?.voiceName).toBe("test-voice-m");
      expect(content.hasMissingContent).toBe(true);
    });

    it("'mixed' serves the base content untouched", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPremadeText(t, {
        targets: [{ language: "es", text: "Estoy cansado." }],
      });
      await seedReadyVariantWithAudio(t, textId);

      const content = await buildContent(t, textId, "mixed");
      const es = content.translations.find((tr) => tr.language === "es");
      expect(es?.text).toBe("Estoy cansado.");
      const esAudio = content.audioRecordings.find((a) => a.language === "es");
      expect(esAudio?.voiceName).toBe("test-voice-m");
      expect(content.hasMissingContent).toBe(false);
    });
  });
});
