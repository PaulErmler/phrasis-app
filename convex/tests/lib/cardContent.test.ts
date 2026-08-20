/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";

import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";
import { buildTextContentBatchForLanguages } from "../../lib/cardContent";
import { insertAudioFixture } from "./audioFixtures";

const modules = import.meta.glob("../../**/*.ts");

const TIMINGS = [{ word: "x", start: 0, end: 1 }];

/**
 * Seed a fully-populated card so `hasMissingContent` is driven ONLY by the
 * field under test: a text, one translation per non-source language, and an
 * audio row per language (with word timings, so the timings check is quiet
 * unless a test deliberately drops them).
 */
async function seedCard(
  t: TestConvex<typeof schema>,
  args: {
    sourceLanguage: string;
    /** Undefined = never attempted, '' = tried-and-failed sentinel. */
    sourceRomanizedText?: string;
    translations: Array<{
      language: string;
      romanizedText?: string;
    }>;
    /** Languages whose audio row should carry no word timings. */
    languagesWithoutTimings?: string[];
  },
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 0,
    });
    const textId = await ctx.db.insert("texts", {
      text: "source text",
      language: args.sourceLanguage,
      userCreated: false,
      collectionId,
      collectionRank: 1,
      ...(args.sourceRomanizedText !== undefined
        ? { romanizedText: args.sourceRomanizedText }
        : {}),
    });

    for (const tr of args.translations) {
      await ctx.db.insert("translations", {
        textId,
        targetLanguage: tr.language,
        translatedText: `translated-${tr.language}`,
        ...(tr.romanizedText !== undefined
          ? { romanizedText: tr.romanizedText }
          : {}),
      });
    }

    const withoutTimings = new Set(args.languagesWithoutTimings ?? []);
    const languages = [
      args.sourceLanguage,
      ...args.translations.map((tr) => tr.language),
    ];
    for (const language of languages) {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])]),
      );
      await insertAudioFixture(ctx, {
        textId,
        language,
        storageId,
        ttsQuality: "validated",
        ...(withoutTimings.has(language) ? {} : { wordTimings: TIMINGS }),
      });
    }

    return textId;
  });
}

async function hasMissingContent(
  t: TestConvex<typeof schema>,
  textId: Id<"texts">,
  sourceLanguage: string,
  baseLanguages: string[],
  targetLanguages: string[],
  opts?: { ignoreMissingWordTimings?: boolean },
) {
  return t.run(async (ctx) => {
    const map = await buildTextContentBatchForLanguages(
      ctx,
      [
        {
          key: "k",
          textId,
          sourceText: "source text",
          sourceLanguage,
          sourceRomanization:
            (await ctx.db.get(textId))!.romanizedText ?? undefined,
          userCreated: false,
        },
      ],
      baseLanguages,
      targetLanguages,
      opts,
    );
    return map.get("k")!.hasMissingContent;
  });
}

describe("buildTextContentBatchForLanguages: romanization sentinel", () => {
  // `zh` needs romanization; `en` does not. The empty string is the
  // "tried, failed, leave empty" sentinel the romanization workers persist
  // after exhausting their retries. The schedulers in decks.ts never
  // re-enqueue it, so reporting the card as incomplete would ask forever for
  // work nothing is willing to do.
  it("treats a sentinel romanization on a translation as attempted", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: "en",
      translations: [{ language: "zh", romanizedText: "" }],
    });
    expect(await hasMissingContent(t, textId, "en", ["en"], ["zh"])).toBe(false);
  });

  it("still reports a never-attempted romanization on a translation", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: "en",
      translations: [{ language: "zh" }],
    });
    expect(await hasMissingContent(t, textId, "en", ["en"], ["zh"])).toBe(true);
  });

  it("treats a sentinel romanization on the source text as attempted", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: "zh",
      sourceRomanizedText: "",
      translations: [{ language: "en" }],
    });
    expect(await hasMissingContent(t, textId, "zh", ["en"], ["zh"])).toBe(false);
  });

  it("still reports a never-attempted romanization on the source text", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: "zh",
      translations: [{ language: "en" }],
    });
    expect(await hasMissingContent(t, textId, "zh", ["en"], ["zh"])).toBe(true);
  });

  it("ignores romanization entirely for languages that don't need it", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: "en",
      translations: [{ language: "de" }],
    });
    expect(await hasMissingContent(t, textId, "en", ["en"], ["de"])).toBe(false);
  });
});

describe("buildTextContentBatchForLanguages: word timings", () => {
  // `scheduleTimingsBackfillIfNeeded` refuses to schedule a backfill for
  // languages our STT backend can't transcribe, so flagging those cards as
  // incomplete asks for work that is deliberately never done.
  it("does not report missing timings for a language without STT support", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: "en",
      translations: [{ language: "sw_tz" }],
      languagesWithoutTimings: ["sw_tz"],
    });
    expect(await hasMissingContent(t, textId, "en", ["en"], ["sw_tz"])).toBe(
      false,
    );
  });

  it("still reports missing timings for a language with STT support", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: "en",
      translations: [{ language: "de" }],
      languagesWithoutTimings: ["de"],
    });
    expect(await hasMissingContent(t, textId, "en", ["en"], ["de"])).toBe(true);
  });

  it("honours ignoreMissingWordTimings", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: "en",
      translations: [{ language: "de" }],
      languagesWithoutTimings: ["de"],
    });
    expect(
      await hasMissingContent(t, textId, "en", ["en"], ["de"], {
        ignoreMissingWordTimings: true,
      }),
    ).toBe(false);
  });
});
