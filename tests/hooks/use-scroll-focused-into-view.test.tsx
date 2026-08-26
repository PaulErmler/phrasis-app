import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useScrollFocusedIntoView } from '@/hooks/use-scroll-focused-into-view';

/**
 * Horizontal-only "scroll into view if needed": the rail nudges its
 * scrollLeft just enough to expose the focused chip, and it must leave the
 * rail alone when the chip is already fully visible (the old always-center
 * behavior shifted the rail on every selection).
 */
function Rail({ focusedId }: { focusedId: string | null }) {
  const railRef = useScrollFocusedIntoView(focusedId);
  return (
    <div data-testid="rail" ref={railRef}>
      {['a', 'b', 'c'].map((id) => (
        <span key={id} data-chip={id} data-focused={focusedId === id} />
      ))}
    </div>
  );
}

type Edges = { left: number; right: number };

const rect = ({ left, right }: Edges): DOMRect => ({
  left,
  right,
  top: 0,
  bottom: 0,
  width: right - left,
  height: 0,
  x: left,
  y: 0,
  toJSON: () => ({}),
});

/**
 * Mount unfocused, install rect/scroll stubs (jsdom has neither layout nor
 * Element#scrollTo), then focus chip "b" so the effect runs with them live.
 */
function setup(chipEdges: Edges, railEdges: Edges = { left: 100, right: 300 }) {
  const view = render(<Rail focusedId={null} />);
  const rail = view.getByTestId('rail');
  const chip = rail.querySelector('[data-chip="b"]');
  if (!(chip instanceof HTMLElement)) throw new Error('chip not rendered');

  rail.getBoundingClientRect = () => rect(railEdges);
  chip.getBoundingClientRect = () => rect(chipEdges);
  const scrollTo = vi.fn<(opts: ScrollToOptions) => void>();
  Object.defineProperty(rail, 'scrollTo', {
    value: scrollTo,
    configurable: true,
    writable: true,
  });

  view.rerender(<Rail focusedId="b" />);
  return { scrollTo, rerender: view.rerender };
}

describe('useScrollFocusedIntoView', () => {
  it('scrolls left just enough when the focused chip sticks out on the left', () => {
    const { scrollTo } = setup({ left: 40, right: 80 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // scrollLeft (0) + (chip.left − rail.left) = −60.
    expect(scrollTo).toHaveBeenCalledWith({ left: -60, behavior: 'smooth' });
  });

  it('scrolls right just enough when the focused chip sticks out on the right', () => {
    const { scrollTo } = setup({ left: 320, right: 380 });
    // scrollLeft (0) + (chip.right − rail.right) = 80.
    expect(scrollTo).toHaveBeenCalledWith({ left: 80, behavior: 'smooth' });
  });

  it('leaves the rail alone when the chip is already fully visible', () => {
    const { scrollTo } = setup({ left: 150, right: 200 });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('no-ops when no descendant is marked focused', () => {
    const { scrollTo, rerender } = setup({ left: 150, right: 200 });
    // "zzz" matches no chip → querySelector finds nothing → early return.
    rerender(<Rail focusedId="zzz" />);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
