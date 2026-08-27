import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CumulativeLineChart } from '@/components/app/stats/CumulativeLineChart';

// Recharts' ResponsiveContainer needs a ResizeObserver; jsdom has none.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

// Smoke coverage: mount with a small realistic dataset, assert the control
// chrome and the has-data/no-data branch. Recharts geometry is not asserted;
// jsdom gives ResponsiveContainer no real size.

/** Today as "YYYY-MM-DD" in UTC, matching the component's day-range keys. */
function todayUtc(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(
    new Date(),
  );
}

describe('CumulativeLineChart smoke', () => {
  it('renders the header, range and metric switches, and a chart for a non-empty series', () => {
    const { container } = render(
      <CumulativeLineChart
        dailyData={[
          { date: todayUtc(), reps: 12, newCards: 4, timeMs: 90_000 },
        ]}
        monthlyData={[]}
        weeklyData={[]}
        timezone="UTC"
      />,
    );

    // Header + switch rows (next-intl stub returns the keys).
    expect(screen.getByText('progress')).toBeInTheDocument();
    for (const range of ['week', 'month', 'year']) {
      expect(screen.getByRole('button', { name: range })).toBeInTheDocument();
    }
    for (const metric of [
      'metric.words',
      'metric.reviews',
      'metric.sentences',
      'metric.time',
    ]) {
      expect(screen.getByRole('button', { name: metric })).toBeInTheDocument();
    }

    // Default view (words, month) accumulates today's newCards → chart mounts.
    expect(container.querySelector('[data-slot="chart"]')).toBeInTheDocument();
    expect(screen.queryByText('noData')).not.toBeInTheDocument();
  });

  it('shows the empty state when the cumulative series stays at zero', () => {
    const { container } = render(
      <CumulativeLineChart
        dailyData={[]}
        monthlyData={[]}
        weeklyData={[]}
        timezone="UTC"
      />,
    );

    expect(screen.getByText('noData')).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="chart"]'),
    ).not.toBeInTheDocument();
  });
});
