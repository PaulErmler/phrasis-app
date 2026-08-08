/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";

import schema from "../../schema";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  backfillAudioAssetForRow,
  audioQualityRank,
} from "../../migrations";
import { sha256Hex } from "../../lib/sha256";
import { drainSchedulerAfterEach } from "../lib/drainScheduler";

const modules = import.meta.glob("/convex/**/*.ts");

drainSchedulerAfterEach();

async function seedText(
  t: TestConvex<typeof schema>,
  text: string,
  language = "es",
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 0,
    });
    return ctx.db.insert("texts", {
      text,
      language,
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
  });
}

async function storeBlob(t: TestConvex<typeof schema>, byte: number) {
  return t.run(async (ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([byte])])),
  );
}

/** Insert a pre-audioAssets legacy payload row. */
async function seedLegacyRow(
  t: TestConvex<typeof schema>,
  args: {
    textId: Id<"texts">;
    language?: string;
    storageId: Id<"_storage">;
    voiceName?: string;
    ttsQuality?: "unknown" | "validated" | "unvalidated";
    voiceGender?: "male" | "female";
    wordTimings?: { word: string; start: number; end: number }[];
    ttsVersion?: number;
  },
) {
  return t.run(async (ctx) =>
    ctx.db.insert("audioRecordings", {
      textId: args.textId,
      language: args.language ?? "es",
      voiceName: args.voiceName ?? "Leda",
      storageId: args.storageId,
      ttsQuality: args.ttsQuality,
      ttsProvider: "gemini",
      voiceGender: args.voiceGender ?? "female",
      wordTimings: args.wordTimings,
      ttsVersion: args.ttsVersion,
    }),
  );
}

async function migrateRow(
  t: TestConvex<typeof schema>,
  rowId: Id<"audioRecordings">,
) {
  await t.run(async (ctx) => {
    const doc = await ctx.db.get(rowId);
    if (doc) await backfillAudioAssetForRow(ctx, doc);
  });
}

async function getAssets(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => ctx.db.query("audioAssets").collect());
}

async function getRow(t: TestConvex<typeof schema>, rowId: Id<"audioRecordings">) {
  return t.run(async (ctx) => ctx.db.get(rowId));
}

async function blobExists(
  t: TestConvex<typeof schema>,
  storageId: Id<"_storage">,
) {
  return t.run(async (ctx) => (await ctx.storage.getUrl(storageId)) !== null);
}

