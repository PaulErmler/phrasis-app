import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// The hook reads `useQuery(api.usage.queries.getMyQuotas)`; drive that value
// directly so we can exercise each branch without a Convex backend.
const useQueryMock = vi.fn();
vi.mock('convex/react', () => ({
  useQuery: () => useQueryMock(),
}));

import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';

const FEATURE = 'multiple_languages';

describe('useFeatureQuota', () => {
  beforeEach(() => useQueryMock.mockReset());

  it('stays optimistic while the query is in flight (undefined)', () => {
    useQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() => useFeatureQuota(FEATURE));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAvailable).toBe(true);
  });

  it('stays optimistic before any quota doc is synced (null)', () => {
    useQueryMock.mockReturnValue(null);
    const { result } = renderHook(() => useFeatureQuota(FEATURE));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAvailable).toBe(true);
  });

  // Regression: a free user's synced doc simply omits un-granted boolean
  // features. The hook must report that as unavailable (mirroring the backend
  // `hasFeatureAccess`), not as the optimistic loading fallback.
  it('reports an un-granted feature as unavailable once the doc is loaded', () => {
    useQueryMock.mockReturnValue({ features: {}, lastSyncedAt: 1 });
    const { result } = renderHook(() => useFeatureQuota(FEATURE));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAvailable).toBe(false);
  });

  it('reports a granted boolean feature (unlimited) as available', () => {
    useQueryMock.mockReturnValue({
      features: {
        [FEATURE]: { balance: 1, included: 1, used: 0, unlimited: true },
      },
      lastSyncedAt: 1,
    });
    const { result } = renderHook(() => useFeatureQuota(FEATURE));
    expect(result.current.isAvailable).toBe(true);
  });

  it('gates a metered feature on its balance', () => {
    useQueryMock.mockReturnValue({
      features: { sentences: { balance: 5, included: 150, used: 145 } },
      lastSyncedAt: 1,
    });
    expect(
      renderHook(() => useFeatureQuota('sentences')).result.current.isAvailable,
    ).toBe(true);

    useQueryMock.mockReturnValue({
      features: { sentences: { balance: 0, included: 150, used: 150 } },
      lastSyncedAt: 1,
    });
    expect(
      renderHook(() => useFeatureQuota('sentences')).result.current.isAvailable,
    ).toBe(false);
  });
});
