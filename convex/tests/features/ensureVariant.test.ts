/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";

import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { scheduleMissingContent } from "../../features/decks";
import { insertAudioFixture } from "../lib/audioFixtures";

const modules = import.meta.glob("../../**/*.ts");

/**
 * Ensure-variant sweep behavior (speaker-gender feature): the sweep ADDS the
 * missing gender variant for the effective gender and never deletes siblings
 * on gender grounds; the store collapses byte-identical variants to one
 * 'neutral' row; unmarked languages always stamp 'neutral'.
 */

async function seedPremade(
  t: TestConvex<typeof schema>,
  args?: {
    userCreated?: boolean;
    speakerGender?: string;
    esRow?: { text: string; speakerGender?: "male" | "female" | "neutral" };
    esAudioGender?: "male" | "female";
  },
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 0,
    });
    const textId = await ctx.db.insert("texts", {
      text: "I am tired.",
      language: "en",
      userCreated: args?.userCreated ?? false,
      speakerGender: args?.speakerGender ?? "male",
      audioSpeakerGender:
        args?.speakerGender === "female" ? "female" : "male",
      collectionId,
      collectionRank: 1,
      ipaText: "ipa-en",
      romanizedText: undefined,
    });
    if (args?.esRow) {
      await ctx.db.insert("translations", {
        textId,
        targetLanguage: "es",
        translatedText: args.esRow.text,
        translationSource: "google/gemini-3.1-flash-lite-none",
        ipaText: "ipa-es",
        ...(args.esRow.speakerGender
          ? { speakerGender: args.esRow.speakerGender }
          : {}),
      });
    }
    if (args?.esAudioGender) {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])]),
      );
      await insertAudioFixture(ctx, {
        textId,
        language: "es",
        voiceName: args.esAudioGender === "male" ? "Achird" : "Leda",
        voiceGender: args.esAudioGender,
        spokenText: args.esRow?.text ?? "x",
        storageId,
        ttsQuality: "validated",
        ttsProvider: "gemini",
        wordTimings: [{ word: "x", start: 0, end: 1 }],
      });
    }
    // Source-language audio so the en slot is quiet in the sweep.
    const enStorage = await ctx.storage.store(
      new Blob([new Uint8Array([9, 9, 9])]),
    );
    await insertAudioFixture(ctx, {
      textId,
      language: "en",
      voiceName: "Achird",
      voiceGender: args?.speakerGender === "female" ? "female" : "male",
      spokenText: "I am tired.",
      storageId: enStorage,
      ttsQuality: "validated",
      ttsProvider: "gemini",
      wordTimings: [{ word: "x", start: 0, end: 1 }],
    });
    return textId;
  });
}

async function sweep(
  t: TestConvex<typeof schema>,
  textId: Id<"texts">,
  pref?: "male" | "female" | "mixed",
) {
  return t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    return scheduleMissingContent(ctx, textId, text, ["en"], ["es"], {
      speakerGenderPreference: pref,
    });
  });
}

async function esRows(t: TestConvex<typeof schema>, textId: Id<"texts">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("translations")
      .withIndex("by_text_and_language", (q) =>
        q.eq("textId", textId).eq("targetLanguage", "es"),
      )
      .collect(),
  );
}

