import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type {
  SchedulingMode,
  SchedulingTrack,
  StudyContentFilter,
} from '../types';
import { originsForFilter } from './collections';

type Origin = ReturnType<typeof originsForFilter>[number];

/**
 * The four index queries one scheduling track's due queue draws from:
 * unfiltered / learn_new-only, each with an origin-keyed variant for the
 * content-source filter. Kept as per-track literals so each `withIndex`
 * chain stays fully typed; everything ABOVE the index lookup — the
 * mode/filter branching, the per-origin fan-out, the merge-sort, the
 * truncation — lives once in `fetchTrackDueCards` and cannot drift between
 * tracks (the same reason `fetchFreePlayRotation` was hoisted for the
 * free-play faces).
 *
 * Writing-track ranges all start at `.gte('writingDueDate', 0)`: cards
 * without a seeded writing track have `writingDueDate` undefined, which
 * sorts BEFORE all numbers in the index and would otherwise be served as
 * due. They surface once the enable-time seeding sweep reaches them (see
 * convex/migrations/seedWritingTrack.ts).
 */
type TrackDueQueries = {
  /** The due timestamp the merge-sort orders by. */
  dueOf: (card: Doc<'cards'>) => number;
  both: (
    ctx: QueryCtx,
    deckId: Id<'decks'>,
    now: number,
    take: number,
  ) => Promise<Doc<'cards'>[]>;
  learnNew: (
    ctx: QueryCtx,
    deckId: Id<'decks'>,
    now: number,
    take: number,
  ) => Promise<Doc<'cards'>[]>;
  origin: (
    ctx: QueryCtx,
    deckId: Id<'decks'>,
    origin: Origin,
    now: number,
    take: number,
  ) => Promise<Doc<'cards'>[]>;
  originLearnNew: (
    ctx: QueryCtx,
    deckId: Id<'decks'>,
    origin: Origin,
    now: number,
    take: number,
  ) => Promise<Doc<'cards'>[]>;
};

const TRACK_DUE_QUERIES: Record<SchedulingTrack, TrackDueQueries> = {
  shared: {
    dueOf: (card) => card.dueDate,
    both: (ctx, deckId, now, take) =>
      ctx.db
        .query('cards')
        .withIndex('by_deckId_and_isHidden_and_isMastered_and_dueDate', (q) =>
          q
            .eq('deckId', deckId)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(take),
    learnNew: (ctx, deckId, now, take) =>
      ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_graduated_due', (q) =>
          q
            .eq('deckId', deckId)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('isGraduated', false)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(take),
    origin: (ctx, deckId, origin, now, take) =>
      ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_origin_dueDate', (q) =>
          q
            .eq('deckId', deckId)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('collectionOrigin', origin)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(take),
    originLearnNew: (ctx, deckId, origin, now, take) =>
      ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_origin_graduated_due', (q) =>
          q
            .eq('deckId', deckId)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('collectionOrigin', origin)
            .eq('isGraduated', false)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(take),
  },
  writing: {
    // `?? 0` is unreachable in practice — every range below bounds
    // writingDueDate to numbers — but keeps the sort total.
    dueOf: (card) => card.writingDueDate ?? 0,
    both: (ctx, deckId, now, take) =>
      ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_writingDue', (q) =>
          q
            .eq('deckId', deckId)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .gte('writingDueDate', 0)
            .lte('writingDueDate', now),
        )
        .order('asc')
        .take(take),
    learnNew: (ctx, deckId, now, take) =>
      ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_writingGraduated_writingDue', (q) =>
          q
            .eq('deckId', deckId)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('writingIsGraduated', false)
            .gte('writingDueDate', 0)
            .lte('writingDueDate', now),
        )
        .order('asc')
        .take(take),
    origin: (ctx, deckId, origin, now, take) =>
      ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_origin_writingDue', (q) =>
          q
            .eq('deckId', deckId)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('collectionOrigin', origin)
            .gte('writingDueDate', 0)
            .lte('writingDueDate', now),
        )
        .order('asc')
        .take(take),
    originLearnNew: (ctx, deckId, origin, now, take) =>
      ctx.db
        .query('cards')
        .withIndex(
          'by_deck_hidden_mastered_origin_writingGraduated_writingDue',
          (q) =>
            q
              .eq('deckId', deckId)
              .eq('isHidden', false)
              .eq('isMastered', false)
              .eq('collectionOrigin', origin)
              .eq('writingIsGraduated', false)
              .gte('writingDueDate', 0)
              .lte('writingDueDate', now),
        )
        .order('asc')
        .take(take),
  },
};

/**
 * Fetch the top-K due cards of one scheduling track, honoring the
 * content-source filter. Filter semantics:
 *   - 'both'   : single unfiltered index query.
 *   - 'course' : single origin-keyed query with origin='premade'.
 *   - 'custom' : two origin-keyed queries (origin='custom' and origin='chat')
 *                merged by due date.
 *
 * Taking `take` from EACH origin before the merge makes the truncation safe:
 * the global top-`take` cannot contain a card that wasn't in its own
 * origin's top-`take`. The tiebreak on `_creationTime` mirrors Convex's
 * default index ordering, so the filtered and unfiltered paths agree.
 *
 * Shared by the serving path (`getCardForReview`), the empty-reason probe,
 * and the content warmer (`getUpcomingCardsForMode` in decks.ts) so all
 * three always draw from the same population. Free play never comes through
 * here — it serves from `fetchFreePlayRotation`.
 */
export async function fetchTrackDueCards(
  ctx: QueryCtx,
  deckId: Id<'decks'>,
  schedulingMode: SchedulingMode,
  filter: StudyContentFilter,
  track: SchedulingTrack,
  now: number,
  take: number,
): Promise<Doc<'cards'>[]> {
  const queries = TRACK_DUE_QUERIES[track];
  const learnNew = schedulingMode === 'learn_new';
  if (filter === 'both') {
    return learnNew
      ? queries.learnNew(ctx, deckId, now, take)
      : queries.both(ctx, deckId, now, take);
  }

  const allowedOrigins = originsForFilter(filter);
  const perOriginResults = await Promise.all(
    allowedOrigins.map((origin) =>
      learnNew
        ? queries.originLearnNew(ctx, deckId, origin, now, take)
        : queries.origin(ctx, deckId, origin, now, take),
    ),
  );

  const merged = perOriginResults.flat();
  merged.sort((a, b) => {
    const aDue = queries.dueOf(a);
    const bDue = queries.dueOf(b);
    if (aDue !== bDue) return aDue - bDue;
    return a._creationTime - b._creationTime;
  });
  return merged.slice(0, take);
}
