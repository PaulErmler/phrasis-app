/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import {
  deleteAudioRow,
  deleteStorageBlobIfUnreferenced,
} from "../../lib/audio";
import { insertAudioFixture } from "./audioFixtures";

const modules = import.meta.glob("../../**/*.ts");

/**
 * `deleteAudioRow` deletes the shared `audioAssets` row (and its blob) ONLY
 * when the deleted pointer row was the last one referencing it. Assets are
 * shared across texts (same spoken string, `editCard` copies), so dropping
 * the asset while another row still points at it would corrupt that text's
 * audio.
 */
describe("deleteAudioRow: reference-aware asset cleanup", () => {
  async function seedTwoRowsSharingOneAsset(t: TestConvex<typeof schema>) {
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
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])]),
      );
      // One shared asset, pointed at by both texts' rows.
      const { assetId, rowId: rowA } = await insertAudioFixture(ctx, {
        textId: textA,
        language: "es",
        storageId,
      });
      const { rowId: rowB } = await insertAudioFixture(ctx, {
        textId: textB,
        language: "es",
        storageId,
        assetId,
      });
      return { storageId, assetId, rowA, rowB };
    });
  }

  it("keeps the shared asset and blob until the LAST pointer row is deleted", async () => {
    const t = convexTest(schema, modules);
    const { storageId, assetId, rowA, rowB } =
      await seedTwoRowsSharingOneAsset(t);

    // Delete the first row. Asset + blob must survive (rowB still points).
    await t.run(async (ctx) => {
      await deleteAudioRow(ctx, (await ctx.db.get(rowA))!);
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(rowA)).toBeNull();
      expect(await ctx.db.get(rowB)).not.toBeNull();
      expect(await ctx.db.get(assetId)).not.toBeNull();
      expect(await ctx.storage.getUrl(storageId)).not.toBeNull();
    });

    // Delete the last row. Asset and blob are now unreferenced and go.
    await t.run(async (ctx) => {
      await deleteAudioRow(ctx, (await ctx.db.get(rowB))!);
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(rowB)).toBeNull();
      expect(await ctx.db.get(assetId)).toBeNull();
      expect(await ctx.storage.getUrl(storageId)).toBeNull();
    });
  });

  it("deletes asset and blob immediately when the row is the only pointer", async () => {
    const t = convexTest(schema, modules);
    const { row, assetId, storageId } = await t.run(async (ctx) => {
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
      const { assetId, rowId: row } = await insertAudioFixture(ctx, {
        textId,
        language: "es",
        storageId,
      });
      return { row, assetId, storageId };
    });

    await t.run(async (ctx) => {
      await deleteAudioRow(ctx, (await ctx.db.get(row))!);
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(row)).toBeNull();
      expect(await ctx.db.get(assetId)).toBeNull();
      expect(await ctx.storage.getUrl(storageId)).toBeNull();
    });
  });
});

/**
 * `deleteStorageBlobIfUnreferenced` drops a blob by storageId only when no
 * `audioAssets` row still references it. Used after an asset was patched to
 * a NEW blob (and by the delayed swap-delete job), the OLD blob must not be
 * dropped while another asset still owns it.
 */
describe("deleteStorageBlobIfUnreferenced: reference-aware blob cleanup", () => {
  it("keeps a blob still referenced by an asset; drops it once unreferenced", async () => {
    const t = convexTest(schema, modules);
    const { assetId, blobX, blobY } = await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "c",
        textCount: 0,
      });
      const textId = await ctx.db.insert("texts", {
        text: "uno",
        language: "es",
        userCreated: true,
        collectionId,
        collectionRank: 1,
      });
      const blobX = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])]),
      );
      const { assetId } = await insertAudioFixture(ctx, {
        textId,
        language: "es",
        storageId: blobX,
      });
      const blobY = await ctx.storage.store(
        new Blob([new Uint8Array([4, 5, 6])]),
      );
      return { assetId, blobX, blobY };
    });

    // While the asset still owns X, asking to drop X must be a no-op.
    await t.run(async (ctx) => {
      await deleteStorageBlobIfUnreferenced(ctx, blobX);
    });
    await t.run(async (ctx) => {
      expect(await ctx.storage.getUrl(blobX)).not.toBeNull();
    });

    // Swap the asset to Y (the in-place replace shape), X is unreferenced
    // and must now be removed.
    await t.run(async (ctx) => {
      await ctx.db.patch(assetId, { storageId: blobY });
      await deleteStorageBlobIfUnreferenced(ctx, blobX);
    });
    await t.run(async (ctx) => {
      expect(await ctx.storage.getUrl(blobX)).toBeNull();
      expect(await ctx.storage.getUrl(blobY)).not.toBeNull();
    });
  });
});
