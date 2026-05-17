import { v } from 'convex/values';
import { query, internalMutation, mutation } from '../_generated/server';
import { Doc } from '../_generated/dataModel';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getDeckByCourseId } from '../db/decks';
import { buildTextContentBatchForLanguages } from '../lib/cardContent';
import {
  translationValidator,
  audioRecordingValidator,
  fsrsStateValidator,
  schedulingPhaseValidator,
} from '../types';

// ============================================================================
// QUERY
// ============================================================================

const activeFilterValidator = v.optional(
  v.union(
    v.literal('mastered'),
    v.literal('hidden'),
    v.literal('favorites'),
  ),
);

// 'custom' includes both 'custom' and 'chat' origins (anything the user
// authored — manual entry or via chat). 'premade' is curated course content.
const sourceFilterValidator = v.optional(
  v.union(v.literal('custom'), v.literal('premade')),
);

const libraryCardValidator = v.object({
  _id: v.id('cards'),
  _creationTime: v.number(),
  textId: v.id('texts'),
  sourceText: v.string(),
  sourceLanguage: v.string(),
  translations: v.array(translationValidator),
  audioRecordings: v.array(audioRecordingValidator),
  dueDate: v.number(),
  isMastered: v.boolean(),
  isHidden: v.boolean(),
  isFavorite: v.optional(v.boolean()),
  preReviewCount: v.number(),
  schedulingPhase: schedulingPhaseValidator,
  fsrsState: v.union(fsrsStateValidator, v.null()),
  lastReviewedAt: v.optional(v.number()),
  hasMissingContent: v.boolean(),
});

/**
 * Paginated library query with optional full-text search and an exclusive
 * filter selection.
 *
 * activeFilter:
 *   undefined  → all non-hidden cards (default)
 *   'mastered' → only mastered non-hidden cards
 *   'hidden'   → only hidden cards
 *   'favorites'→ only favorited non-hidden cards
 */
const LIBRARY_LIMIT = 200;

