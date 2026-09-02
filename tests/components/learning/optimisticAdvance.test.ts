import { describe, it, expect } from 'vitest';
import type { OptimisticLocalStore } from 'convex/browser';
import type { Id } from '@/convex/_generated/dataModel';
import { advanceToNextCardOptimistic } from '@/components/app/learning/optimisticAdvance';

/**
 * The optimistic half of "advance to the next card": every cached
 * getCardForReview instance showing the advanced card flips to its own
 * nextCard preview, so the UI moves before the server answers.
 */

type Card = Record<string, unknown> & { _id: string };

function card(id: string, extra: Record<string, unknown> = {}): Card {
  return { _id: id, sourceText: `text ${id}`, ...extra };
}

function fakeStore(
  instances: { args: Record<string, unknown>; value: unknown }[],
) {
  const writes: { args: Record<string, unknown>; value: unknown }[] = [];
  const store = {
    getAllQueries: () => instances,
    setQuery: (_ref: unknown, args: Record<string, unknown>, value: unknown) =>
      writes.push({ args, value }),
    getQuery: () => undefined,
  } as unknown as OptimisticLocalStore;
  return { store, writes };
}

const CARD_1 = 'card-1' as Id<'cards'>;

describe('advanceToNextCardOptimistic', () => {
  it('swaps every instance showing the card to its nextCard, leaves the preview unknown, and bumps the counters', () => {
    const shown = card('card-1', {
      nextCard: card('card-2'),
      dailyReviewsToday: 3,
      undoableCount: 2,
    });
    const { store, writes } = fakeStore([
      { args: { timezone: 'UTC', now: 1 }, value: shown },
      { args: { timezone: 'UTC', now: 2 }, value: shown },
    ]);

    advanceToNextCardOptimistic(store, CARD_1, { countsAsReview: true });

    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.args.now)).toEqual([1, 2]);
    expect(writes[0].value).toEqual({
      _id: 'card-2',
      sourceText: 'text card-2',
      dailyReviewsToday: 4,
      undoableCount: 3,
    });
    // Unknown, not "none": `null` is the server's last-card signal that
    // pre-adds the next batch, and must not fire on every advance.
    expect(writes[0].value).not.toHaveProperty('nextCard');
  });

  it('bumps undoableCount but not dailyReviewsToday for a free-play advance', () => {
    const { store, writes } = fakeStore([
      {
        args: {},
        value: card('card-1', {
          nextCard: card('card-2'),
          dailyReviewsToday: 3,
          undoableCount: 0,
        }),
      },
    ]);

    advanceToNextCardOptimistic(store, CARD_1, { countsAsReview: false });

    expect(writes[0].value).toMatchObject({
      _id: 'card-2',
      dailyReviewsToday: 3,
      undoableCount: 1,
    });
  });

  it('writes nothing when there is no next card (one-card deck, deck about to empty)', () => {
    const { store, writes } = fakeStore([
      { args: {}, value: card('card-1', { nextCard: null }) },
    ]);
    advanceToNextCardOptimistic(store, CARD_1, { countsAsReview: true });
    expect(writes).toHaveLength(0);
  });

  it('leaves instances that show a different card, or nothing, alone', () => {
    const { store, writes } = fakeStore([
      { args: {}, value: card('card-9', { nextCard: card('card-2') }) },
      { args: {}, value: null },
      { args: {}, value: undefined },
    ]);
    advanceToNextCardOptimistic(store, CARD_1, { countsAsReview: true });
    expect(writes).toHaveLength(0);
  });
});
