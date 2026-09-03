import type { OptimisticLocalStore } from 'convex/browser';
import type { Id } from '@/convex/_generated/dataModel';
import { api } from '@/convex/_generated/api';

/**
 * Optimistic update shared by the two "advance to the next card" mutations
 * (`reviewCard`, `advanceFreePlayCard`): swap every cached `getCardForReview`
 * result that currently shows `cardId` to its own `nextCard` preview, so the
 * card view, the audio hook and the rest of the reviewing state move in the
 * same render as the tap (or the end of the audio), not after the server
 * round-trip.
 *
 * The swap is safe because the server serves `nextCard` next in every mode.
 * A rated card is always rescheduled into the future (pre-review intervals,
 * FSRS learning steps for "again") while `nextCard` was already due, and in
 * free play the played card lands strictly above the floor card, which is
 * `nextCard`. If the server disagrees anyway (another tab advanced, a filter
 * changed) its answer replaces this one on arrival, and Convex rolls the
 * write back when the mutation fails.
 *
 * `nextCard` is left out (unknown) of the optimistic result, NOT set to
 * `null`: the server payload brings the fresh preview and the audio prefetch
 * waits for it, while `null` is the server's own "nothing else is due"
 * signal that triggers the pre-add of the next batch (useLearningMode). A
 * null here would fire that add on every single advance. `undoableCount`
 * rises for both mutations (both log an undoable entry); `dailyReviewsToday`
 * only for a real review, which is what the progress bar counts.
 */
export function advanceToNextCardOptimistic(
  localStore: OptimisticLocalStore,
  cardId: Id<'cards'>,
  opts: { countsAsReview: boolean },
): void {
  // Every cached instance: the args carry timezone + a minute-quantized
  // `now`, so the key varies (same pattern as `toggleFavoriteCard`).
  for (const q of localStore.getAllQueries(
    api.features.scheduling.getCardForReview,
  )) {
    const current = q.value;
    if (current == null || current._id !== cardId || !current.nextCard) {
      continue;
    }
    localStore.setQuery(api.features.scheduling.getCardForReview, q.args, {
      ...current.nextCard,
      dailyReviewsToday:
        current.dailyReviewsToday + (opts.countsAsReview ? 1 : 0),
      undoableCount: current.undoableCount + 1,
    });
  }
}
