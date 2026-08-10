import { v } from 'convex/values';
import { query } from '../_generated/server';
import { Doc } from '../_generated/dataModel';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getDeckByCourseId } from '../db/decks';
import { buildTextContentBatchForLanguages } from '../lib/cardContent';
import { cardOriginPillFields } from '../lib/collections';
import { searchSegments } from '../../lib/wordTokenize';
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
  // Source-collection shorthand ("A1.2"), origin bucket, and CEFR tier (the
  // pill's color key), for the optional card-origin pill. Null for cards
  // whose collection can't be resolved.
  collectionLabel: v.union(v.string(), v.null()),
  collectionOrigin: v.union(
    v.literal('premade'),
    v.literal('custom'),
    v.literal('chat'),
    v.null(),
  ),
  collectionCefrTier: v.union(v.string(), v.null()),
});

/**
 * Library query with optional full-text search and an exclusive filter
 * selection. Returns up to `LIBRARY_LIMIT` cards in one shot — no pagination.
 *
 * activeFilter:
 *   undefined  → all non-hidden cards (default)
 *   'mastered' → only mastered non-hidden cards
 *   'hidden'   → only hidden cards
 *   'favorites'→ only favorited non-hidden cards
 */
const LIBRARY_LIMIT = 100;

// Convex full-text search accepts at most 16 terms per query.
export const MAX_SEARCH_TERMS = 16;

/**
 * Mirror of the index-side CJK/Thai segmentation (see
 * `buildCardSearchableText`): for course languages written without word
 * boundaries, append the query's Intl.Segmenter word tokens so a
 * mid-sentence CJK query matches the segmented tokens in the index — the
 * raw query would otherwise be one giant token Convex can't match infix.
 */
export function augmentSearchQuery(
  searchQuery: string,
  courseLanguages: string[],
): string {
  // Budget against Convex's own tokenization of the raw query, which splits
  // on punctuation as well as whitespace — a plain `/\s+/` count undercounts
  // queries like `私は、学生ですか？` and the augmented query would exceed the
  // 16-term cap, which makes the search throw instead of returning results.
  //
  // `\p{M}` is load-bearing: combining marks (Devanagari matras, Thai tone
  // marks, niqqud, harakat) are neither letters nor digits, so without it a
  // mark counts as a SEPARATOR — मैं counts as two terms and, once the
  // truncation below rebuilds the query from these pieces, is emitted as the
  // bare consonant म. That shreds every abugida and pointed-abjad query into
  // fragments that match nothing.
  const baseTerms = searchQuery.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);

  // A raw query can itself exceed the cap (a pasted 20-word sentence), which
  // makes the search throw rather than return partial results. Truncate to
  // the first MAX_SEARCH_TERMS terms — but keep going, so a query that still
  // has room gets its CJK segments appended instead of being returned bare.
  const overCap = baseTerms.length > MAX_SEARCH_TERMS;
  const keptTerms = overCap ? baseTerms.slice(0, MAX_SEARCH_TERMS) : baseTerms;
  // Under the cap the ORIGINAL string is preserved verbatim (punctuation and
  // all) — only an over-cap query is rebuilt from its terms.
  const base = overCap ? keptTerms.join(' ') : searchQuery;

  const seen = new Set(keptTerms);
  const extra: string[] = [];
  for (const lang of new Set(courseLanguages)) {
    for (const original of searchSegments(searchQuery, lang)) {
      if (!seen.has(original)) {
        seen.add(original);
        extra.push(original);
      }
    }
  }
  const room = MAX_SEARCH_TERMS - keptTerms.length;
  if (room <= 0 || extra.length === 0) return base;
  return [base, ...extra.slice(0, room)].join(' ');
}

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

    // Resolves the source dimension for a state branch: 'premade' is a single
    // origin-scoped fetch, 'custom' merges the non-premade origin buckets on
    // the server, and no source filter falls through to the origin-agnostic
    // fetch.
    const bySource = async (
      fetchOrigin: (origin: Origin) => Promise<Doc<'cards'>[]>,
      fetchAll: () => Promise<Doc<'cards'>[]>,
    ): Promise<Doc<'cards'>[]> => {
      if (source === 'premade') {
        return fetchOrigin('premade');
      }
      if (source === 'custom') {
        const buckets = await Promise.all(
          NON_PREMADE_ORIGINS.map((o) => fetchOrigin(o)),
        );
        return mergeByLastReviewedDesc(buckets);
      }
      return fetchAll();
    };

    let cards: Doc<'cards'>[];

    if (searchQuery.length > 0) {
      const augmentedQuery = augmentSearchQuery(searchQuery, [
        ...course.baseLanguages,
        ...course.targetLanguages,
      ]);
      const runSearch = (originValue?: Origin) =>
        ctx.db
          .query('cards')
          .withSearchIndex('search_text', (q) => {
            let sq = q
              .search('searchableText', augmentedQuery)
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

      // Search results are returned in relevance order; the lastReviewedAt
      // re-sort in the 'custom' merge matches the ordering used by the
      // non-search branches so the library list is consistent regardless of
      // which path served the query.
      cards = await bySource(
        (o) => runSearch(o),
        () => runSearch(),
      );
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

      cards = await bySource(fetchOrigin, () =>
        ctx.db
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
          .take(LIBRARY_LIMIT),
      );
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

      cards = await bySource(fetchOrigin, () =>
        ctx.db
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
          .take(LIBRARY_LIMIT),
      );
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

      cards = await bySource(fetchOrigin, () =>
        ctx.db
          .query('cards')
          .withIndex('by_deckId_and_isHidden_and_lastReviewedAt', (q) =>
            q.eq('deckId', deck._id).eq('isHidden', isHidden),
          )
          .order('desc')
          .take(LIBRARY_LIMIT),
      );
    }

    if (cards.length === 0) {
      return [];
    }

    const texts = await Promise.all(cards.map((c) => ctx.db.get(c.textId)));

    // Source collections for the card-origin pill — one point read per
    // distinct collection (a page has few: the levels + custom/chat).
    const collectionIds = [
      ...new Set(
        cards.flatMap((c) => (c.collectionId ? [c.collectionId] : [])),
      ),
    ];
    const collectionDocs = await Promise.all(
      collectionIds.map((id) => ctx.db.get(id)),
    );
    const collectionById = new Map(
      collectionIds.map((id, i) => [id, collectionDocs[i]]),
    );

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
          userCreated: text.userCreated,
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

        const collection = card.collectionId
          ? (collectionById.get(card.collectionId) ?? null)
          : null;

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
          ...cardOriginPillFields(collection),
          collectionOrigin: card.collectionOrigin ?? collection?.origin ?? null,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    return page;
  },
});
