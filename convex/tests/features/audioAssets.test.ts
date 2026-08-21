/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, vi, beforeEach } from "vitest";

import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { scheduleAudioForLanguage } from "../../features/decks";
import { deleteAudioRowsForTextLanguage } from "../../lib/audio";
import { getCurrentTtsVersion } from "../../../lib/languages";
// The workpools are module-mocked globally (tests/convexTestSetup.ts):
// `enqueueAction` is a vi.fn() resolving to unique fake workIds, so tests can
// assert the enqueue payload directly.
import { ttsPool } from "../../lib/workpools";
import { drainSchedulerAfterEach } from "../lib/drainScheduler";

const mockEnqueueTts = vi.mocked(ttsPool.enqueueAction);

const modules = import.meta.glob("/convex/**/*.ts");

drainSchedulerAfterEach();

beforeEach(() => {
  mockEnqueueTts.mockClear();
});

/** Seed a text with a resolved female voice gender. */
async function seedText(
  t: TestConvex<typeof schema>,
  text: string,
  opts?: { gender?: "male" | "female" },
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 0,
    });
    return ctx.db.insert("texts", {
      text,
      language: "es",
      userCreated: false,
      collectionId,
      collectionRank: 1,
      speakerGender: opts?.gender ?? "female",
      audioSpeakerGender: opts?.gender ?? "female",
    });
  });
}

async function storeBlob(t: TestConvex<typeof schema>, byte: number) {
  return t.run(async (ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([byte])])),
  );
}

/** Simulate a TTS job's final write for (textId, 'es'). */
async function storeFinal(
  t: TestConvex<typeof schema>,
  args: {
    textId: Id<"texts">;
    spokenText: string;
    storageId: Id<"_storage">;
    ttsQuality?: "unknown" | "validated" | "unvalidated";
    voiceGender?: "male" | "female";
    wordTimings?: { word: string; start: number; end: number }[];
  },
) {
  await t.mutation(internal.features.decks.storeAudioRecording, {
    textId: args.textId,
    language: "es",
    voiceName: "Leda",
    storageId: args.storageId,
    ttsQuality: args.ttsQuality ?? "validated",
    ttsProvider: "gemini",
    voiceGender: args.voiceGender ?? "female",
    speed: 1,
    wordTimings: args.wordTimings,
    spokenText: args.spokenText,
  });
}

async function getRow(t: TestConvex<typeof schema>, textId: Id<"texts">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("audioRecordings")
      .withIndex("by_text_and_language", (q) =>
        q.eq("textId", textId).eq("language", "es"),
      )
      .first(),
  );
}

async function getAllAssets(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => ctx.db.query("audioAssets").collect());
}

async function getClaim(t: TestConvex<typeof schema>, textId: Id<"texts">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("ttsGenerationClaims")
      .withIndex("by_text_and_language", (q) =>
        q.eq("textId", textId).eq("language", "es"),
      )
      .first(),
  );
}

async function blobExists(
  t: TestConvex<typeof schema>,
  storageId: Id<"_storage">,
) {
  return t.run(async (ctx) => (await ctx.storage.getUrl(storageId)) !== null);
}