describe("migrations/backfillAudioAssets", () => {
  it("folds two identical-string rows into one asset — validated payload wins, rows become pointers", async () => {
    const t = convexTest(schema, modules);
    const textA = await seedText(t, "Hola");
    const textB = await seedText(t, "Hola");
    const blobA = await storeBlob(t, 1);
    const blobB = await storeBlob(t, 2);
    const rowA = await seedLegacyRow(t, {
      textId: textA,
      storageId: blobA,
      ttsQuality: "validated",
      wordTimings: [{ word: "Hola", start: 0, end: 0.4 }],
      ttsVersion: 1,
    });
    const rowB = await seedLegacyRow(t, {
      textId: textB,
      storageId: blobB,
      ttsQuality: "unvalidated",
    });

    // Migrate the weaker row first so the winner has to replace in place.
    await migrateRow(t, rowB);
    await migrateRow(t, rowA);

    const assets = await getAssets(t);
    expect(assets.length).toBe(1);
    expect(assets[0].ttsQuality).toBe("validated");
    expect(assets[0].storageId).toBe(blobA);
    expect(assets[0].spokenText).toBe("Hola");
    expect(assets[0].spokenTextHash).toBe(sha256Hex("Hola"));
    expect(assets[0].ttsVersion).toBe(1);

    const afterA = await getRow(t, rowA);
    const afterB = await getRow(t, rowB);
    expect(afterA?.assetId).toBe(assets[0]._id);
    expect(afterB?.assetId).toBe(assets[0]._id);
    // Payload fields cleared on repoint.
    expect(afterA?.storageId).toBeUndefined();
    expect(afterB?.voiceName).toBeUndefined();
    // The superseded blob is only deleted by the DELAYED reference-checked
    // job, so it still exists right after the migration pass.
    expect(await blobExists(t, blobB)).toBe(true);
    expect(await blobExists(t, blobA)).toBe(true);
  });

  it("editCard-copied rows sharing one blob keep it — same asset, nothing deleted", async () => {
    const t = convexTest(schema, modules);
    const textA = await seedText(t, "Hola");
    const textB = await seedText(t, "Hola");
    const sharedBlob = await storeBlob(t, 1);
    const rowA = await seedLegacyRow(t, {
      textId: textA,
      storageId: sharedBlob,
      ttsQuality: "validated",
    });
    const rowB = await seedLegacyRow(t, {
      textId: textB,
      storageId: sharedBlob,
      ttsQuality: "validated",
    });

    await migrateRow(t, rowA);
    await migrateRow(t, rowB);

    const assets = await getAssets(t);
    expect(assets.length).toBe(1);
    expect(assets[0].storageId).toBe(sharedBlob);
    expect((await getRow(t, rowA))?.assetId).toBe(assets[0]._id);
    expect((await getRow(t, rowB))?.assetId).toBe(assets[0]._id);
    expect(await blobExists(t, sharedBlob)).toBe(true);
  });

  it("distinct regionVariants become distinct assets", async () => {
    const t = convexTest(schema, modules);
    // Source text in English; audio rows for the es translation.
    const textA = await seedText(t, "Hello", "en");
    const textB = await seedText(t, "Hello", "en");
    await t.run(async (ctx) => {
      await ctx.db.insert("translations", {
        textId: textA,
        targetLanguage: "es",
        translatedText: "Hola",
        regionVariant: "es-ES",
      });
      await ctx.db.insert("translations", {
        textId: textB,
        targetLanguage: "es",
        translatedText: "Hola",
        regionVariant: "es-US",
      });
    });
    const rowA = await seedLegacyRow(t, {
      textId: textA,
      storageId: await storeBlob(t, 1),
      ttsQuality: "validated",
    });
    const rowB = await seedLegacyRow(t, {
      textId: textB,
      storageId: await storeBlob(t, 2),
      ttsQuality: "validated",
    });

    await migrateRow(t, rowA);
    await migrateRow(t, rowB);

    const assets = await getAssets(t);
    expect(assets.length).toBe(2);
    expect(new Set(assets.map((a) => a.regionVariant))).toEqual(
      new Set(["es-ES", "es-US"]),
    );
  });

  it("deletes rows whose text or translation no longer exists", async () => {
    const t = convexTest(schema, modules);
    // Missing text.
    const textGone = await seedText(t, "Hola");
    const rowOrphan = await seedLegacyRow(t, {
      textId: textGone,
      storageId: await storeBlob(t, 1),
    });
    await t.run(async (ctx) => ctx.db.delete(textGone));
    await migrateRow(t, rowOrphan);
    expect(await getRow(t, rowOrphan)).toBeNull();

    // Missing translation for a non-source-language row.
    const textEn = await seedText(t, "Hello", "en");
    const rowNoTranslation = await seedLegacyRow(t, {
      textId: textEn,
      language: "es",
      storageId: await storeBlob(t, 2),
    });
    await migrateRow(t, rowNoTranslation);
    expect(await getRow(t, rowNoTranslation)).toBeNull();
    expect((await getAssets(t)).length).toBe(0);
  });

  it("leaves rows with unresolvable voice gender un-migrated (lazy sweep handles them)", async () => {
    const t = convexTest(schema, modules);
    const textA = await seedText(t, "Hola");
    const blob = await storeBlob(t, 1);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("audioRecordings", {
        textId: textA,
        language: "es",
        voiceName: "voice-removed-from-curated-list",
        storageId: blob,
        ttsQuality: "validated",
        // no voiceGender
      }),
    );

    await migrateRow(t, rowId);

    const after = await getRow(t, rowId);
    expect(after?.assetId).toBeUndefined();
    expect(after?.storageId).toBe(blob);
    expect((await getAssets(t)).length).toBe(0);
  });

  it("is idempotent — a second pass over a migrated row is a no-op", async () => {
    const t = convexTest(schema, modules);
    const textA = await seedText(t, "Hola");
    const rowA = await seedLegacyRow(t, {
      textId: textA,
      storageId: await storeBlob(t, 1),
      ttsQuality: "validated",
    });

    await migrateRow(t, rowA);
    const assetsAfterFirst = await getAssets(t);
    await migrateRow(t, rowA);
    const assetsAfterSecond = await getAssets(t);

    expect(assetsAfterFirst.length).toBe(1);
    expect(assetsAfterSecond.length).toBe(1);
    expect(assetsAfterSecond[0]._id).toBe(assetsAfterFirst[0]._id);
  });

  it("deleteUnmigratedAudioRows removes only rows without assetId (post-backfill sweep)", async () => {
    const t = convexTest(schema, modules);
    // Migrated pointer row — must survive.
    const textA = await seedText(t, "Hola");
    const rowMigrated = await seedLegacyRow(t, {
      textId: textA,
      storageId: await storeBlob(t, 1),
      ttsQuality: "validated",
    });
    await migrateRow(t, rowMigrated);
    // Unresolvable-gender row the backfill skipped — must be deleted.
    const textB = await seedText(t, "Adiós");
    const skippedBlob = await storeBlob(t, 2);
    const rowSkipped = await t.run(async (ctx) =>
      ctx.db.insert("audioRecordings", {
        textId: textB,
        language: "es",
        voiceName: "voice-removed-from-curated-list",
        storageId: skippedBlob,
        ttsQuality: "validated",
      }),
    );

    // Same per-doc body the migration runs.
    await t.run(async (ctx) => {
      for (const doc of await ctx.db.query("audioRecordings").collect()) {
        if (doc.assetId === undefined) {
          const { deleteAudioRow } = await import("../../lib/audio");
          await deleteAudioRow(ctx, doc);
        }
      }
    });

    expect(await getRow(t, rowMigrated)).not.toBeNull();
    expect(await getRow(t, rowSkipped)).toBeNull();
    // The skipped row's blob was unreferenced — reclaimed immediately.
    expect(await blobExists(t, skippedBlob)).toBe(false);
    expect((await getAssets(t)).length).toBe(1);
  });

  it("audioQualityRank orders validated > unvalidated > legacy-undefined > unknown", () => {
    const ranked = (["unknown", undefined, "unvalidated", "validated"] as const)
      .map((q) => audioQualityRank(q as Doc<"audioRecordings">["ttsQuality"]));
    expect(ranked).toEqual([0, 1, 2, 3]);
  });
});
