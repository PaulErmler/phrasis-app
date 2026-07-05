/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";

import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  DEFAULT_CONTENT_VERSION,
  isTtsVersionStale,
  isTranslationVersionStale,
  getCurrentTtsVersion,
  getCurrentTranslationVersion,
} from "../../../lib/languages";

const modules = import.meta.glob("/convex/**/*.ts");

// pt_pt carries `ttsVersion: 2` in lib/languages.ts (an accent-fix bump). It is
// the canonical case the backfill must get right: legacy audio for it was
// produced under v1, so it must be stamped at the baseline (1) — NOT the current
// value (2) — otherwise the bump never regenerates the old audio.
const BUMPED_TTS_LANG = "pt_pt";
// es carries `translationVersion: 2` (Gemini 3.5 Flash Nitro rollout). Same
// backfill semantics as pt_pt audio: stamp legacy rows at baseline 1 so
// 1 < 2 = stale and scheduleMissingContent regenerates them lazily.
const BUMPED_TRANSLATION_LANG = "es";

async function seedText(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"texts">> {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 0,
    });
    return ctx.db.insert("texts", {
      text: "Hello",
      language: "en",
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
  });
}

async function insertAudio(
  t: ReturnType<typeof convexTest>,
  textId: Id<"texts">,
  language: string,
  ttsVersion?: number,
): Promise<Id<"audioRecordings">> {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])]),
    );
    return ctx.db.insert("audioRecordings", {
      textId,
      language,
      voiceName: "test-voice",
      storageId,
      ...(ttsVersion === undefined ? {} : { ttsVersion }),
    });
  });
}

async function insertTranslation(
  t: ReturnType<typeof convexTest>,
  textId: Id<"texts">,
  targetLanguage: string,
  translationVersion?: number,
): Promise<Id<"translations">> {
  return t.run(async (ctx) =>
    ctx.db.insert("translations", {
      textId,
      targetLanguage,
      translatedText: "Hola",
      ...(translationVersion === undefined ? {} : { translationVersion }),
    }),
  );
}

describe("backfillContentVersions migration", () => {
  it("stamps legacy audio rows at the baseline version (not the current per-language version)", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    // A legacy row for a language whose ttsVersion was bumped to 2.
    const bumpedAudio = await insertAudio(t, textId, BUMPED_TTS_LANG);
    // A legacy row for a language with no override (current === baseline).
    const plainAudio = await insertAudio(t, textId, "en");

    await t.mutation(
      internal.migrations.backfillContentVersions.processAudioBatch,
      {},
    );

    const rows = await t.run(async (ctx) => ({
      bumped: await ctx.db.get(bumpedAudio),
      plain: await ctx.db.get(plainAudio),
    }));

    // Both stamped at baseline 1 — crucially NOT getCurrentTtsVersion(pt_pt)=2.
    expect(rows.bumped?.ttsVersion).toBe(DEFAULT_CONTENT_VERSION);
    expect(rows.plain?.ttsVersion).toBe(DEFAULT_CONTENT_VERSION);
    expect(getCurrentTtsVersion(BUMPED_TTS_LANG)).toBeGreaterThan(
      DEFAULT_CONTENT_VERSION,
    );
  });

  it("leaves the backfilled audio row stale so the ttsVersion bump regenerates it", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const audioId = await insertAudio(t, textId, BUMPED_TTS_LANG);

    await t.mutation(
      internal.migrations.backfillContentVersions.processAudioBatch,
      {},
    );

    const row = await t.run(async (ctx) => ctx.db.get(audioId));
    // This is the whole point: a backfilled pt_pt row must be stale vs current
    // (1 < 2) so `scheduleMissingContent` deletes + re-synthesizes it. Stamping
    // it at the current value (2) would have made it permanently up-to-date.
    expect(isTtsVersionStale(BUMPED_TTS_LANG, row?.ttsVersion)).toBe(true);
  });

  it("stamps legacy translation rows at the baseline version (not the current per-language version)", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const bumpedTranslation = await insertTranslation(
      t,
      textId,
      BUMPED_TRANSLATION_LANG,
    );
    const plainTranslation = await insertTranslation(t, textId, "it");

    await t.mutation(
      internal.migrations.backfillContentVersions.processTranslationsBatch,
      {},
    );

    const rows = await t.run(async (ctx) => ({
      bumped: await ctx.db.get(bumpedTranslation),
      plain: await ctx.db.get(plainTranslation),
    }));

    expect(rows.bumped?.translationVersion).toBe(DEFAULT_CONTENT_VERSION);
    expect(rows.plain?.translationVersion).toBe(DEFAULT_CONTENT_VERSION);
    expect(getCurrentTranslationVersion(BUMPED_TRANSLATION_LANG)).toBeGreaterThan(
      DEFAULT_CONTENT_VERSION,
    );
    // it has no translationVersion bump — baseline === current, no storm.
    expect(
      isTranslationVersionStale("it", rows.plain?.translationVersion),
    ).toBe(false);
  });

  it("leaves the backfilled translation row stale so the translationVersion bump regenerates it", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const translationId = await insertTranslation(
      t,
      textId,
      BUMPED_TRANSLATION_LANG,
    );

    await t.mutation(
      internal.migrations.backfillContentVersions.processTranslationsBatch,
      {},
    );

    const row = await t.run(async (ctx) => ctx.db.get(translationId));
    expect(isTranslationVersionStale(BUMPED_TRANSLATION_LANG, row?.translationVersion)).toBe(
      true,
    );
  });

  it("is idempotent: rows already carrying a version are left untouched", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const stampedAudio = await insertAudio(t, textId, BUMPED_TTS_LANG, 5);
    const stampedTranslation = await insertTranslation(t, textId, "es", 5);

    await t.mutation(
      internal.migrations.backfillContentVersions.processAudioBatch,
      {},
    );
    await t.mutation(
      internal.migrations.backfillContentVersions.processTranslationsBatch,
      {},
    );

    const rows = await t.run(async (ctx) => ({
      audio: await ctx.db.get(stampedAudio),
      translation: await ctx.db.get(stampedTranslation),
    }));
    expect(rows.audio?.ttsVersion).toBe(5);
    expect(rows.translation?.translationVersion).toBe(5);
  });

  it("run() drains the scheduler and stamps every legacy row across both tables", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const textId = await seedText(t);
      const audioId = await insertAudio(t, textId, BUMPED_TTS_LANG);
      const translationId = await insertTranslation(t, textId, "es");

      const res = await t.mutation(
        internal.migrations.backfillContentVersions.run,
        {},
      );
      expect(res).toEqual({ status: "started" });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const rows = await t.run(async (ctx) => ({
        audio: await ctx.db.get(audioId),
        translation: await ctx.db.get(translationId),
      }));
      expect(rows.audio?.ttsVersion).toBe(DEFAULT_CONTENT_VERSION);
      expect(rows.translation?.translationVersion).toBe(DEFAULT_CONTENT_VERSION);
    } finally {
      vi.useRealTimers();
    }
  });
});
