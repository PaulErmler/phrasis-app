import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useCardThreadRotation } from '@/hooks/use-card-thread-rotation';

/**
 * The learn view rotates its chat thread when the served card changes, except
 * for the change a chat "replace" caused (Path B re-inserts the card doc, so
 * accepting a proposal changes the card's `_id`). The comments in the hook
 * record two bugs that lived in this exact spot, so each is pinned below.
 */
function setup(initialCardId: string | null = 'card_1') {
  const rotate = vi.fn(async () => undefined);
  const view = renderHook(
    ({ cardId }: { cardId: string | null }) =>
      useCardThreadRotation(cardId, rotate),
    { initialProps: { cardId: initialCardId } },
  );
  return { rotate, ...view };
}

describe('useCardThreadRotation', () => {
  it('rotates on a normal card advance once the thread has messages', () => {
    const { rotate, result, rerender } = setup();
    act(() => result.current.markThreadHasMessages());
    rerender({ cardId: 'card_2' });
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it('does not rotate when the thread is still empty', () => {
    const { rotate, rerender } = setup();
    rerender({ cardId: 'card_2' });
    expect(rotate).not.toHaveBeenCalled();
  });

  it('rotates only once per card change, not on re-renders with the same card', () => {
    const { rotate, result, rerender } = setup();
    act(() => result.current.markThreadHasMessages());
    rerender({ cardId: 'card_2' });
    rerender({ cardId: 'card_2' });
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it('keeps the thread for the card a replace produced', () => {
    const { rotate, result, rerender } = setup();
    act(() => result.current.markThreadHasMessages());
    act(() => result.current.handleCardReplaced('card_2' as never));
    rerender({ cardId: 'card_2' });
    // The conversation the user just accepted from survives.
    expect(rotate).not.toHaveBeenCalled();
  });

  it('suppression is keyed to the replacement id, a different card still rotates', () => {
    const { rotate, result, rerender } = setup();
    act(() => result.current.markThreadHasMessages());
    act(() => result.current.handleCardReplaced('card_replacement' as never));
    // A rating-driven advance lands on some OTHER card: the old wall-clock
    // window would have eaten the arm here and left the next card attached to
    // the previous card's transcript.
    rerender({ cardId: 'card_2' });
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it('consumes the expectation exactly once (the card after a replace rotates)', () => {
    const { rotate, result, rerender } = setup();
    act(() => result.current.markThreadHasMessages());
    act(() => result.current.handleCardReplaced('card_2' as never));
    rerender({ cardId: 'card_2' });
    expect(rotate).not.toHaveBeenCalled();

    act(() => result.current.markThreadHasMessages());
    rerender({ cardId: 'card_3' });
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it('a suppressed replace still clears the has-messages flag boundary correctly', () => {
    const { rotate, result, rerender } = setup();
    act(() => result.current.markThreadHasMessages());
    act(() => result.current.handleCardReplaced('card_2' as never));
    rerender({ cardId: 'card_2' });
    // The thread was kept, so its messages are still there: the NEXT genuine
    // advance must rotate without needing another markThreadHasMessages.
    rerender({ cardId: 'card_3' });
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it('resetThreadMessages suppresses the next rotation (explicit new chat)', () => {
    const { rotate, result, rerender } = setup();
    act(() => result.current.markThreadHasMessages());
    act(() => result.current.resetThreadMessages());
    rerender({ cardId: 'card_2' });
    expect(rotate).not.toHaveBeenCalled();
  });

  it('ignores the transition out of and back into a null card id', () => {
    const { rotate, result, rerender } = setup(null);
    act(() => result.current.markThreadHasMessages());
    // First real card: baseline only, never a rotation.
    rerender({ cardId: 'card_1' });
    expect(rotate).not.toHaveBeenCalled();
    rerender({ cardId: null });
    expect(rotate).not.toHaveBeenCalled();
    // Same card again after the gap, not a change.
    rerender({ cardId: 'card_1' });
    expect(rotate).not.toHaveBeenCalled();
  });

  it('swallows a rotation failure instead of throwing into the render tree', async () => {
    const rotate = vi.fn(async () => {
      throw new Error('boom');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = renderHook(
      ({ cardId }: { cardId: string | null }) =>
        useCardThreadRotation(cardId, rotate),
      { initialProps: { cardId: 'card_1' as string | null } },
    );
    act(() => result.current.markThreadHasMessages());
    await act(async () => {
      rerender({ cardId: 'card_2' });
    });
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
