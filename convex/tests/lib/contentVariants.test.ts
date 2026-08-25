/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";

import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";
import {
  buildTextContentBatchForLanguages,
  buildCardSearchableText,
} from "../../lib/cardContent";
import { getDisplayTranslation } from "../../lib/contentVariants";
import { resolveAudioSpeakerGender } from "../../../lib/voices";
import { insertAudioFixture } from "./audioFixtures";

const modules = import.meta.glob("../../**/*.ts");
void modules;

/**
 * Seed an English-pivot text with TWO gender-variant Spanish translation
 * rows (male + female stamped) and one audio pointer per gender, each
 * speaking its own variant's text. The multi-row world every read must
 * tolerate since the speaker-gender feature.
 */
async function seedVariantCard(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 0,
    });
    const textId = await ctx.db.insert("texts", {
      text: "I am tired.",
      language: "en",
      userCreated: false,
      collectionId,
      collectionRank: 1,
      speakerGender: "neutral",
      audioSpeakerGender: "male",
      ipaText: "ipa-en",
    });
    await ctx.db.insert("translations", {
      textId,
      targetLanguage: "es",
      translatedText: "Estoy cansado.",
      speakerGender: "male",
      ipaText: "ipa-es-m",
    });
    await ctx.db.insert("translations", {
      textId,
      targetLanguage: "es",
      translatedText: "Estoy cansada.",
      speakerGender: "female",
      ipaText: "ipa-es-f",
    });
    for (const [gender, spokenText] of [
      ["male", "Estoy cansado."],
      ["female", "Estoy cansada."],
    ] as const) {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])]),
      );
      await insertAudioFixture(ctx, {
        textId,
        language: "es",
        storageId,
        spokenText,
        voiceGender: gender,
        voiceName: gender === "male" ? "Achird" : "Leda",
        ttsQuality: "validated",
        wordTimings: [{ word: "x", start: 0, end: 1 }],
      });
    }
    const enStorage = await ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])]),
    );
    await insertAudioFixture(ctx, {
      textId,
      language: "en",
      storageId: enStorage,
      spokenText: "I am tired.",
      voiceGender: "male",
      ttsQuality: "validated",
      wordTimings: [{ word: "x", start: 0, end: 1 }],
    });
    return textId;
  });
}

async function serve(
  t: TestConvex<typeof schema>,
  textId: Id<"texts">,
  speakerGenderPreference?: "male" | "female" | "mixed",
) {
  return t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    const map = await buildTextContentBatchForLanguages(
      ctx,
      [
        {
          key: "k",
          textId,
          sourceText: text.text,
          sourceLanguage: text.language,
          sourceIpa: text.ipaText ?? undefined,
          userCreated: text.userCreated,
          speakerGender: text.speakerGender,
          audioSpeakerGender: text.audioSpeakerGender,
        },
      ],
      ["en"],
      ["es"],
      { speakerGenderPreference },
    );
    return map.get("k")!;
  });
}

