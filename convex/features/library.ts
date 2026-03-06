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
const LIBRARY_LIMIT = 20;

export const getLibraryCards = query({
  args: {
    searchQuery: v.optional(v.string()),
    activeFilter: activeFilterValidator,
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
    const searchQuery = args.searchQuery?.trim() ?? '';

    let cards: Doc<'cards'>[];

    if (searchQuery.length > 0) {
      cards = await ctx.db
        .query('cards')
        .withSearchIndex('search_text', (q) => {
          let sq = q.search('searchableText', searchQuery).eq('deckId', deck._id);
          if (filter === 'mastered') {
            sq = sq.eq('isHidden', false).eq('isMastered', true);
          } else if (filter === 'hidden') {
            sq = sq.eq('isHidden', true);
          } else if (filter === 'favorites') {
            sq = sq.eq('isHidden', false).eq('isFavorite', true);
          } else {
            sq = sq.eq('isHidden', false);
          }
          return sq;
        })
        .take(LIBRARY_LIMIT);
    } else {
      cards = await ctx.db
        .query('cards')
        .withIndex('by_deckId_and_lastReviewedAt', (q) =>
          q.eq('deckId', deck._id),
        )
        .order('desc')
        .filter((q) => {
          if (filter === 'mastered') {
            return q.and(
              q.eq(q.field('isHidden'), false),
              q.eq(q.field('isMastered'), true),
            );
          }
          if (filter === 'hidden') {
            return q.eq(q.field('isHidden'), true);
          }
          if (filter === 'favorites') {
            return q.and(
              q.eq(q.field('isHidden'), false),
              q.eq(q.field('isFavorite'), true),
            );
          }
          // default: all non-hidden
          return q.eq(q.field('isHidden'), false);
        })
        .take(LIBRARY_LIMIT);
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
