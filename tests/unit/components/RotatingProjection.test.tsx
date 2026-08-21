import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { RotatingProjection } from '@/components/app/stats/RotatingProjection';

// The component reads its data through useCachedQuery. Feed it directly.
const useCachedQueryMock = vi.fn();
vi.mock('@/hooks/use-cached-query', () => ({
  useCachedQuery: (...args: unknown[]) => useCachedQueryMock(...args),
}));

/**
 * Rotation-order semantics of the projection slot:
 *  - the variety cursor is snapshot ONCE per visit, so a live query re-emit
 *    mid-visit must not reorder the frames under the user's eyes;
 *  - a new visit (replayKey bump) picks up the advanced cursor, so repeat
 *    visitors actually see a different rotation.
 * (Regression: the cursor used to be read inside the frames memo without
 * being a dependency. Variety never applied, and any data re-emit swapped
 * the visible fact with no animation.)
 */

// Distinct kinds so the visible frame is identifiable via the stubbed
// translation keys in the button's aria-label.
const projectionData = () => ({
  today: '2026-08-03',
  basis: 'observed' as const,
  currentWords: 500,
  indicators: [
    { kind: 'sessionYield', words: 12, goalMinutes: 20 },
    { kind: 'oneYearWords', words: 2400, capped: false },
    { kind: 'sentencesPerHour', rate: 30 },
    { kind: 'studyTimeMilestone', hours: 100, etaDays: 12, etaDate: '2026-08-15' },
  ],
});

function renderSlot(replayKey: number) {
  return render(
    <RotatingProjection
      skip={false}
      replayKey={replayKey}
      hasStudiedToday={false}
      cacheSuffix="_course1"
    />,
  );
}

const currentLabel = () =>
  screen.getByTestId('rotating-projection').getAttribute('aria-label') ?? '';

describe('RotatingProjection: per-visit variety cursor', () => {
  beforeEach(() => {
    localStorage.clear();
    useCachedQueryMock.mockReset();
    useCachedQueryMock.mockReturnValue(projectionData());
  });

  it('keeps the visible frame stable when the query re-emits mid-visit', () => {
    const { rerender } = renderSlot(1);

    // hasStudiedToday=false → sessionYield leads; advance once to a rotated
    // frame (cursor 0 → server order: oneYearWords next).
    fireEvent.click(screen.getByTestId('rotating-projection'));
    expect(currentLabel()).toContain('oneYearLabel');

    // Live re-emit: fresh object identity, same visit. The mount effect
    // already bumped the STORED cursor, but this visit's snapshot must keep
    // the order. The old bug rotated the array here and swapped the fact.
    useCachedQueryMock.mockReturnValue(projectionData());
    rerender(
      <RotatingProjection
        skip={false}
        replayKey={1}
        hasStudiedToday={false}
        cacheSuffix="_course1"
      />,
    );
    expect(currentLabel()).toContain('oneYearLabel');
  });

  it('rotates the order on the next visit (replayKey bump)', () => {
    const { rerender } = renderSlot(1);
    fireEvent.click(screen.getByTestId('rotating-projection'));
    const firstVisitSecondFrame = currentLabel();
    expect(firstVisitSecondFrame).toContain('oneYearLabel');

    // New visit: idx resets to the contextual first frame and the rotation
    // starts one notch further (cursor snapshot advanced 0 → 1).
    rerender(
      <RotatingProjection
        skip={false}
        replayKey={2}
        hasStudiedToday={false}
        cacheSuffix="_course1"
      />,
    );
    expect(currentLabel()).toContain('sessionYield');
    fireEvent.click(screen.getByTestId('rotating-projection'));
    expect(currentLabel()).toContain('perStudyHourLabel');
    expect(currentLabel()).not.toBe(firstVisitSecondFrame);
  });

  it('scopes the cursor per course (cacheSuffix)', () => {
    renderSlot(1);
    // The visit effect bumped only THIS course's cursor.
    expect(localStorage.getItem('projection_slot_cursor_course1')).toBe('1');
    expect(localStorage.getItem('projection_slot_cursor_course2')).toBeNull();
  });

  it('renders the anchored pending placeholder while the query is in flight', () => {
    useCachedQueryMock.mockReturnValue(undefined);
    renderSlot(1);
    const pending = screen.getByTestId('rotating-projection-pending');
    // The home-tour step targets this anchor; without it the step degrades
    // to an unanchored popover exactly on the first visit.
    expect(pending.getAttribute('data-tutorial')).toBe('projections');
  });
});
