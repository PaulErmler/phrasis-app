import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { LEGACY_TO_NEW_CODE } from '../lib/collections';

const COURSE_PAGE_SIZE = 25;
const SCHEDULE_STAGGER_MS = 50;

/**
 * Paginates over courses and schedules `cutoverUser` for each. The 50ms
 * stagger keeps the scheduler from queueing all users at once on activation.
 *
 * Run via `internal.admin.activateDataset.activateDataset` with `runCutover: true`
 * (gated by FF_NEW_COURSE_CUTOVER) or directly via `runCutoverNow`.
 */
export const cutoverAllUsers = internalMutation({
  args: {
    datasetId: v.id('datasets'),
    cursor: v.optional(v.string()),
  },
  returns: v.object({ processed: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('courses').paginate({
      cursor: args.cursor ?? null,
      numItems: COURSE_PAGE_SIZE,
    });

    let stagger = 0;
    for (const course of result.page) {
      if (course.isArchived) continue;
      await ctx.scheduler.runAfter(
        stagger,
        internal.migrations.datasetMigration_cutoverUser.cutoverUser,
        {
          userId: course.userId,
          courseId: course._id,
          datasetId: args.datasetId,
        },
      );
      stagger += SCHEDULE_STAGGER_MS;
    }

    if (!result.isDone) {
      // Keep paginating courses without blocking on the per-user fan-out.
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.datasetMigration_cutoverUser.cutoverAllUsers,
        { datasetId: args.datasetId, cursor: result.continueCursor },
      );
    }

    return {
      processed: result.page.length,
      isDone: result.isDone,
    };
  },
});

/**
 * Roll forward a single (userId, courseId)'s legacy CEFR progress into the
 * matching first-of-tier new-dataset collection. Idempotent. Short-circuits
 * if courseSettings.reconciledDatasetId already matches.
 */
