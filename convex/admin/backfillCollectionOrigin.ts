import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc, Id } from '../_generated/dataModel';

/**
 * Two-phase backfill for the content-source filter:
 *
 *   Phase A — populate `collections.origin` (single-pass, small table).
 *   Phase B — populate `cards.collectionId` + `cards.collectionOrigin`
 *             (paginated, idempotent, self-scheduling).
 *
 * Run order: Phase A first (Phase B reads collections.origin to populate cards).
 * Both are idempotent on the field-undefined check, so re-running is safe.
 *
 * Trigger from the Convex dashboard:
 *   `internal/admin/backfillCollectionOrigin:runCollectionsOriginBackfill`
 *   `internal/admin/backfillCollectionOrigin:runCardsBackfill`
 */

const CARDS_BATCH_SIZE = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Phase A: collections.origin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Iterates every collection once and stamps `origin` if missing.
 *
 * Classification rules:
 *   - datasetId !== undefined  → 'premade'  (uploaded curriculum)
 *   - legacy === true          → 'premade'  (pre-OGTE A1..C2/Essential)
 *   - id is some courseSettings.chatCollectionId → 'chat'
 *   - id is some courseSettings.customCollectionId OR otherwise → 'custom'
 *
 * Cardinality is small (tens to low hundreds across all users), so one
 * mutation handles the full table without pagination.
 */
export const runCollectionsOriginBackfill = internalMutation({
  args: {},
  returns: v.object({
    processed: v.number(),
    updated: v.number(),
    classified: v.object({
      premade: v.number(),
      custom: v.number(),
      chat: v.number(),
    }),
  }),
  handler: async (ctx) => {
    const allSettings = await ctx.db.query('courseSettings').collect();
    const chatCollectionIds = new Set<string>();
    for (const settings of allSettings) {
      if (settings.chatCollectionId) {
        chatCollectionIds.add(settings.chatCollectionId.toString());
      }
    }

    const collections = await ctx.db.query('collections').collect();
    let updated = 0;
    const classified = { premade: 0, custom: 0, chat: 0 };

    for (const coll of collections) {
      if (coll.origin !== undefined) {
        classified[coll.origin]++;
        continue;
      }

      let origin: 'premade' | 'custom' | 'chat';
      if (coll.datasetId !== undefined || coll.legacy === true) {
        origin = 'premade';
      } else if (chatCollectionIds.has(coll._id.toString())) {
        origin = 'chat';
      } else {
        origin = 'custom';
      }

      await ctx.db.patch(coll._id, { origin });
      classified[origin]++;
      updated++;
    }

    return {
      processed: collections.length,
      updated,
      classified,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase B: cards.collectionId + cards.collectionOrigin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kick off the cards backfill. Schedules the first paginated batch.
 * Must run AFTER `runCollectionsOriginBackfill` so `collections.origin` exists.
 */
export const runCardsBackfill = internalMutation({
  args: {},
  returns: v.object({ status: v.string() }),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.admin.backfillCollectionOrigin.processCardsBatch,
      {},
    );
    return { status: 'started' };
  },
});

export const processCardsBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    processed: v.number(),
    updated: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('cards').paginate({
      cursor: args.cursor ?? null,
      numItems: CARDS_BATCH_SIZE,
    });

    // Within-batch cache so we don't re-read the same collection for every
    // card that shares it (e.g. all OGTE-L01 cards in a batch).
    const collectionCache = new Map<
      string,
      { collectionId: Id<'collections'>; origin: 'premade' | 'custom' | 'chat' | undefined }
    >();

    let updated = 0;
    for (const card of result.page) {
      // Both fields already populated — skip.
      if (card.collectionId !== undefined && card.collectionOrigin !== undefined) {
        continue;
      }

      // Resolve collectionId via the card's text.
      const text = await ctx.db.get(card.textId);
      if (!text) continue;
      const collectionId = text.collectionId;

      const cacheKey = collectionId.toString();
      let entry = collectionCache.get(cacheKey);
      if (!entry) {
        const collection = await ctx.db.get(collectionId);
        entry = { collectionId, origin: collection?.origin };
        collectionCache.set(cacheKey, entry);
      }

      const patch: Partial<Doc<'cards'>> = {};
      if (card.collectionId === undefined) patch.collectionId = collectionId;
      if (card.collectionOrigin === undefined && entry.origin !== undefined) {
        patch.collectionOrigin = entry.origin;
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(card._id, patch);
        updated++;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.admin.backfillCollectionOrigin.processCardsBatch,
        { cursor: result.continueCursor },
      );
    }

    return {
      processed: result.page.length,
      updated,
      isDone: result.isDone,
    };
  },
});
