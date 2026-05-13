/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

async function makeCollection(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) =>
    ctx.db.insert("collections", { name: "A1", textCount: 0 }),
  );
}

describe("admin/backfillTextMetadata", () => {
  it("sets addressesSomeone=false for descriptive rows (addresseeNumber='not_applicable')", async () => {
    const t = convexTest(schema, modules);
    const collectionId = await makeCollection(t);
    const textId = await t.run(async (ctx) =>
      ctx.db.insert("texts", {
        externalId: "test-001",
        text: "It is raining today.",
        language: "en",
        userCreated: false,
        collectionId,
        collectionRank: 1,
        addresseeNumber: "not_applicable",
      }),
    );

    await t.mutation(internal.admin.backfillTextMetadata.processBatch, {});

    const row = await t.run(async (ctx) => ctx.db.get(textId));
    expect(row?.addressesSomeone).toBe(false);
    // referentGender still always coin-flipped, even for descriptive rows.
    expect(["male", "female"]).toContain(row?.referentGender);
    // Descriptive: addresseeGender should be left untouched (was undefined).
    expect(row?.addresseeGender).toBeUndefined();
  });

  it("sets addressesSomeone=true for direct-address rows (addresseeNumber missing)", async () => {
    const t = convexTest(schema, modules);
    const collectionId = await makeCollection(t);
    const textId = await t.run(async (ctx) =>
      ctx.db.insert("texts", {
        externalId: "test-002",
        text: "How are you?",
        language: "en",
        userCreated: false,
        collectionId,
        collectionRank: 1,
        // no addresseeNumber → treated as direct-address
      }),
    );

    await t.mutation(internal.admin.backfillTextMetadata.processBatch, {});

    const row = await t.run(async (ctx) => ctx.db.get(textId));
    expect(row?.addressesSomeone).toBe(true);
    expect(["male", "female"]).toContain(row?.addresseeGender);
    expect(["male", "female"]).toContain(row?.referentGender);
  });

  it("preserves an already-set addressesSomeone (does not overwrite)", async () => {
    const t = convexTest(schema, modules);
    const collectionId = await makeCollection(t);
    const textId = await t.run(async (ctx) =>
      ctx.db.insert("texts", {
        externalId: "test-003",
        text: "Whatever.",
        language: "en",
        userCreated: false,
        collectionId,
        collectionRank: 1,
        // Pre-set values shouldn't be churned.
        addressesSomeone: true,
        addresseeGender: "female",
        referentGender: "male",
        addresseeNumber: "not_applicable", // would suggest false, but field is already set
      }),
    );

    await t.mutation(internal.admin.backfillTextMetadata.processBatch, {});

    const row = await t.run(async (ctx) => ctx.db.get(textId));
    expect(row?.addressesSomeone).toBe(true); // kept
    expect(row?.addresseeGender).toBe("female"); // kept
    expect(row?.referentGender).toBe("male"); // kept
  });

  it("coin-flips referentGender when missing, regardless of addressesSomeone", async () => {
    const t = convexTest(schema, modules);
    const collectionId = await makeCollection(t);
    const textId = await t.run(async (ctx) =>
      ctx.db.insert("texts", {
        externalId: "test-004",
        text: "Some sentence.",
        language: "en",
        userCreated: false,
        collectionId,
        collectionRank: 1,
        addresseeNumber: "not_applicable",
      }),
    );

    await t.mutation(internal.admin.backfillTextMetadata.processBatch, {});

    const row = await t.run(async (ctx) => ctx.db.get(textId));
    expect(["male", "female"]).toContain(row?.referentGender);
  });

  it("stable seed: re-running gives the same referentGender for the same externalId", async () => {
    const t = convexTest(schema, modules);
    const collectionId = await makeCollection(t);
    const textId = await t.run(async (ctx) =>
      ctx.db.insert("texts", {
        externalId: "stable-id-xyz",
        text: "Test.",
        language: "en",
        userCreated: false,
        collectionId,
        collectionRank: 1,
        addresseeNumber: "not_applicable",
      }),
    );

    await t.mutation(internal.admin.backfillTextMetadata.processBatch, {});
    const after1 = await t.run(async (ctx) => ctx.db.get(textId));
    const firstReferent = after1?.referentGender;

    // Clear referentGender to simulate a fresh row with the same externalId.
    await t.run(async (ctx) =>
      ctx.db.patch(textId, { referentGender: undefined }),
    );

    await t.mutation(internal.admin.backfillTextMetadata.processBatch, {});
    const after2 = await t.run(async (ctx) => ctx.db.get(textId));
    expect(after2?.referentGender).toBe(firstReferent);
  });

  it("is idempotent: re-running on fully-populated rows updates 0 records", async () => {
    const t = convexTest(schema, modules);
    const collectionId = await makeCollection(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("texts", {
        externalId: "row-1",
        text: "Hi.",
        language: "en",
        userCreated: false,
        collectionId,
        collectionRank: 1,
        addressesSomeone: true,
        addresseeGender: "male",
        referentGender: "female",
      });
      await ctx.db.insert("texts", {
        externalId: "row-2",
        text: "It rains.",
        language: "en",
        userCreated: false,
        collectionId,
        collectionRank: 2,
        addressesSomeone: false,
        referentGender: "male",
      });
    });

    // First run should commit nothing (both rows are already complete).
    const result = await t.mutation(
      internal.admin.backfillTextMetadata.processBatch,
      {},
    );
    expect(result.updated).toBe(0);
    expect(result.processed).toBe(2);
  });

  it("processes a batch of mixed legacy rows and reports the correct counts", async () => {
    const t = convexTest(schema, modules);
    const collectionId = await makeCollection(t);
    await t.run(async (ctx) => {
      // 3 legacy descriptive rows.
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("texts", {
          externalId: `desc-${i}`,
          text: `Descriptive ${i}.`,
          language: "en",
          userCreated: false,
          collectionId,
          collectionRank: i + 1,
          addresseeNumber: "not_applicable",
        });
      }
      // 2 legacy direct-address rows.
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("texts", {
          externalId: `dir-${i}`,
          text: `Direct ${i}.`,
          language: "en",
          userCreated: false,
          collectionId,
          collectionRank: 4 + i,
        });
      }
    });

    const result = await t.mutation(
      internal.admin.backfillTextMetadata.processBatch,
      {},
    );

    expect(result.processed).toBe(5);
    expect(result.updated).toBe(5);

    const descRows = await t.run(async (ctx) =>
      ctx.db.query("texts").collect(),
    );
    const numDescTrue = descRows.filter(
      (r) => r.addressesSomeone === true,
    ).length;
    const numDescFalse = descRows.filter(
      (r) => r.addressesSomeone === false,
    ).length;
    expect(numDescTrue).toBe(2);
    expect(numDescFalse).toBe(3);
    // All 5 rows got a referentGender.
    expect(
      descRows.every(
        (r) => r.referentGender === "male" || r.referentGender === "female",
      ),
    ).toBe(true);
  });
});