export const cutoverUser = internalMutation({
  args: {
    userId: v.string(),
    courseId: v.id('courses'),
    datasetId: v.id('datasets'),
  },
  returns: v.union(
    v.object({
      skipped: v.literal(true),
      reason: v.literal('already-reconciled'),
    }),
    v.object({ skipped: v.literal(false), rolled: v.number() }),
  ),
  handler: async (ctx, args) => {
    // --- Idempotency check ------------------------------------------------
    const settings = await ctx.db
      .query('courseSettings')
      .withIndex('by_courseId', (q) => q.eq('courseId', args.courseId))
      .first();
    if (settings?.reconciledDatasetId === args.datasetId) {
      return { skipped: true, reason: 'already-reconciled' } as const;
    }

    // --- Resolve legacy → new collection ids ------------------------------
    // The new collections are uniquely identified by (datasetId, code).
    const newCollections = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_order', (q) =>
        q.eq('datasetId', args.datasetId),
      )
      .collect();
    const newCodeToId = new Map<string, Id<'collections'>>();
    for (const c of newCollections) {
      if (c.code) newCodeToId.set(c.code, c._id);
    }

    // --- Pre-resolve the seven legacy collections in parallel -------------
    const legacyNames = Object.keys(LEGACY_TO_NEW_CODE);
    const legacyDocs = await Promise.all(
      legacyNames.map((name) =>
        ctx.db
          .query('collections')
          .withIndex('by_name', (q) => q.eq('name', name))
          .first(),
      ),
    );
    const legacyByName = new Map<string, Doc<'collections'>>();
    legacyNames.forEach((name, i) => {
      const doc = legacyDocs[i];
      if (doc) legacyByName.set(name, doc);
    });

    // --- Live-compute fallback for cardsMastered --------------------------
    // Rows written before `cardsMastered` existed have it set to `undefined`
    // (a one-time backfill stamped most of them, but any row it missed stays
    // undefined). If we naively did `legacyProgress.cardsMastered ?? 0`,
    // we'd roll 0 forward and the destination row would never get a real
    // count. To remove that hazard entirely, recompute the count
    // live from the cards table whenever the legacy row hasn't been backfilled
    // yet. This is a one-time read per (course, legacy collection) at cutover.
    const deck = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', args.courseId))
      .first();
    let masteredCountByLegacyCollection:
      | Map<Id<'collections'>, number>
      | undefined;
    async function getLiveMasteredCount(
      legacyCollectionId: Id<'collections'>,
    ): Promise<number> {
      if (!deck) return 0;
      if (!masteredCountByLegacyCollection) {
        masteredCountByLegacyCollection = new Map();
        const masteredCards = await ctx.db
          .query('cards')
          .withIndex('by_deckId_and_isHidden_and_isMastered', (q) =>
            q
              .eq('deckId', deck._id)
              .eq('isHidden', false)
              .eq('isMastered', true),
          )
          .collect();
        for (const card of masteredCards) {
          if (!card.collectionId) continue;
          const key = card.collectionId;
          masteredCountByLegacyCollection.set(
            key,
            (masteredCountByLegacyCollection.get(key) ?? 0) + 1,
          );
        }
      }
      return masteredCountByLegacyCollection.get(legacyCollectionId) ?? 0;
    }

    // --- Walk legacy collections, roll counters forward -------------------
    let rolled = 0;
    for (const legacyName of legacyNames) {
      const targetCode = LEGACY_TO_NEW_CODE[legacyName];
      const targetId = newCodeToId.get(targetCode);
      if (!targetId) continue; // Dataset incomplete? Skip rather than error.

      const legacyCollection = legacyByName.get(legacyName);
      if (!legacyCollection) continue;

      // Skip self-roll: if upload labelled a new collection with the legacy
      // name (shouldn't happen with our upload script, but defensive).
      if (legacyCollection._id === targetId) continue;

      const legacyProgress = await ctx.db
        .query('collectionProgress')
        .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('collectionId', legacyCollection._id),
        )
        .first();
      if (!legacyProgress) continue;

      // Resolve cardsMastered: prefer the backfilled value, fall back to a
      // live count from the cards table when the row predates the backfill.
      const legacyMastered =
        legacyProgress.cardsMastered ??
        (await getLiveMasteredCount(legacyCollection._id));

      if (
        (legacyProgress.cardsAdded ?? 0) === 0 &&
        (legacyProgress.cardsLearned ?? 0) === 0 &&
        legacyMastered === 0
      ) {
        continue;
      }

      // Get-or-create the destination row and add the legacy counters in.
      const destProgress = await ctx.db
        .query('collectionProgress')
        .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('collectionId', targetId),
        )
        .first();
      const legacyAdded = legacyProgress.cardsAdded ?? 0;
      if (destProgress) {
        await ctx.db.patch(destProgress._id, {
          cardsAdded: destProgress.cardsAdded + legacyAdded,
          cardsLearned:
            (destProgress.cardsLearned ?? 0) +
            (legacyProgress.cardsLearned ?? 0),
          cardsMastered: (destProgress.cardsMastered ?? 0) + legacyMastered,
          legacyCarryAdded: (destProgress.legacyCarryAdded ?? 0) + legacyAdded,
        });
      } else {
        await ctx.db.insert('collectionProgress', {
          userId: args.userId,
          courseId: args.courseId,
          collectionId: targetId,
          cardsAdded: legacyAdded,
          cardsLearned: legacyProgress.cardsLearned ?? 0,
          cardsMastered: legacyMastered,
          legacyCarryAdded: legacyAdded,
        });
      }
      rolled++;
    }

    // --- Remap activeCollectionId if it points at a legacy collection -----
    let newActiveCollectionId: Id<'collections'> | undefined;
    if (settings?.activeCollectionId) {
      const activeCollection = await ctx.db.get(settings.activeCollectionId);
      if (activeCollection && LEGACY_TO_NEW_CODE[activeCollection.name]) {
        const targetCode = LEGACY_TO_NEW_CODE[activeCollection.name];
        newActiveCollectionId = newCodeToId.get(targetCode);
      }
    }

    // --- Mark as reconciled ----------------------------------------------
    if (settings) {
      await ctx.db.patch(settings._id, {
        reconciledDatasetId: args.datasetId,
        ...(newActiveCollectionId
          ? { activeCollectionId: newActiveCollectionId }
          : {}),
      });
    } else {
      // No courseSettings row yet. Create a minimal one with the marker so
      // future cutover invocations short-circuit.
      await ctx.db.insert('courseSettings', {
        courseId: args.courseId,
        initialReviewCount: 0,
        reconciledDatasetId: args.datasetId,
      });
    }

    return { skipped: false as const, rolled };
  },
});
