import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DueCountsPills } from '@/components/app/DueCountsPills';
import { StatePill } from '@/components/app/learning/ProgressDisplay';
import { REVIEWS_CAP } from '@/lib/constants/dueCounts';

/**
 * The merged due count (learning + relearning + review) and its display
 * ceiling. Two surfaces show the same number — the home pills here and
 * learning mode's StatePill — and both must merge the three states and cap
 * at REVIEWS_CAP, or they disagree exactly when the number is largest.
 */

const useQueryMock = vi.fn();
vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({
    courseSettings: { studyContentFilter: 'both', reviewMode: 'full' },
  }),
}));

vi.mock('@/hooks/use-now-minute', () => ({
  useNowMinute: () => 1_755_000_000_000,
}));

// The global stub drops params; the pill text IS the params, so re-mock.
vi.mock('next-intl', () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, unknown>) =>
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
});

describe('StatePill (learning-mode surface)', () => {
  it('caps at the same ceiling with the same rendering', () => {
    render(
      <StatePill
        label="review"
        value={150}
        colorClass="text-success"
        cap={REVIEWS_CAP}
      />,
    );
    expect(screen.getByText(`${REVIEWS_CAP}+`)).toBeTruthy();
  });

  it('shows the exact value at or below the cap', () => {
    render(
      <StatePill
        label="review"
        value={REVIEWS_CAP}
        colorClass="text-success"
        cap={REVIEWS_CAP}
      />,
    );
    expect(screen.getByText(String(REVIEWS_CAP))).toBeTruthy();
  });
});
