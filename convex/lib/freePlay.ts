import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

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
 * The two faces of free play — radio (listening) and freeStudy (writing) —
 * share one round-robin mechanic: no dueDate filter, no FSRS, lowest round
 * counter plays next with a random, re-rolled tiebreak. Each face keeps its
 * OWN per-card rotation fields and indexes so the two shuffles and play
 * counts stay fully independent. Everything face-specific lives in this map;
 * the queue, advance, undo, and content-warming code is shared.
 *
 * Which face is active is derived from `reviewMode` (see `freePlayFace` in
 * convex/types.ts), never stored — free play is a single scheduling mode.
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
    // Free study has no listening-limit consumer — a fresh count from 0.
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
