import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getCourseSettings } from '../db/courseSettings';
import {
  getActiveDataset,
  getCollectionProgressForCourse,
} from '../db/collections';
import { LEGACY_LEVEL_ORDER } from '../lib/collections';

/**
 * Derive a CEFR tier for a legacy collection that lacks the `cefrTier` field.
 * Essential maps to Pre-A1; A1..C2 names already correspond to their own tier.
 */
function deriveLegacyCefrTier(name: string): string {
  if (name === 'Essential') return 'Pre-A1';
  return name;
}

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

    // --- Resolve the active premade dataset --------------------------------
    // At most one dataset is active globally — its texts are translated into
    // every target language via the `translations` table. If no dataset is
    // active yet (pre-activation), fall back to listing legacy collections so
    // the home view keeps rendering.
    const activeDataset = await getActiveDataset(ctx);

    // --- Premade levels ----------------------------------------------------
    // Only fetch the rows actually displayed on the home view — either the
    // active dataset's ~20 collections (one indexed scan) or the seven legacy
    // CEFR rows by name (one indexed `first()` each). Avoids the global
    // `collections` scan that would otherwise grow with every user's custom
    // and chat collections.
    let levelCollections: Doc<'collections'>[];
    if (activeDataset) {
      levelCollections = await ctx.db
        .query('collections')
        .withIndex('by_datasetId_and_order', (q) =>
          q.eq('datasetId', activeDataset._id),
        )
        .collect();
    } else {
      const legacyDocs = await Promise.all(
        LEGACY_LEVEL_ORDER.map((name) =>
          ctx.db
            .query('collections')
            .withIndex('by_name', (q) => q.eq('name', name))
            .first(),
        ),
      );
      levelCollections = legacyDocs.filter(
        (c): c is Doc<'collections'> => c !== null,
      );
    }

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
        cefrTier: collection.cefrTier ?? deriveLegacyCefrTier(collection.name),
        order: collection.order ?? 0,
        displayName: collection.displayName ?? collection.name,
        totalTexts: collection.textCount + carry,
        cardsAdded: progress?.cardsAdded ?? 0,
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