describe("variant-tolerant serve (two gender rows per language)", () => {
  it("serves the canonical variant with no preference and never throws", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedVariantCard(t);
    const content = await serve(t, textId);
    const es = content.translations.find((tr) => tr.language === "es")!;
    // Canonical assignment on the text is male.
    expect(es.text).toBe("Estoy cansado.");
    const esAudio = content.audioRecordings.find((a) => a.language === "es")!;
    expect(esAudio.voiceName).toBe("Achird");
    expect(content.hasMissingContent).toBe(false);
  });

  it("serves the preference's variant with text-paired audio", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedVariantCard(t);
    const content = await serve(t, textId, "female");
    const es = content.translations.find((tr) => tr.language === "es")!;
    expect(es.text).toBe("Estoy cansada.");
    expect(es.ipa).toBe("ipa-es-f");
    const esAudio = content.audioRecordings.find((a) => a.language === "es")!;
    expect(esAudio.voiceName).toBe("Leda");
    // Source-language (unmarked en) audio: single male row serves as
    // fallback even under a female preference (progressive fallback — the
    // female variant would be ensured by the sweep, never blank here).
    const enAudio = content.audioRecordings.find((a) => a.language === "en")!;
    expect(enAudio.url).not.toBeNull();
  });

  it("mixed preference equals no preference", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedVariantCard(t);
    const mixed = await serve(t, textId, "mixed");
    const none = await serve(t, textId);
    expect(mixed.translations).toEqual(none.translations);
  });

  it("definitive text gender pins the served variant against the preference", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedVariantCard(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(textId, {
        speakerGender: "female",
        audioSpeakerGender: "female",
      });
    });
    const content = await serve(t, textId, "male");
    const es = content.translations.find((tr) => tr.language === "es")!;
    expect(es.text).toBe("Estoy cansada.");
  });

  it("searchable text contains BOTH variants, languages deduped", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedVariantCard(t);
    const built = await t.run((ctx) =>
      buildCardSearchableText(ctx, textId, "I am tired.", ["en", "es"]),
    );
    expect(built.searchableText).toContain("cansado");
    expect(built.searchableText).toContain("cansada");
    expect(built.searchableTextLanguages).toEqual(["es"]);
  });
});

describe("getDisplayTranslation", () => {
  it("prefers neutral, then legacy-unstamped, then any", async () => {
    const t = convexTest(schema, modules);
    const textId = await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "A1",
        textCount: 0,
      });
      const id = await ctx.db.insert("texts", {
        text: "s",
        language: "en",
        userCreated: false,
        collectionId,
        collectionRank: 1,
      });
      await ctx.db.insert("translations", {
        textId: id,
        targetLanguage: "es",
        translatedText: "male-row",
        speakerGender: "male",
      });
      await ctx.db.insert("translations", {
        textId: id,
        targetLanguage: "es",
        translatedText: "legacy-row",
      });
      await ctx.db.insert("translations", {
        textId: id,
        targetLanguage: "es",
        translatedText: "neutral-row",
        speakerGender: "neutral",
      });
      return id;
    });
    const row = await t.run((ctx) => getDisplayTranslation(ctx, textId, "es"));
    expect(row?.translatedText).toBe("neutral-row");
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("translations")
        .withIndex("by_text_and_language", (q) =>
          q.eq("textId", textId).eq("targetLanguage", "es"),
        )
        .collect();
      await ctx.db.delete(rows.find((r) => r.speakerGender === "neutral")!._id);
    });
    const row2 = await t.run((ctx) => getDisplayTranslation(ctx, textId, "es"));
    expect(row2?.translatedText).toBe("legacy-row");
  });
});

describe("canonical fallback determinism", () => {
  it("a text with no stored genders resolves via the seeded flip", async () => {
    const t = convexTest(schema, modules);
    const textId = await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "A1",
        textCount: 0,
      });
      const id = await ctx.db.insert("texts", {
        text: "s",
        language: "en",
        userCreated: false,
        collectionId,
        collectionRank: 1,
      });
      const flip = resolveAudioSpeakerGender(undefined, id);
      await ctx.db.insert("translations", {
        textId: id,
        targetLanguage: "es",
        translatedText: `flip-${flip}`,
        speakerGender: flip,
      });
      const other = flip === "male" ? "female" : "male";
      await ctx.db.insert("translations", {
        textId: id,
        targetLanguage: "es",
        translatedText: `flip-${other}`,
        speakerGender: other,
      });
      return id;
    });
    const content = await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      const map = await buildTextContentBatchForLanguages(
        ctx,
        [
          {
            key: "k",
            textId,
            sourceText: text.text,
            sourceLanguage: "en",
            userCreated: false,
          },
        ],
        ["en"],
        ["es"],
      );
      return map.get("k")!;
    });
    const es = content.translations.find((tr) => tr.language === "es")!;
    const expected = await t.run(async () =>
      resolveAudioSpeakerGender(undefined, textId),
    );
    expect(es.text).toBe(`flip-${expected}`);
  });
});