describe("audioAssets content-addressed cache", () => {
  describe("cache reuse at scheduleAudioForLanguage", () => {
    it("second text with the identical string attaches to the asset, no claim, no TTS job", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const blob = await storeBlob(t, 1);
      await storeFinal(t, { textId: textA, spokenText: "Hola", storageId: blob });

      const textB = await seedText(t, "Hola");
      const scheduled = await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, "es", "female", null);
      });

      expect(scheduled).toBe(true);
      expect(mockEnqueueTts).not.toHaveBeenCalled();
      expect(await getClaim(t, textB)).toBeNull();

      const rowA = await getRow(t, textA);
      const rowB = await getRow(t, textB);
      expect(rowB?.assetId).toBeDefined();
      expect(rowB?.assetId).toBe(rowA?.assetId);
      expect((await getAllAssets(t)).length).toBe(1);
    });

    it("a different gender is a different key, no reuse, job enqueued", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: await storeBlob(t, 1),
      });

      const textB = await seedText(t, "Hola", { gender: "male" });
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, "es", "male", null);
      });

      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
      expect(await getClaim(t, textB)).not.toBeNull();
    });

    it("a whitespace variant is a different key, the raw string is never normalized", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: await storeBlob(t, 1),
      });

      const textB = await seedText(t, " Hola");
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, "es", "female", null);
      });

      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
    });

    it("forceRegen bypasses a fresh asset and threads the flag into the job", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: await storeBlob(t, 1),
      });

      const textB = await seedText(t, "Hola");
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, "es", "female", null, {
          forceRegen: true,
        });
      });

      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
      expect(mockEnqueueTts.mock.calls[0][2]).toMatchObject({
        forceRegen: true,
      });
      expect(await getClaim(t, textB)).not.toBeNull();
    });

    it("a version-stale asset is not reused, and the re-synthesis patches it in place for every sharer", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const oldBlob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: oldBlob,
      });
      // Age the asset below the language's current ttsVersion.
      await t.run(async (ctx) => {
        const asset = (await ctx.db.query("audioAssets").collect())[0];
        await ctx.db.patch(asset._id, { ttsVersion: 0 });
      });

      const textB = await seedText(t, "Hola");
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, "es", "female", null);
      });
      // Stale → miss → real job enqueued.
      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);

      // Simulate that job's final write: same key, new blob.
      const newBlob = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textB,
        spokenText: "Hola",
        storageId: newBlob,
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].storageId).toBe(newBlob);
      expect(assets[0].ttsVersion).toBe(getCurrentTtsVersion("es"));
      // Text A shares the healed asset, no sweep needed on its side.
      const rowA = await getRow(t, textA);
      expect(rowA?.assetId).toBe(assets[0]._id);
      // The replaced blob is deleted on a delay, not immediately.
      expect(await blobExists(t, oldBlob)).toBe(true);
    });
  });

  describe("storeAudioRecording replace rules", () => {
    it("refuses to write when the incoming blob no longer exists (no dead asset born)", async () => {
      // Regression (2026-08-20): a job's blob can be garbage-collected before
      // its completion write lands. Writing anyway created an asset that
      // looked valid but served a null URL — the forever-spinner state.
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const blob = await storeBlob(t, 1);
      await t.run(async (ctx) => ctx.storage.delete(blob));

      await storeFinal(t, { textId: textA, spokenText: "Hola", storageId: blob });

      expect(await getAllAssets(t)).toEqual([]);
      expect(await getRow(t, textA)).toBeNull();
    });

    it("attempt-0 creates the asset as 'unknown' with a pointer row", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const blob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: blob,
        ttsQuality: "unknown",
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].ttsQuality).toBe("unknown");
      expect((await getRow(t, textA))?.assetId).toBe(assets[0]._id);
    });

    it("a mid-flight 'unknown' write never clobbers completed audio, pointer only, incoming blob SPARED for the running job", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const goodBlob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: goodBlob,
      });

      const textB = await seedText(t, "Hola");
      const incomingBlob = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textB,
        spokenText: "Hola",
        storageId: incomingBlob,
        ttsQuality: "unknown",
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].ttsQuality).toBe("validated");
      expect(assets[0].storageId).toBe(goodBlob);
      expect((await getRow(t, textB))?.assetId).toBe(assets[0]._id);
      // The incoming blob must NOT be deleted immediately: the job that
      // stored it is still running and references it in its final write
      // (see the 'kept' branch in storeAudioRecording). It is scheduled for
      // the delayed reference-checked delete instead.
      expect(await blobExists(t, incomingBlob)).toBe(true);
    });

    it("circle-breaker: after a 'kept' early write, the job's final write still lands with its blob intact", async () => {
      // The forever-spinner loop (2026-08-20): the 'kept' branch used to
      // delete the early write's blob immediately, killing it under the
      // running job; the final write then either birthed a dead asset or
      // was refused, and the ensure retried the same doomed sequence
      // forever. The full job sequence must now converge.
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const corpseBlob = await storeBlob(t, 1);
      await storeFinal(t, { textId: textA, spokenText: "Hola", storageId: corpseBlob });
      // Make the completed asset a corpse (its blob deleted), as observed live.
      await t.run(async (ctx) => ctx.storage.delete(corpseBlob));

      // A fresh job for another text of the same string: early write, then
      // final validated write with the SAME blob — the real job's sequence.
      const textB = await seedText(t, "Hola");
      const jobBlob = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textB,
        spokenText: "Hola",
        storageId: jobBlob,
        ttsQuality: "unknown",
      });
      await storeFinal(t, {
        textId: textB,
        spokenText: "Hola",
        storageId: jobBlob,
        ttsQuality: "validated",
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].ttsQuality).toBe("validated");
      expect(assets[0].storageId).toBe(jobBlob);
      expect(await blobExists(t, jobBlob)).toBe(true);
      expect((await getRow(t, textB))?.assetId).toBe(assets[0]._id);
      expect((await getRow(t, textA))?.assetId).toBe(assets[0]._id);
    });

    it("a completed 'unvalidated' write replaces 'validated' audio, a regeneration always lands", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const blob1 = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: blob1,
        wordTimings: [{ word: "Hola", start: 0, end: 0.5 }],
      });

      const blob2 = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: blob2,
        ttsQuality: "unvalidated",
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].ttsQuality).toBe("unvalidated");
      expect(assets[0].storageId).toBe(blob2);
      // Timings belonged to the replaced blob.
      expect(assets[0].wordTimings).toBeUndefined();
      // Grace window: the replaced blob survives until the delayed job fires.
      expect(await blobExists(t, blob1)).toBe(true);
      await t.mutation(
        internal.features.ttsProcessing.deleteBlobIfUnreferencedJob,
        { storageId: blob1 },
      );
      expect(await blobExists(t, blob1)).toBe(false);
    });
  });

  describe("pointer deletes and asset lifecycle", () => {
    it("deleting one sharer keeps the asset and blob; deleting the last pointer removes both", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const blob = await storeBlob(t, 1);
      await storeFinal(t, { textId: textA, spokenText: "Hola", storageId: blob });

      const textB = await seedText(t, "Hola");
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, "es", "female", null);
      });

      await t.run(async (ctx) =>
        deleteAudioRowsForTextLanguage(ctx, textA, "es"),
      );
      expect((await getAllAssets(t)).length).toBe(1);
      expect(await blobExists(t, blob)).toBe(true);
      expect((await getRow(t, textB))?.assetId).toBeDefined();

      await t.run(async (ctx) =>
        deleteAudioRowsForTextLanguage(ctx, textB, "es"),
      );
      expect((await getAllAssets(t)).length).toBe(0);
      expect(await blobExists(t, blob)).toBe(false);
    });

    it("repointing the last pointer to a different asset cleans up the orphan (delayed blob delete)", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const femaleBlob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: femaleBlob,
      });

      // A racing job under the male gender key completes for the same
      // (text, language): the row repoints to the new asset, and the female
      // asset. Now pointerless. Must not leak.
      const maleBlob = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: maleBlob,
        voiceGender: "male",
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].voiceGender).toBe("male");
      expect((await getRow(t, textA))?.assetId).toBe(assets[0]._id);
      // The orphan's blob survives the grace window, then goes.
      expect(await blobExists(t, femaleBlob)).toBe(true);
      await t.mutation(
        internal.features.ttsProcessing.deleteBlobIfUnreferencedJob,
        { storageId: femaleBlob },
      );
      expect(await blobExists(t, femaleBlob)).toBe(false);
    });

    it("repointing away from a still-shared asset leaves it untouched", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, "Hola");
      const femaleBlob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: femaleBlob,
      });
      const textB = await seedText(t, "Hola");
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, "es", "female", null);
      });

      await storeFinal(t, {
        textId: textA,
        spokenText: "Hola",
        storageId: await storeBlob(t, 2),
        voiceGender: "male",
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(2);
      const female = assets.find((a) => a.voiceGender === "female");
      expect(female?.storageId).toBe(femaleBlob);
      expect((await getRow(t, textB))?.assetId).toBe(female?._id);
      expect(await blobExists(t, femaleBlob)).toBe(true);
    });
  });
});
