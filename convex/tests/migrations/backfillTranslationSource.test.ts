/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";

import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

const modules = import.meta.glob("/convex/**/*.ts");

const LEGACY_GEMINI_MODEL = "google/gemini-3.1-flash-lite-preview";
const SHORT_TAG = `${LEGACY_GEMINI_MODEL}-none`;
const LONG_TAG = `${LEGACY_GEMINI_MODEL}-low`;
const USER_PROVIDED = "user-provided";

async function seedDataset(
  t: ReturnType<typeof convexTest>,
  args: { isActive: boolean; slug?: string },
): Promise<Id<"datasets">> {
  return t.run((ctx) =>
    ctx.db.insert("datasets", {
      slug: args.slug ?? "ogte-curated",
      version: "1.0.0",
      publishedAt: Date.now(),
      isActive: args.isActive,
    }),
  );
}

async function seedCollection(
  t: ReturnType<typeof convexTest>,
  args: { datasetId?: Id<"datasets"> } = {},
): Promise<Id<"collections">> {
  return t.run((ctx) =>
    ctx.db.insert("collections", {
      name: "A1",
      textCount: 0,
      ...(args.datasetId ? { datasetId: args.datasetId } : {}),
    }),
  );
}

async function seedText(
  t: ReturnType<typeof convexTest>,
  args: {
    text: string;
    collectionId: Id<"collections">;
    datasetId?: Id<"datasets">;
    userCreated: boolean;
  },
): Promise<Id<"texts">> {
  return t.run((ctx) =>
    ctx.db.insert("texts", {
      text: args.text,
      language: "en",
      userCreated: args.userCreated,
      collectionId: args.collectionId,
      collectionRank: 1,
      ...(args.datasetId ? { datasetId: args.datasetId } : {}),
    }),
  );
}

async function seedTranslation(
  t: ReturnType<typeof convexTest>,
  args: {
    textId: Id<"texts">;
    targetLanguage: string;
    translatedText: string;
    translationSource?: string;
  },
): Promise<Id<"translations">> {
  return t.run((ctx) =>
    ctx.db.insert("translations", {
      textId: args.textId,
      targetLanguage: args.targetLanguage,
      translatedText: args.translatedText,
      ...(args.translationSource !== undefined
        ? { translationSource: args.translationSource }
        : {}),
    }),
  );
}

async function getSource(
  t: ReturnType<typeof convexTest>,
  id: Id<"translations">,
): Promise<string | undefined> {
  return t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    return row?.translationSource;
  });
}

describe("migrations/backfillTranslationSource", () => {
  it("tags dataset rows with the length-derived Gemini source", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const datasetId = await seedDataset(t, { isActive: true });
      const collectionId = await seedCollection(t, { datasetId });

      // 5 chars — strictly below HYBRID_LENGTH_THRESHOLD (30).
      const shortText = await seedText(t, {
        text: "Hello",
        collectionId,
        datasetId,
        userCreated: false,
      });
      // 40 chars — at/above threshold.
      const longText = await seedText(t, {
        text: "This sentence is well above the threshold.",
        collectionId,
        datasetId,
        userCreated: false,
      });

      const shortTrans = await seedTranslation(t, {
        textId: shortText,
        targetLanguage: "es",
        translatedText: "Hola",
      });
      const longTrans = await seedTranslation(t, {
        textId: longText,
        targetLanguage: "es",
        translatedText: "Esta oración está por encima del umbral.",
      });

      await t.mutation(
        internal.migrations.backfillTranslationSource.run,
        {},
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await getSource(t, shortTrans)).toBe(SHORT_TAG);
      expect(await getSource(t, longTrans)).toBe(LONG_TAG);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an already-tagged row (idempotent re-runs)", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const datasetId = await seedDataset(t, { isActive: true });
      const collectionId = await seedCollection(t, { datasetId });
      const textId = await seedText(t, {
        text: "Hi",
        collectionId,
        datasetId,
        userCreated: false,
      });
      const trans = await seedTranslation(t, {
        textId,
        targetLanguage: "es",
        translatedText: "Hola",
        translationSource: "deliberately-wrong-tag",
      });

      await t.mutation(
        internal.migrations.backfillTranslationSource.run,
        {},
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await getSource(t, trans)).toBe("deliberately-wrong-tag");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tags user-created (custom) text translations as user-provided", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      await seedDataset(t, { isActive: true });
      const collectionId = await seedCollection(t);
      const textId = await seedText(t, {
        text: "I typed this",
        collectionId,
        userCreated: true,
      });
      const trans = await seedTranslation(t, {
        textId,
        targetLanguage: "es",
        translatedText: "Yo escribí esto",
      });

      await t.mutation(
        internal.migrations.backfillTranslationSource.run,
        {},
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await getSource(t, trans)).toBe(USER_PROVIDED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves translations from non-active datasets untouched", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const activeId = await seedDataset(t, {
        isActive: true,
        slug: "active",
      });
      const oldId = await seedDataset(t, {
        isActive: false,
        slug: "old",
      });
      const oldCollection = await seedCollection(t, { datasetId: oldId });
      const activeCollection = await seedCollection(t, {
        datasetId: activeId,
      });

      const oldText = await seedText(t, {
        text: "Old dataset text",
        collectionId: oldCollection,
        datasetId: oldId,
        userCreated: false,
      });
      const activeText = await seedText(t, {
        text: "Active dataset text",
        collectionId: activeCollection,
        datasetId: activeId,
        userCreated: false,
      });

      const oldTrans = await seedTranslation(t, {
        textId: oldText,
        targetLanguage: "es",
        translatedText: "Texto viejo",
      });
      const activeTrans = await seedTranslation(t, {
        textId: activeText,
        targetLanguage: "es",
        translatedText: "Texto activo",
      });

      await t.mutation(
        internal.migrations.backfillTranslationSource.run,
        {},
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // Convex serializes a missing optional field as `null`, not `undefined`.
      expect(await getSource(t, oldTrans)).toBeNull();
      expect(await getSource(t, activeTrans)).toBe(SHORT_TAG);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still tags custom translations when no dataset is active", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      // No active dataset row at all.
      const collectionId = await seedCollection(t);
      const textId = await seedText(t, {
        text: "Custom only",
        collectionId,
        userCreated: true,
      });
      const trans = await seedTranslation(t, {
        textId,
        targetLanguage: "es",
        translatedText: "Solo personalizado",
      });

      await t.mutation(
        internal.migrations.backfillTranslationSource.run,
        {},
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await getSource(t, trans)).toBe(USER_PROVIDED);
    } finally {
      vi.useRealTimers();
    }
  });
});
