import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  WorkloadStackedCard,
  type WorkloadUnit,
} from '@/components/app/forecast/WorkloadStackedCard';
import {
  buildWorkloadForecast,
  WHAT_IF_ADD_MAX,
  type DayStateCounts,
  type WorkloadForecastData,
} from '@/lib/workloadForecast';

// The global stub drops params; the labels ARE the params, so re-mock with a
// deterministic "key values…" rendering.
vi.mock('next-intl', () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${Object.values(params).join(' ')}` : key,
  useLocale: () => 'en',
}));

const zero = (): DayStateCounts => ({
  new: 0,
  learning: 0,
  relearning: 0,
  review: 0,
});

function makeData(
  overrides: Partial<WorkloadForecastData> = {},
): WorkloadForecastData {
  return {
    today: '2026-08-26',
    dayStartMs: Date.UTC(2026, 7, 26),
    availableNow: { new: 2, learning: 6, relearning: 0, review: 4 },
    laterToday: { new: 0, learning: 2, relearning: 0, review: 6 },
    futureDays: [
      { new: 0, learning: 6, relearning: 0, review: 8 },
      { new: 0, learning: 4, relearning: 0, review: 7 },
      { new: 0, learning: 7, relearning: 0, review: 9 },
      { new: 0, learning: 3, relearning: 0, review: 6 },
      { new: 0, learning: 2, relearning: 0, review: 4 },
      { new: 0, learning: 1, relearning: 0, review: 3 },
    ],
    history: {
      windowDays: 14,
      activeDays: 10,
      reps: 200,
      cardsReviewed: 160,
      newCards: 50,
      timeMs: 50 * 60_000,
      reviewsByMode: { audio: 180, full: 20 },
      timeMsByMode: { audio: 40 * 60_000, full: 10 * 60_000 },
      ratingCounts: {
        stillLearning: 10,
        understood: 10,
        again: 12,
        hard: 10,
        good: 70,
        easy: 8,
      },
    },
    initialReviewCount: 5,
    ...overrides,
  };
}

function renderCard(
  data = makeData(),
  {
    addCount = 5,
    unit = 'time',
    onAddCountChange = vi.fn(),
  }: {
    addCount?: number;
    unit?: WorkloadUnit;
    onAddCountChange?: (n: number) => void;
  } = {},
) {
  const forecast = buildWorkloadForecast(data, {
    addCount,
    includeTypicalAdds: false,
    reviewMode: 'audio',
  });
  render(
    <WorkloadStackedCard
      forecast={forecast}
      today={data.today}
      unit={unit}
      addCount={addCount}
      onAddCountChange={onAddCountChange}
      whatIfDelta={{ reviews: 17, minutes: 6 }}
    />,
  );
  return { forecast, onAddCountChange };
}

describe('WorkloadStackedCard', () => {
  it('renders one labeled column per forecast day, today first', () => {
    renderCard();
    const columns = screen.getAllByRole('img');
    expect(columns).toHaveLength(7);
    expect(columns[0].getAttribute('aria-label')).toContain('dayAria today');
    expect(screen.getByText('today')).toBeTruthy();
  });

  it('time-first: minute cap on today, card counts as sub-labels', () => {
    const { forecast } = renderCard();
    expect(
      screen.getByText(`${forecast.days[0].estimatedMinutes}m`),
    ).toBeTruthy();
    const day0Cards =
      forecast.days[0].scheduled.total + forecast.days[0].estimated.total;
    expect(
      screen.getAllByText(`cardsShort ${day0Cards}`).length,
    ).toBeGreaterThan(0);
  });

  it('cards-first: count caps and minute sub-labels', () => {
    const data = makeData();
    const { forecast } = renderCard(data, { unit: 'cards' });
    const day0Cards =
      forecast.days[0].scheduled.total + forecast.days[0].estimated.total;
    expect(screen.getByText(String(day0Cards))).toBeTruthy();
    expect(
      screen.getAllByText(`≈${forecast.days[0].estimatedMinutes}m`).length,
    ).toBeGreaterThan(0);
  });

  it('shows the overdue badge only when there is a backlog', () => {
    renderCard();
    expect(screen.getByText(/overdueTime/)).toBeTruthy();
  });

  it('hides the overdue badge without a backlog', () => {
    renderCard(makeData({ availableNow: zero() }));
    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it('stepper steps and clamps at both ends', () => {
    const onAddCountChange = vi.fn();
    renderCard(makeData(), { addCount: 5, onAddCountChange });
    fireEvent.click(screen.getByLabelText('stepperMore'));
    expect(onAddCountChange).toHaveBeenCalledWith(6);
    fireEvent.click(screen.getByLabelText('stepperFewer'));
    expect(onAddCountChange).toHaveBeenCalledWith(4);
  });

  it('disables the upper stepper button at the max', () => {
    renderCard(makeData(), { addCount: WHAT_IF_ADD_MAX });
    expect(
      (screen.getByLabelText('stepperMore') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText('stepperFewer') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('what-if note and legend follow the stepper value', () => {
    renderCard(makeData(), { addCount: 5 });
    expect(screen.getByText(/whatIfNote 17/)).toBeTruthy();
    expect(screen.getByText('legendWhatIf 5')).toBeTruthy();
  });

  it('zero adds shows the hint and drops the what-if legend', () => {
    renderCard(makeData(), { addCount: 0 });
    expect(screen.getByText('whatIfHint')).toBeTruthy();
    expect(screen.queryByText(/legendWhatIf/)).toBeNull();
  });

  it('renders the pace line from history, and drops it without one', () => {
    renderCard();
    expect(screen.getByText(/paceLine/)).toBeTruthy();

    const noHistory = makeData();
    noHistory.history = {
      ...noHistory.history,
      activeDays: 0,
      reps: 0,
      timeMs: 0,
    };
    renderCard(noHistory, { addCount: 0 });
    expect(screen.queryAllByText(/paceLine/)).toHaveLength(1); // only the first render's
  });

  it('renders the empty state when nothing is scheduled or estimated', () => {
    renderCard(
      makeData({
        availableNow: zero(),
        laterToday: zero(),
        futureDays: Array.from({ length: 6 }, zero),
      }),
      { addCount: 0 },
    );
    expect(screen.getByText('empty')).toBeTruthy();
  });
});
