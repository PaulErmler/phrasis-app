import { v } from 'convex/values';
import { internalMutation, internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

/**
 * Seed the placement-test corpus.
 *
 * Data shape:
 *   - All 100 English source sentences live in `texts`, attached to a single
 *     synthetic collection named `placement-test-pool`. That collection is
 *     never offered as study material (no path in the app maps to its name),
 *     so the texts can't accidentally enter a user's deck.
 *   - For each `texts` row we also write a `placementTestSentences` row
 *     carrying the OGTE `level` + `position` + traceability fields. This is
 *     the side table the placement-test feature queries against.
 *
 * Translations + audio attach to the `texts` rows via the existing pipelines
 * exactly like any other text. Backfill for a target language is triggered
 * lazily by `prepareLanguagePair` in `convex/features/onboarding.ts` when a
 * user picks that language at the start of onboarding.
 *
 * Idempotent: re-running upserts by (level, position), already-seeded rows
 * are left in place.
 *
 * Run with:
 *   npx convex run migrations/seedPlacementTestSentences:run
 */

interface SeedEntry {
  level: number;
  position: number;
  text: string;
  ogteId: string;
  rarestWord: string;
  wordCount: number;
}

const POOL_COLLECTION_NAME = 'placement-test-pool';
const POOL_COLLECTION_DISPLAY_NAME = 'Placement Test Pool';

export const seedPlacementCorpus = internalMutation({
  args: {
    entries: v.array(
      v.object({
        level: v.number(),
        position: v.number(),
        text: v.string(),
        ogteId: v.string(),
        rarestWord: v.string(),
        wordCount: v.number(),
        // Optional metadata carried in the JSON corpus for traceability,
        // not stored on the seeded rows.
        register: v.optional(v.union(v.string(), v.null())),
        formality: v.optional(v.union(v.string(), v.null())),
      }),
    ),
  },
  returns: v.object({
    collectionCreated: v.boolean(),
    textsInserted: v.number(),
    sentencesInserted: v.number(),
    sentencesAlreadyPresent: v.number(),
  }),
  handler: async (ctx, { entries }) => {
    // 1) Find or create the single pool collection that holds all
    // placement-test `texts` rows.
    let pool = await ctx.db
      .query('collections')
      .withIndex('by_name', (q) => q.eq('name', POOL_COLLECTION_NAME))
      .first();
    let collectionCreated = false;
    let poolId: Id<'collections'>;
    if (pool) {
      poolId = pool._id;
    } else {
      poolId = await ctx.db.insert('collections', {
        name: POOL_COLLECTION_NAME,
        textCount: 0,
        displayName: POOL_COLLECTION_DISPLAY_NAME,
        origin: 'premade',
      });
      pool = await ctx.db.get(poolId);
      collectionCreated = true;
    }

    let textsInserted = 0;
    let sentencesInserted = 0;
    let sentencesAlreadyPresent = 0;

    for (const e of entries) {
      // Idempotency: check whether a placementTestSentences row already
      // exists for this (level, position).
      const existing = await ctx.db
        .query('placementTestSentences')
        .withIndex('by_level_and_position', (q) =>
          q.eq('level', e.level).eq('position', e.position),
        )
        .first();
      if (existing) {
        sentencesAlreadyPresent++;
        continue;
      }

      // Insert the English `texts` row in the pool collection. The
      // collectionRank is unused for placement-test sentences but the schema
      // requires a number; we pack `level * 100 + position` so each row gets
      // a stable, deduplicable rank without affecting any feature logic.
      const textId = await ctx.db.insert('texts', {
        text: e.text,
        language: 'en',
        userCreated: false,
        collectionId: poolId,
        collectionRank: e.level * 100 + e.position,
        externalId: `placement-${e.level}-${e.position}-${e.ogteId}`,
      });
      textsInserted++;

      await ctx.db.insert('placementTestSentences', {
        level: e.level,
        position: e.position,
        textId,
        rarestWord: e.rarestWord,
        ogteId: e.ogteId,
      });
      sentencesInserted++;
    }

    // Refresh the pool collection's denormalized textCount.
    const allPlacementSentences = await ctx.db
      .query('placementTestSentences')
      .collect();
    if (pool && pool.textCount !== allPlacementSentences.length) {
      await ctx.db.patch(poolId, { textCount: allPlacementSentences.length });
    }

    return {
      collectionCreated,
      textsInserted,
      sentencesInserted,
      sentencesAlreadyPresent,
    };
  },
});

/**
 * Public entry point. Reads the English corpus and seeds the placement-test
 * rows + pool collection.
 *
 * Translation backfill is **not** triggered here. Translations land lazily
 * per target language via `prepareLanguagePair`. Pass `languages: [...]`
 * explicitly to pre-warm specific languages at deploy time.
 */
export const run = internalAction({
  args: {
    languages: v.optional(v.array(v.string())),
  },
  returns: v.object({
    collectionCreated: v.boolean(),
    textsInserted: v.number(),
    sentencesInserted: v.number(),
    sentencesAlreadyPresent: v.number(),
    backfillsScheduled: v.number(),
  }),
  handler: async (ctx, { languages }): Promise<{
    collectionCreated: boolean;
    textsInserted: number;
    sentencesInserted: number;
    sentencesAlreadyPresent: number;
    backfillsScheduled: number;
  }> => {
    const entries: SeedEntry[] = (
      await import('../../data/placement-test/english.json')
    ).default as SeedEntry[];

    const result = await ctx.runMutation(
      internal.migrations.seedPlacementTestSentences.seedPlacementCorpus,
      { entries },
    );

    let scheduled = 0;
    if (languages && languages.length > 0) {
      for (const target of languages) {
        if (target === 'en') continue;
        await ctx.runMutation(
          internal.features.onboarding.enqueueMissingPlacementTranslations,
          { targetLanguage: target, sourceLanguage: 'en' },
        );
        scheduled++;
      }
    }

    return { ...result, backfillsScheduled: scheduled };
  },
});
