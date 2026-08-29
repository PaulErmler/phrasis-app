import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WorkloadForecastCard } from '@/components/app/forecast/WorkloadForecastCard';
import type { UseWorkloadForecastResult } from '@/hooks/use-workload-forecast';

// The global stub drops params; the labels ARE the params here, so re-mock
// with a deterministic "key values…" rendering.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
  useLocale: () => 'en',
}));

vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({ courseSettings: { dailyTimeGoalMinutes: 20 } }),
}));

const forecastResult = vi.fn<() => UseWorkloadForecastResult>();
vi.mock('@/hooks/use-workload-forecast', () => ({
  useWorkloadForecast: () => forecastResult(),
}));

// The chart is exercised by WorkloadStackedCard.test.tsx; here it only has
// to be identifiable as "the unlocked content rendered".
vi.mock('@/components/app/forecast/WorkloadStackedCard', () => ({
  WorkloadStackedCard: () => <div data-testid="workload-chart" />,
}));

const baseResult = (
  overrides: Partial<UseWorkloadForecastResult> = {},
): UseWorkloadForecastResult => ({
  forecast: null,
  data: null,
  whatIfDelta: { reviews: 0, minutes: 0 },
  hidden: false,
  locked: false,
  isProvisional: false,
  reviewMode: 'audio',
  addCount: 5,
  setAddCount: vi.fn(),
  ...overrides,
});

/** Minimal forecast shape for the summary row (only the fields it reads). */
const stubForecast = () =>
  ({
    days: [{ estimatedMinutes: 12, scheduled: { total: 8 } }],
    weekMinutes: 40,
  }) as unknown as UseWorkloadForecastResult['forecast'];

beforeEach(() => {
  forecastResult.mockReset();
  localStorage.clear();
});

describe('WorkloadForecastCard', () => {
  it('renders the locked teaser instead of a chart below the activity gate', () => {
    forecastResult.mockReturnValue(baseResult({ locked: true }));
    render(<WorkloadForecastCard />);

    expect(screen.getByText('locked')).toBeTruthy();
    expect(screen.queryByTestId('workload-chart')).toBeNull();
    // Nothing to open yet: the locked card is not a disclosure.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the tour anchor and testid while locked', () => {
    forecastResult.mockReturnValue(baseResult({ locked: true }));
    render(<WorkloadForecastCard />);

    const card = screen.getByTestId('workload-forecast');
    expect(card.getAttribute('data-tutorial')).toBe('workload-forecast');
  });

  it('shows the collapsed summary once unlocked', () => {
    forecastResult.mockReturnValue(
      baseResult({
        locked: false,
        forecast: stubForecast(),
        data: { today: '2026-08-26' } as never,
      }),
    );
    render(<WorkloadForecastCard />);

    expect(screen.queryByText('locked')).toBeNull();
    expect(screen.getByText(/approxToday/)).toBeTruthy();
    expect(screen.getByText(/thisWeek 40m/)).toBeTruthy();
    // Collapsed by default: the trigger exists, the chart is not mounted.
    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.queryByTestId('workload-chart')).toBeNull();
  });

  it('holds the skeleton rather than flashing the lock while loading', () => {
    forecastResult.mockReturnValue(baseResult({ locked: null }));
    render(<WorkloadForecastCard />);

    expect(screen.queryByText('locked')).toBeNull();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('renders nothing when the user hid the card', () => {
    forecastResult.mockReturnValue(baseResult({ hidden: true, locked: true }));
    const { container } = render(<WorkloadForecastCard />);
    expect(container.firstChild).toBeNull();
  });
});
