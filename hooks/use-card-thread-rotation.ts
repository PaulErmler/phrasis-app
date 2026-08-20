import { useCallback, useEffect, useRef } from 'react';
import type { Id } from '@/convex/_generated/dataModel';

export interface UseCardThreadRotationReturn {
  /** Call when the user sends a message, so the next card change rotates. */
  markThreadHasMessages: () => void;
  /** Reset the "has messages" flag (an explicit new-chat action). */
  resetThreadMessages: () => void;
  /**
   * Report the card id a successful "replace" left behind. The ONE upcoming
   * change to that id keeps its thread; everything else rotates.
   */
  handleCardReplaced: (replacementId: Id<'cards'>) => void;
}

/**
 * Rotate the learn view's chat thread when the served card changes, except
 * for the card change a chat "replace" itself caused.
 *
 * `applyCardEdit` Path B deletes and re-inserts the card document, so
 * accepting an also-correct proposal changes the served card's `_id` and would
 * otherwise rotate to a fresh thread, wiping the very conversation the user
 * just accepted from.
 *
 * The expectation holds the REPLACEMENT'S id, so suppression fires for exactly
 * that one card change and nothing else. An earlier version armed a 5-second
 * wall-clock window instead, which was wrong twice over: it was also armed for
 * "approve" (which only inserts a text into the chat collection and never
 * changes the served card, so the arm was never consumed), and a genuine
 * rating-driven advance inside the window then ate it, leaving the NEXT card
 * attached to the previous card's conversation, with markAlsoCorrect closed
 * over the new card's id against the old card's transcript. A rating-driven
 * advance can never land on the replacement's id, so keying on identity has no
 * false positives and needs no timeout.
 */
export function useCardThreadRotation(
  currentCardId: string | null,
  rotateThread: () => Promise<unknown>,
): UseCardThreadRotationReturn {
  const threadHasMessagesRef = useRef(false);
  const prevCardIdRef = useRef<string | null>(null);
  const expectedCardIdRef = useRef<string | null>(null);

  const handleCardReplaced = useCallback((replacementId: Id<'cards'>) => {
    expectedCardIdRef.current = replacementId;
  }, []);

  useEffect(() => {
    if (!currentCardId) return;
    if (prevCardIdRef.current === null) {
      prevCardIdRef.current = currentCardId;
      return;
    }
    if (prevCardIdRef.current === currentCardId) return;

    prevCardIdRef.current = currentCardId;

    // Only the card a replace just produced keeps its thread. Any other card
    // change clears the expectation and rotates normally.
    if (expectedCardIdRef.current !== null) {
      const isReplacement = expectedCardIdRef.current === currentCardId;
      expectedCardIdRef.current = null;
      if (isReplacement) return;
    }

    if (threadHasMessagesRef.current) {
      threadHasMessagesRef.current = false;
      rotateThread().catch((err) =>
        console.error('Failed to create new thread on card change:', err),
      );
    }
  }, [currentCardId, rotateThread]);

  const markThreadHasMessages = useCallback(() => {
    threadHasMessagesRef.current = true;
  }, []);
  const resetThreadMessages = useCallback(() => {
    threadHasMessagesRef.current = false;
  }, []);

  return { markThreadHasMessages, resetThreadMessages, handleCardReplaced };
}
