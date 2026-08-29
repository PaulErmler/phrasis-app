import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DueCountsPills } from '@/components/app/DueCountsPills';
import {
  formatCappedCount,
  mergedDueCount,
  REVIEWS_CAP,
} from '@/lib/constants/dueCounts';

/**
 * The merged due count (learning + relearning + review) and its display
 * ceiling. Two surfaces show the same number — the home pills here and
 * learning mode's StatePill — and both now render the SAME shared functions
 * (lib/constants/dueCounts), so the rule itself is tested once as pure
 * functions below instead of exercising each surface's private copy.
 */

const useQueryMock = vi.fn();
let userSettingsValue: { hideDueCounts?: boolean } | null = {};
vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  usePreloadedQuery: () => userSettingsValue,
}));

vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({
    courseSettings: { studyContentFilter: 'both', reviewMode: 'full' },
    preloadedSettings: {},
  }),
}));

vi.mock('@/hooks/use-now-minute', () => ({
  useNowMinute: () => 1_755_000_000_000,
}));

// The global stub drops params; the pill text IS the params, so re-mock.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params && 'count' in params ? `${params.count} ${key}` : key,
}));

const counts = (overrides: Partial<Record<string, number>> = {}) => ({
  new: 3,
  learning: 2,
  relearning: 1,
  review: 4,
  ...overrides,
});

beforeEach(() => {
  useQueryMock.mockReset();
  // Pills show only on an explicit opt-in; most cases below assert on the
  // rendered pills, so opt in by default and test the hidden states below.
  userSettingsValue = { hideDueCounts: false };
});

describe('DueCountsPills', () => {
  it('merges learning + relearning + review into the review pill', () => {
    useQueryMock.mockReturnValue(counts());
    render(<DueCountsPills />);
    expect(screen.getByText('3 new')).toBeTruthy();
    expect(screen.getByText('7 review')).toBeTruthy();
  });

  it('caps the merged number at REVIEWS_CAP', () => {
    useQueryMock.mockReturnValue(
      counts({ learning: 30, relearning: 20, review: 100 }),
    );
    render(<DueCountsPills />);
    expect(screen.getByText(`${REVIEWS_CAP}+ review`)).toBeTruthy();
  });

  it('shows the exact count at the cap itself', () => {
    useQueryMock.mockReturnValue(
      counts({ learning: 0, relearning: 0, review: REVIEWS_CAP }),
    );
    render(<DueCountsPills />);
    expect(screen.getByText(`${REVIEWS_CAP} review`)).toBeTruthy();
  });

  it('renders nothing and skips the counts query when hideDueCounts is on', () => {
    userSettingsValue = { hideDueCounts: true };
    useQueryMock.mockReturnValue(counts());
    render(<DueCountsPills />);
    expect(screen.queryByTestId('due-counts-pills')).toBeNull();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), 'skip');
  });

  it('hides by default: unset preference renders nothing (show is an opt-in)', () => {
    userSettingsValue = {};
    useQueryMock.mockReturnValue(counts());
    render(<DueCountsPills />);
    expect(screen.queryByTestId('due-counts-pills')).toBeNull();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), 'skip');
  });
});

describe('mergedDueCount / formatCappedCount (the shared rule both surfaces render)', () => {
  it('merges the three review states', () => {
    expect(mergedDueCount({ learning: 3, relearning: 2, review: 5 })).toBe(10);
  });

  it('caps past REVIEWS_CAP with a trailing plus', () => {
    expect(formatCappedCount(150)).toBe(`${REVIEWS_CAP}+`);
  });

  it('shows the exact value at or below the cap', () => {
    expect(formatCappedCount(REVIEWS_CAP)).toBe(String(REVIEWS_CAP));
    expect(formatCappedCount(7)).toBe('7');
  });
});
