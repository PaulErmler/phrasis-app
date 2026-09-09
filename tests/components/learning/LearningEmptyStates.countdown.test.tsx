import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NoCardsDueState } from '@/components/app/learning/LearningEmptyStates';

/**
 * A user asked for this screen to say WHEN, not just that nothing is due
 * ("Is the next review due in 1 minute or 10 minutes or tomorrow? Should I
 * close the program?"). These pin the three things that answer them: the line
 * appears, it says the right thing, and it never displaces copy that was
 * carrying information of its own.
 */

// The global stub in tests/setup.ts collapses `t(key, values)` to just the key,
// which would hide the countdown text itself. Keep the values.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}|${JSON.stringify(values)}` : key,
  useFormatter: () => ({
    dateTime: (d: Date) => `clock(${d.toISOString()})`,
  }),
}));
vi.mock('@/components/feature_tracking/FeatureBadge', () => ({
  FeatureBadge: () => null,
}));
vi.mock('@/lib/timezone', () => ({ getUserTimezone: () => 'Europe/Berlin' }));

const BASE = new Date('2026-09-09T02:00:00.000Z').getTime(); // 04:00 Berlin
const MINUTE_MS = 60_000;

const renderState = (props: Partial<Parameters<typeof NoCardsDueState>[0]>) =>
  render(
    <NoCardsDueState
      onAddCards={vi.fn()}
      isAddingCards={false}
      batchSize={10}
      onCreateChatCards={vi.fn()}
      onCreateCustomCards={vi.fn()}
      {...props}
    />,
  );

const countdown = () => screen.queryByTestId('next-review-countdown');

describe('NoCardsDueState next-review countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces the generic caught-up subtitle', () => {
    // "All caught up! Add more sentences to continue learning." says nothing the
    // Add button below it doesn't, so the countdown takes the slot.
    renderState({ nextDueDate: BASE + 3 * 60 * MINUTE_MS });
    expect(countdown()).toBeTruthy();
    expect(screen.queryByText('empty.allDone')).toBeNull();
    // The title still states what happened.
    expect(screen.getByText('empty.noCardsDue')).toBeTruthy();
  });

  it('keeps the manual add button', () => {
    // The one action on this screen that works while nothing is due.
    renderState({ nextDueDate: BASE + 3 * 60 * MINUTE_MS });
    expect(screen.getByTestId('empty-add-cards')).toBeTruthy();
  });

  it('falls back to the caught-up subtitle when nothing is scheduled', () => {
    // Learn-new mode with every card graduated: nothing will ever come due, and
    // "add more sentences" really is the answer.
    renderState({ nextDueDate: null });
    expect(countdown()).toBeNull();
    expect(screen.getByText('empty.allDone')).toBeTruthy();
  });

  it('adds a line to the filter-blocked state instead of replacing its copy', () => {
    // That subtitle names which filter is hiding what, which a wait time is no
    // substitute for.
    renderState({
      activeFilter: 'custom',
      currentSourceHasAnyCards: true,
      nextDueDate: BASE + 3 * 60 * MINUTE_MS,
    });
    expect(countdown()).toBeTruthy();
    expect(
      screen.getByText('empty.filterBlocked.subtitleCanUnblockCustom'),
    ).toBeTruthy();
  });

  it('stays out of the empty-deck state', () => {
    renderState({ isDeckEmpty: true });
    expect(countdown()).toBeNull();
    expect(screen.getByText('empty.noCardsInDeck')).toBeTruthy();
  });

  it('counts down to when the card is served, not to its raw due instant', () => {
    // Due dates are scattered over the first minute of a study day, and the due
    // queue is bounded by a minute-floored `now`, so a card due at 04:00:37 only
    // arrives at 04:01. Counting to the raw instant would read '37s' and then
    // sit at zero with nothing on screen.
    renderState({ nextDueDate: BASE + 37_000 });
    expect(countdown()?.textContent).toContain('"time":"1m"');
  });

  it('names the relative time only for a short wait', () => {
    renderState({ nextDueDate: BASE + 12 * MINUTE_MS });
    const text = countdown()?.textContent ?? '';
    expect(text).toContain('nextReview|');
    expect(text).toContain('"time":"12m"');
    expect(text).not.toContain('clock');
  });

  it('adds the clock time for a wait measured in hours', () => {
    // 04:00 Berlin + 14h23m lands the same evening.
    renderState({ nextDueDate: BASE + 14 * 60 * MINUTE_MS + 23 * MINUTE_MS });
    const text = countdown()?.textContent ?? '';
    expect(text).toContain('empty.nextReviewToday|');
    expect(text).toContain('"time":"14h 23m"');
    expect(text).toContain('clock(');
  });

  it('says tomorrow when the wait crosses local midnight', () => {
    // 04:00 Berlin plus 24h is the next day's study-day start.
    renderState({ nextDueDate: BASE + 24 * 60 * MINUTE_MS });
    expect(countdown()?.textContent).toContain('empty.nextReviewTomorrow|');
  });

  it('ticks the seconds down in the last minute', async () => {
    renderState({ nextDueDate: BASE + 45_000 });
    // Target is the 04:01 minute boundary, so 60s remain at 04:00:00.
    expect(countdown()?.textContent).toContain('"time":"1m"');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(countdown()?.textContent).toContain('"time":"59s"');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(countdown()?.textContent).toContain('"time":"58s"');
  });
});
