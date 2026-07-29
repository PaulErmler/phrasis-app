/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import {
  deleteAudioRow,
  deleteStorageBlobIfUnreferenced,
} from "../../lib/audio";

const modules = import.meta.glob("../../**/*.ts");

/**
 * `deleteAudioRow` must delete the storage blob ONLY when it is the last
 * audioRecordings row referencing it. Blobs are shared across texts because
 * `editCard` copies audio by reusing `storageId`, so dropping a blob while
 * another row still points at it would corrupt that text's audio.
 */
describe("deleteAudioRow — reference-aware blob cleanup", () => {
  async function seedTwoRowsSharingOneBlob(t: TestConvex<typeof schema>) {
    return t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "c",
        textCount: 0,
      });
      const mkText = (text: string) =>
        ctx.db.insert("texts", {
          text,
          language: "es",
          userCreated: true,
          collectionId,
          collectionRank: 1,
        });
      const textA = await mkText("uno");
      const textB = await mkText("dos");
      // One shared blob, referenced by both texts' audio rows (the editCard
      // copy shape).
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])]),
      );
      const mkAudio = (textId: typeof textA) =>
        ctx.db.insert("audioRecordings", {
          textId,
          language: "es",
          voiceName: "es-test-voice",
          storageId,
          voiceGender: "female",
        });
      const rowA = await mkAudio(textA);
      const rowB = await mkAudio(textB);
      return { storageId, rowA, rowB };
    });
  }

  it("keeps the shared blob until the LAST referencing row is deleted", async () => {
    const t = convexTest(schema, modules);
    const { storageId, rowA, rowB } = await seedTwoRowsSharingOneBlob(t);

    // Delete the first row — blob must survive (rowB still references it).
    await t.run(async (ctx) => {
      await deleteAudioRow(ctx, (await ctx.db.get(rowA))!);
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(rowA)).toBeNull();
      expect(await ctx.db.get(rowB)).not.toBeNull();
      // Blob still present → getUrl resolves.
      expect(await ctx.storage.getUrl(storageId)).not.toBeNull();
    });

    // Delete the last row — blob is now unreferenced and must be removed.
    await t.run(async (ctx) => {
      await deleteAudioRow(ctx, (await ctx.db.get(rowB))!);
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(rowB)).toBeNull();
      expect(await ctx.storage.getUrl(storageId)).toBeNull();
    });
  });

  it("deletes the blob immediately when the row is the only reference", async () => {
    const t = convexTest(schema, modules);
    const { row, storageId } = await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "c",
        textCount: 0,
      });
      const textId = await ctx.db.insert("texts", {
        text: "solo",
        language: "es",
        userCreated: true,
        collectionId,
        collectionRank: 1,
      });
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([9])]),
      );
      const row = await ctx.db.insert("audioRecordings", {
        textId,
        language: "es",
        voiceName: "es-test-voice",
        storageId,
        voiceGender: "female",
      });
      return { row, storageId };
    });

    await t.run(async (ctx) => {
      await deleteAudioRow(ctx, (await ctx.db.get(row))!);
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(row)).toBeNull();
      expect(await ctx.storage.getUrl(storageId)).toBeNull();
    });
  });
});

/**
 * `deleteStorageBlobIfUnreferenced` drops a blob by storageId only when no
 * audioRecordings row still references it. Used by `storeAudioRecording` /
 * `updateAudioRecordingQuality` after a row was already patched to a NEW blob —
 * so the OLD blob must not be dropped while another text (an editCard copy)
 * still points at it.
 */
describe("deleteStorageBlobIfUnreferenced — reference-aware blob cleanup", () => {
  it("keeps a blob still referenced by another row after one row is repointed", async () => {
    const t = convexTest(schema, modules);
    const { rowA, blobX, blobY } = await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "c",
        textCount: 0,
      });
      const mkText = (text: string) =>
        ctx.db.insert("texts", {
          text,
          language: "es",
          userCreated: true,
          collectionId,
          collectionRank: 1,
        });
      const textA = await mkText("uno");
      const textB = await mkText("dos");
      const blobX = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])]),
      );
      const mkAudio = (textId: typeof textA) =>
        ctx.db.insert("audioRecordings", {
          textId,
          language: "es",
          voiceName: "es-test-voice",
          storageId: blobX,
          voiceGender: "female",
        });
      const rowA = await mkAudio(textA);
      await mkAudio(textB); // rowB also references blobX
      const blobY = await ctx.storage.store(
        new Blob([new Uint8Array([4, 5, 6])]),
      );
      return { rowA, blobX, blobY };
    });

    // Repoint rowA to a new blob Y (the storeAudioRecording shape), then ask to
    // drop the OLD blob X — it must survive because rowB still references it.
    await t.run(async (ctx) => {
      await ctx.db.patch(rowA, { storageId: blobY });
      await deleteStorageBlobIfUnreferenced(ctx, blobX);
    });
    await t.run(async (ctx) => {
      expect(await ctx.storage.getUrl(blobX)).not.toBeNull();
    });

    // Repoint rowB off X too, then X is unreferenced → it must be removed.
    await t.run(async (ctx) => {
      const rowB = await ctx.db
        .query("audioRecordings")
        .withIndex("by_storageId", (q) => q.eq("storageId", blobX))
        .first();
      await ctx.db.patch(rowB!._id, { storageId: blobY });
      await deleteStorageBlobIfUnreferenced(ctx, blobX);
    });
    await t.run(async (ctx) => {
      expect(await ctx.storage.getUrl(blobX)).toBeNull();
    });
  });
});
