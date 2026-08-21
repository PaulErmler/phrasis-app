import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { FreePlayFace, StudyContentFilter } from '../types';
import { originsForFilter } from './collections';

type CardOrigin = 'premade' | 'custom' | 'chat';

/**
 * The rotation-head fetchers shared by both faces: lowest round counter
 * first, random order-key tiebreak, no dueDate filter. Only the index name
 * differs per face (each face has its own counter/order fields baked into
 * its index pair).
 */
function fetchRotation(
  ctx: QueryCtx,
  deckId: Id<'decks'>,
  index:
    | 'by_deck_hidden_mastered_radioCounter_radioOrder'
    | 'by_deck_hidden_mastered_studyCounter_studyOrder',
  take: number,
) {
  return ctx.db
    .query('cards')
    .withIndex(index, (q) =>
      q.eq('deckId', deckId).eq('isHidden', false).eq('isMastered', false),
    )
    .order('asc')
    .take(take);
}

function fetchRotationByOrigin(
  ctx: QueryCtx,
  deckId: Id<'decks'>,
  index:
    | 'by_deck_hidden_mastered_origin_radioCounter_radioOrder'
    | 'by_deck_hidden_mastered_origin_studyCounter_studyOrder',
  origin: CardOrigin,
  take: number,
) {
  return ctx.db
    .query('cards')
    .withIndex(index, (q) =>
      q
        .eq('deckId', deckId)
        .eq('isHidden', false)
        .eq('isMastered', false)
        .eq('collectionOrigin', origin),
    )
    .order('asc')
    .take(take);
}

/**
 * The two faces of free play. Radio (listening) and freeStudy (writing).
 * Share one round-robin mechanic: no dueDate filter, no FSRS, lowest round
 * counter plays next with a random, re-rolled tiebreak. Each face keeps its
 * OWN per-card rotation fields and indexes so the two shuffles and play
 * counts stay fully independent. Everything face-specific lives in this map;
 * the queue, advance, undo, and content-warming code is shared.
 *
 * Which face is active is derived from `reviewMode` (see `freePlayFace` in
 * convex/types.ts), never stored. Free play is a single scheduling mode.
 */
export const FREE_PLAY_MODES = {
  radio: {
    counterField: 'radioRoundCounter',
    orderField: 'radioOrderKey',
    playCountField: 'radioPlayCount',
    fetch: (ctx: QueryCtx, deckId: Id<'decks'>, take: number) =>
      fetchRotation(
        ctx,
        deckId,
        'by_deck_hidden_mastered_radioCounter_radioOrder',
        take,
      ),
    fetchByOrigin: (
      ctx: QueryCtx,
      deckId: Id<'decks'>,
      origin: CardOrigin,
      take: number,
    ) =>
      fetchRotationByOrigin(
        ctx,
        deckId,
        'by_deck_hidden_mastered_origin_radioCounter_radioOrder',
        origin,
        take,
      ),
    // Radio seeds the play count from the card's review count for cards that
    // predate the field, so the "Only new" Practice-Listening limit doesn't
    // reset an already-practiced card to "new".
    playCountSeed: (card: Doc<'cards'>) =>
      card.preReviewCount + (card.fsrsState?.reps ?? 0),
    /** Pre-play rotation snapshot for the review log's undo stack. */
    logSnapshot: (card: Doc<'cards'>) => ({
      prevRadio: {
        radioRoundCounter: card.radioRoundCounter,
        radioOrderKey: card.radioOrderKey,
        radioPlayCount: card.radioPlayCount,
        lastReviewedAt: card.lastReviewedAt,
      },
    }),
    /** Card patch restoring the snapshot, or null if the log is malformed. */
    undoPatch: (log: Doc<'reviewLogs'>): Partial<Doc<'cards'>> | null =>
      log.prevRadio
        ? {
            radioRoundCounter: log.prevRadio.radioRoundCounter,
            radioOrderKey: log.prevRadio.radioOrderKey,
            radioPlayCount: log.prevRadio.radioPlayCount,
            lastReviewedAt: log.prevRadio.lastReviewedAt,
          }
        : null,
  },
  freeStudy: {
    counterField: 'freeStudyRoundCounter',
    orderField: 'freeStudyOrderKey',
    playCountField: 'freeStudyPlayCount',
    fetch: (ctx: QueryCtx, deckId: Id<'decks'>, take: number) =>
      fetchRotation(
        ctx,
        deckId,
        'by_deck_hidden_mastered_studyCounter_studyOrder',
        take,
      ),
    fetchByOrigin: (
      ctx: QueryCtx,
      deckId: Id<'decks'>,
      origin: CardOrigin,
      take: number,
    ) =>
      fetchRotationByOrigin(
        ctx,
        deckId,
        'by_deck_hidden_mastered_origin_studyCounter_studyOrder',
        origin,
        take,
      ),
    // Free study has no listening-limit consumer. A fresh count from 0.
    playCountSeed: (_card: Doc<'cards'>) => 0,
    logSnapshot: (card: Doc<'cards'>) => ({
      prevFreeStudy: {
        freeStudyRoundCounter: card.freeStudyRoundCounter,
        freeStudyOrderKey: card.freeStudyOrderKey,
        freeStudyPlayCount: card.freeStudyPlayCount,
        lastReviewedAt: card.lastReviewedAt,
      },
    }),
    undoPatch: (log: Doc<'reviewLogs'>): Partial<Doc<'cards'>> | null =>
      log.prevFreeStudy
        ? {
            freeStudyRoundCounter: log.prevFreeStudy.freeStudyRoundCounter,
            freeStudyOrderKey: log.prevFreeStudy.freeStudyOrderKey,
            freeStudyPlayCount: log.prevFreeStudy.freeStudyPlayCount,
            lastReviewedAt: log.prevFreeStudy.lastReviewedAt,
          }
        : null,
  },
} as const;