export const getLibraryCards = query({
  args: {
    searchQuery: v.optional(v.string()),
    activeFilter: activeFilterValidator,
    sourceFilter: sourceFilterValidator,
  },
  returns: v.array(libraryCardValidator),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];
    const { course } = active;

    const deck = await getDeckByCourseId(ctx, course._id);
    if (!deck) return [];

    const filter = args.activeFilter ?? null;
    const source = args.sourceFilter ?? null;
    const searchQuery = args.searchQuery?.trim() ?? '';

    // Each (state × source) combo resolves via a single pure-index query, or
    // (for source === 'custom') two pure-index queries merged on the server —
    // no Convex `.filter()` post-scans. 'custom' covers origins
    // ∈ {'custom','chat'}; 'premade' is curated course content. The state
    // dimension has its own existing indexes; the new
    // `*_origin_lastReviewedAt` indexes mirror each state index for the
    // origin-extended case.

    const isHidden = filter === 'hidden';

    type Origin = 'premade' | 'custom' | 'chat';
    const NON_PREMADE_ORIGINS: readonly Origin[] = ['custom', 'chat'] as const;

    const mergeByLastReviewedDesc = (
      buckets: Doc<'cards'>[][],
    ): Doc<'cards'>[] =>
      buckets
        .flat()
        .sort((a, b) => (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0))
        .slice(0, LIBRARY_LIMIT);

    let cards: Doc<'cards'>[];

    if (searchQuery.length > 0) {
      const runSearch = (originValue?: Origin) =>
        ctx.db
          .query('cards')
          .withSearchIndex('search_text', (q) => {
            let sq = q
              .search('searchableText', searchQuery)
              .eq('deckId', deck._id);
            if (filter === 'mastered') {
              sq = sq.eq('isHidden', false).eq('isMastered', true);
            } else if (filter === 'hidden') {
              sq = sq.eq('isHidden', true);
            } else if (filter === 'favorites') {
              sq = sq.eq('isHidden', false).eq('isFavorite', true);
            } else {
              sq = sq.eq('isHidden', false);
            }
            if (originValue !== undefined) {
              sq = sq.eq('collectionOrigin', originValue);
            }
            return sq;
          })
          .take(LIBRARY_LIMIT);

      if (source === 'premade') {
        cards = await runSearch('premade');
      } else if (source === 'custom') {
        const buckets = await Promise.all(
          NON_PREMADE_ORIGINS.map((o) => runSearch(o)),
        );
        // Search results are returned in relevance order; lastReviewedAt
        // re-sort here matches the ordering used by the non-search branches
        // so the library list is consistent regardless of which path served
        // the query.
        cards = mergeByLastReviewedDesc(buckets);
      } else {
        cards = await runSearch();
      }
    } else if (filter === 'mastered') {
      const fetchOrigin = (origin: Origin) =>
        ctx.db
          .query('cards')
          .withIndex(
            'by_deckId_isHidden_mastered_origin_lastReviewedAt',
            (q) =>
              q
                .eq('deckId', deck._id)
                .eq('isHidden', false)
                .eq('isMastered', true)
                .eq('collectionOrigin', origin),
          )
          .order('desc')
          .take(LIBRARY_LIMIT);

      if (source === 'premade') {
        cards = await fetchOrigin('premade');
      } else if (source === 'custom') {
        const buckets = await Promise.all(
          NON_PREMADE_ORIGINS.map(fetchOrigin),
        );
        cards = mergeByLastReviewedDesc(buckets);
      } else {
        cards = await ctx.db
          .query('cards')
          .withIndex(
            'by_deckId_and_isHidden_and_isMastered_and_lastReviewedAt',
            (q) =>
              q
                .eq('deckId', deck._id)
                .eq('isHidden', false)
                .eq('isMastered', true),
          )
          .order('desc')
          .take(LIBRARY_LIMIT);
      }
    } else if (filter === 'favorites') {
      const fetchOrigin = (origin: Origin) =>
        ctx.db
          .query('cards')
          .withIndex(
            'by_deckId_isHidden_favorite_origin_lastReviewedAt',
            (q) =>
              q
                .eq('deckId', deck._id)
                .eq('isHidden', false)
                .eq('isFavorite', true)
                .eq('collectionOrigin', origin),
          )
          .order('desc')
          .take(LIBRARY_LIMIT);

      if (source === 'premade') {
        cards = await fetchOrigin('premade');
      } else if (source === 'custom') {
        const buckets = await Promise.all(
          NON_PREMADE_ORIGINS.map(fetchOrigin),
        );
        cards = mergeByLastReviewedDesc(buckets);
      } else {
        cards = await ctx.db
          .query('cards')
          .withIndex(
            'by_deckId_and_isHidden_and_isFavorite_and_lastReviewedAt',
            (q) =>
              q
                .eq('deckId', deck._id)
                .eq('isHidden', false)
                .eq('isFavorite', true),
          )
          .order('desc')
          .take(LIBRARY_LIMIT);
      }
    } else {
      // No state filter (or filter === 'hidden') — `isHidden` is the only
      // state component.
      const fetchOrigin = (origin: Origin) =>
        ctx.db
          .query('cards')
          .withIndex('by_deckId_isHidden_origin_lastReviewedAt', (q) =>
            q
              .eq('deckId', deck._id)
              .eq('isHidden', isHidden)
              .eq('collectionOrigin', origin),
          )
          .order('desc')
          .take(LIBRARY_LIMIT);

      if (source === 'premade') {
        cards = await fetchOrigin('premade');
      } else if (source === 'custom') {
        const buckets = await Promise.all(
          NON_PREMADE_ORIGINS.map(fetchOrigin),
        );
        cards = mergeByLastReviewedDesc(buckets);
      } else {
        cards = await ctx.db
          .query('cards')
          .withIndex('by_deckId_and_isHidden_and_lastReviewedAt', (q) =>
            q.eq('deckId', deck._id).eq('isHidden', isHidden),
          )
          .order('desc')
          .take(LIBRARY_LIMIT);
      }
    }

    if (cards.length === 0) {
      return [];
    }

    const texts = await Promise.all(cards.map((c) => ctx.db.get(c.textId)));

    const inputs = cards
      .map((card, i) => {
        const text = texts[i];
        if (!text) return null;
        return {
          key: String(i),
          textId: card.textId,
          sourceText: text.text,
          sourceLanguage: text.language,
          sourceRomanization: text.romanizedText ?? undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const contentMap = await buildTextContentBatchForLanguages(
      ctx,
      inputs,
      course.baseLanguages,
      course.targetLanguages,
    );

    const page = cards
      .map((card, i) => {
        const text = texts[i];
        if (!text) return null;
        const content = contentMap.get(String(i));
        if (!content) return null;

        return {
          _id: card._id,
          _creationTime: card._creationTime,
          textId: card.textId,
          sourceText: text.text,
          sourceLanguage: text.language,
          translations: content.translations,
          audioRecordings: content.audioRecordings,
          dueDate: card.dueDate,
          isMastered: card.isMastered,
          isHidden: card.isHidden,
          isFavorite: card.isFavorite,
          preReviewCount: card.preReviewCount,
          schedulingPhase: card.schedulingPhase,
          fsrsState: card.fsrsState ?? null,
          lastReviewedAt: card.lastReviewedAt,
          hasMissingContent: content.hasMissingContent,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    return page;
  },
});