describe("ensure-variant sweep with a preference", () => {
  it("schedules the missing variant additively and leaves the sibling alone", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedPremade(t, {
      esRow: { text: "Estoy cansado.", speakerGender: "male" },
      esAudioGender: "male",
    });
    const result = await sweep(t, textId, "female");
    // The female slot was claimed for generation…
    expect(result.translationsScheduled).toBeGreaterThan(0);
    const claims = await t.run(async (ctx) =>
      ctx.db.query("llmTranslationClaims").collect(),
    );
    expect(claims.map((c) => c.speakerGender)).toContain("female");
    // …and the male variant (row + audio) is untouched.
    const rows = await esRows(t, textId);
    expect(rows).toHaveLength(1);
    expect(rows[0].speakerGender).toBe("male");
    const audioRows = await t.run(async (ctx) =>
      ctx.db
        .query("audioRecordings")
        .withIndex("by_text_and_language", (q) =>
          q.eq("textId", textId).eq("language", "es"),
        )
        .collect(),
    );
    expect(audioRows).toHaveLength(1);
  });

  it("a second sweep is quiet while the slot's claim is fresh", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedPremade(t, {
      esRow: { text: "Estoy cansado.", speakerGender: "male" },
      esAudioGender: "male",
    });
    await sweep(t, textId, "female");
    const again = await sweep(t, textId, "female");
    expect(again.translationsScheduled).toBe(0);
  });

  it("both variants present: zero-write steady state for BOTH preferences (probe)", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedPremade(t, {
      esRow: { text: "Estoy cansado.", speakerGender: "male" },
      esAudioGender: "male",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("translations", {
        textId,
        targetLanguage: "es",
        translatedText: "Estoy cansada.",
        translationSource: "google/gemini-3.1-flash-lite-none",
        speakerGender: "female",
        ipaText: "ipa-es-f",
      });
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([4, 5, 6])]),
      );
      await insertAudioFixture(ctx, {
        textId,
        language: "es",
        voiceName: "Leda",
        voiceGender: "female",
        spokenText: "Estoy cansada.",
        storageId,
        ttsQuality: "validated",
        ttsProvider: "gemini",
        wordTimings: [{ word: "x", start: 0, end: 1 }],
      });
      // Source audio for the female preference too.
      const enStorage = await ctx.storage.store(
        new Blob([new Uint8Array([7, 7, 7])]),
      );
      await insertAudioFixture(ctx, {
        textId,
        language: "en",
        voiceName: "Leda",
        voiceGender: "female",
        spokenText: "I am tired.",
        storageId: enStorage,
        ttsQuality: "validated",
        ttsProvider: "gemini",
        wordTimings: [{ word: "x", start: 0, end: 1 }],
      });
    });
    // Probe mode throws ProbeNeedsWork if ANY write would happen.
    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ["en"], ["es"], {
        probe: true,
        speakerGenderPreference: "male",
      });
      await scheduleMissingContent(ctx, textId, text, ["en"], ["es"], {
        probe: true,
        speakerGenderPreference: "female",
      });
    });
  });

  it("a pinned user-created card ignores the opposite preference entirely", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedPremade(t, {
      userCreated: true,
      speakerGender: "female", // morphology-definitive → pinned
      esRow: { text: "Estoy cansada.", speakerGender: "female" },
      esAudioGender: "female",
    });
    const result = await sweep(t, textId, "male");
    expect(result.translationsScheduled).toBe(0);
    expect(result.audioScheduled).toBe(0);
    const rows = await esRows(t, textId);
    expect(rows).toHaveLength(1);
    expect(rows[0].translatedText).toBe("Estoy cansada.");
  });
});

describe("storeTranslationAndScheduleTTS slot semantics", () => {
  it("collapses a byte-identical variant into a 'neutral' stamp instead of a duplicate row", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedPremade(t, {
      esRow: { text: "El gato duerme.", speakerGender: "male" },
    });
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: "es",
      translatedText: "El gato duerme.",
      voiceName: "Leda",
      speakerGender: "female",
      skipTts: true,
    });
    const rows = await esRows(t, textId);
    expect(rows).toHaveLength(1);
    expect(rows[0].speakerGender).toBe("neutral");
  });

  it("stores a genuinely different variant as a second slot row", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedPremade(t, {
      esRow: { text: "Estoy cansado.", speakerGender: "male" },
    });
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: "es",
      translatedText: "Estoy cansada.",
      voiceName: "Leda",
      speakerGender: "female",
      skipTts: true,
    });
    const rows = await esRows(t, textId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.speakerGender).sort()).toEqual([
      "female",
      "male",
    ]);
    expect(
      rows.find((r) => r.speakerGender === "female")?.translatedText,
    ).toBe("Estoy cansada.");
  });

  it("an unmarked language always stamps the 'neutral' slot", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedPremade(t, {});
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: "de",
      translatedText: "Ich bin müde.",
      voiceName: "Leda",
      speakerGender: "male",
      skipTts: true,
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("translations")
        .withIndex("by_text_and_language", (q) =>
          q.eq("textId", textId).eq("targetLanguage", "de"),
        )
        .unique(),
    );
    expect(row?.speakerGender).toBe("neutral");
  });

  it("a legacy unstamped row claims the canonical slot and gets stamped", async () => {
    const t = convexTest(schema, modules);
    // Canonical male text; legacy es row without a stamp.
    const textId = await seedPremade(t, {
      esRow: { text: "Estoy cansado." },
    });
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: "es",
      translatedText: "Estoy cansado.",
      voiceName: "Achird",
      speakerGender: "male",
      skipTts: true,
    });
    const rows = await esRows(t, textId);
    expect(rows).toHaveLength(1);
    expect(rows[0].speakerGender).toBe("male");
  });
});