/**
 * The head of a face's rotation, honouring the study content filter. The
 * single definition of "which cards free play serves next".
 *
 * Both the serving queue (features/scheduling.ts) and the content warmer
 * (features/decks.ts `getUpcomingCardsForMode`) MUST go through this. They used
 * to pick their own: the warmer called the unfiltered `fetch` while the queue
 * routed through `fetchByOrigin`, so for any user on a 'course' or 'custom'
 * filter the warmed set and the served set were different cards and free play
 * handed out cards with no pre-generated translation or audio.
 *
 * For a filtered read the per-origin index queries are merged in memory and
 * re-sorted on (counter, orderKey, _creationTime), the same ordering the
 * single-index path gets for free. Then truncated to `take`. Taking `take`
 * from EACH origin before the merge is what makes the truncation safe: the
 * global top-`take` cannot contain a card that wasn't in its own origin's
 * top-`take`.
 */
export async function fetchFreePlayRotation(
  ctx: QueryCtx,
  deckId: Id<'decks'>,
  face: FreePlayFace,
  filter: StudyContentFilter,
  take: number,
): Promise<Doc<'cards'>[]> {
  const cfg = FREE_PLAY_MODES[face];
  if (filter === 'both') {
    return cfg.fetch(ctx, deckId, take);
  }
  const allowedOrigins = originsForFilter(filter);
  const perOrigin = await Promise.all(
    allowedOrigins.map((origin) => cfg.fetchByOrigin(ctx, deckId, origin, take)),
  );
  const merged = perOrigin.flat();
  merged.sort((a, b) => {
    const ca = a[cfg.counterField] ?? 0;
    const cb = b[cfg.counterField] ?? 0;
    if (ca !== cb) return ca - cb;
    const oa = a[cfg.orderField] ?? Number.POSITIVE_INFINITY;
    const ob = b[cfg.orderField] ?? Number.POSITIVE_INFINITY;
    if (oa !== ob) return oa - ob;
    return a._creationTime - b._creationTime;
  });
  return merged.slice(0, take);
}

/**
 * A fresh, uniform-random integer used as the free-play (radio / free-study)
 * rotation tiebreak. Re-rolled on every advance so each round-robin loop
 * visits cards in a different order. After the first full loop, the order is
 * also fully decoupled from review's `dueDate`-driven sequence; for decks
 * that pre-date the field, every card starts with an `undefined` order key
 * and the very first loop falls back to `_creationTime` order until each
 * card has been played once. 32-bit space gives collision-free tiebreaking
 * in any plausible deck size.
 *
 * Lives here rather than in features/scheduling.ts so card-creation paths
 * (features/decks.ts) can stamp an initial key without importing from a
 * sibling feature module.
 */
export function randomOrderKey(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
