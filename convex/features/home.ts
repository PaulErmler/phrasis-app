import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getCourseSettings } from '../db/courseSettings';
import {
  getPremadeLevelCollections,
  getCollectionProgressForCourse,
} from '../db/collections';
import { deriveLegacyCefrTierForLevel } from '../lib/collections';

/**
 * Single-shot query for the new segmented home view. Returns all premade
 * levels (from the active dataset) plus the user's custom collections, each
 * with monotonic progress counters joined in from `collectionProgress`.
 *
 * Read pattern:
 *   - one indexed scan of `collections` filtered to the active dataset
 *   - one indexed scan of `collectionProgress` for (userId, courseId)
 *   - a handful of point lookups for custom collections referenced in courseSettings
 *
 * Total reads per render are bounded by the number of collections involved,
 * not by the number of cards. Counters come from `collectionProgress`, which
 * is maintained monotonically by the `insertCard` / `patchCard` hooks
 * (see convex/db/stats/cardAggregates.ts).
 */
export const getHomeSummary = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      datasetId: v.union(v.id('datasets'), v.null()),
      activeCollectionId: v.union(v.id('collections'), v.null()),
      levels: v.array(
        v.object({
          collectionId: v.id('collections'),
          code: v.string(),
          cefrTier: v.string(),
          order: v.number(),
          displayName: v.string(),
          totalTexts: v.number(),
          cardsAdded: v.number(),
          ignoredCount: v.number(),
          prioritizedCount: v.number(),
          // Sequential-add frontier (lastRankProcessed) — the preview dialog
          // snapshots this once at open as its browse range anchor.
          browseAnchor: v.number(),
          cardsLearned: v.number(),
          cardsMastered: v.number(),
        }),
      ),
      customCollections: v.array(
        v.object({
          collectionId: v.id('collections'),
          name: v.string(),
          totalTexts: v.number(),
          cardsAdded: v.number(),
          ignoredCount: v.number(),
          prioritizedCount: v.number(),
          browseAnchor: v.number(),
          cardsMastered: v.number(),
          isChat: v.boolean(),
          isCustom: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const activeCourse = await getActiveCourseForUser(ctx, userId);
    if (!activeCourse) return null;
    const { course } = activeCourse;

    const courseSettings = await getCourseSettings(ctx, course._id);

    // --- Active premade dataset + premade levels ---------------------------
    // At most one dataset is active globally; if none is active yet, the
    // helper falls back to the legacy CEFR collections so the home view keeps
    // rendering (see getPremadeLevelCollections for the read pattern).
    const { activeDataset, collections: levelCollections } =
      await getPremadeLevelCollections(ctx);

    // --- Progress rows for the active course (one indexed scan) ------------
    const progressRows = await getCollectionProgressForCourse(ctx, userId, course._id);
    const progressByCollection = new Map<Id<'collections'>, Doc<'collectionProgress'>>();
    for (const row of progressRows) {
      progressByCollection.set(row.collectionId, row);
    }

    const levels = levelCollections.map((collection) => {
      const progress = progressByCollection.get(collection._id);
      // `legacyCarryAdded` is the cardsAdded amount rolled forward from the
      // mapped legacy CEFR collection at cutover. It's already baked into
      // `progress.cardsAdded` (numerator); widening `totalTexts` keeps the
      // displayed ratio coherent — e.g. legacy 100/295 lands on L02 as
      // 100/(L02.textCount + 100), not 100/L02.textCount.
      const carry = progress?.legacyCarryAdded ?? 0;
      return {
        collectionId: collection._id,
        code: collection.code ?? collection.name,
        // Legacy collections don't carry a `cefrTier` field. Map by name:
        // "Essential" → Pre-A1 (so it groups separately from A1 in the home
        // view); all other legacy names (A1..C2) ARE the CEFR tier name.
        cefrTier:
          collection.cefrTier ?? deriveLegacyCefrTierForLevel(collection.name),
        order: collection.order ?? 0,
        displayName: collection.displayName ?? collection.name,
        totalTexts: collection.textCount + carry,
        cardsAdded: progress?.cardsAdded ?? 0,
        ignoredCount: progress?.ignoredCount ?? 0,
        prioritizedCount: progress?.prioritizedCount ?? 0,
        browseAnchor: progress?.lastRankProcessed ?? 0,
        cardsLearned: progress?.cardsLearned ?? 0,
        cardsMastered: progress?.cardsMastered ?? 0,
      };
    });

    // --- Custom collections ------------------------------------------------
    // Includes the chat collection, manual custom collection, and any
    // additional activeCustomCollectionIds the user has selected.
    const customIds = new Set<string>();
    const chatId = courseSettings?.chatCollectionId;
    const customId = courseSettings?.customCollectionId;
    if (chatId) customIds.add(chatId);
    if (customId) customIds.add(customId);
    for (const id of courseSettings?.activeCustomCollectionIds ?? []) {
      customIds.add(id);
    }

    const customDocs = await Promise.all(
      [...customIds].map((idStr) => ctx.db.get(idStr as Id<'collections'>)),
    );
    const customCollections = customDocs.flatMap((collection) => {
      if (!collection) return [];
      const progress = progressByCollection.get(collection._id);
      return [
        {
          collectionId: collection._id,
          name: collection.name,
          totalTexts: collection.textCount,
          cardsAdded: progress?.cardsAdded ?? 0,
          ignoredCount: progress?.ignoredCount ?? 0,
          prioritizedCount: progress?.prioritizedCount ?? 0,
          browseAnchor: progress?.lastRankProcessed ?? 0,
          cardsMastered: progress?.cardsMastered ?? 0,
          isChat: chatId === collection._id,
          isCustom: customId === collection._id,
        },
      ];
    });

    return {
      datasetId: activeDataset?._id ?? null,
      activeCollectionId: courseSettings?.activeCollectionId ?? null,
      levels,
      customCollections,
    };
  },
});
