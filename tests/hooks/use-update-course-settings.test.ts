import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

type Updater = (
  localStore: {
    getQuery: (ref: unknown, args: unknown) => unknown;
    setQuery: (ref: unknown, args: unknown, value: unknown) => void;
  },
  args: Record<string, unknown>,
) => void;

const mutationFn = vi.fn();
let capturedUpdater: Updater | undefined;

vi.mock('convex/react', () => ({
  useMutation: () => ({
    withOptimisticUpdate: (updater: Updater) => {
      capturedUpdater = updater;
      return mutationFn;
    },
  }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    features: {
      courses: {
        updateCourseSettings: 'updateCourseSettings-ref',
        getActiveCourseSettings: 'getActiveCourseSettings-ref',
      },
    },
  },
}));

import { useUpdateCourseSettings } from '@/hooks/use-update-course-settings';

function fakeLocalStore(current: unknown) {
  return {
    getQuery: vi.fn(() => current),
    setQuery: vi.fn(),
  };
}

/**
 * One generic optimistic update replaces the four field-specific copies that
 * used to drift apart. Contract: spread every submitted field into the
 * active-course settings cache, EXCEPT `courseId` (a routing arg, not a
 * settings field), and never invent a cache entry before the query loaded.
 */
describe('useUpdateCourseSettings', () => {
  beforeEach(() => {
    mutationFn.mockReset();
    capturedUpdater = undefined;
  });

  it('returns the optimistically-wrapped mutation', () => {
    const { result } = renderHook(() => useUpdateCourseSettings());
    expect(result.current).toBe(mutationFn);
    expect(capturedUpdater).toBeTypeOf('function');
  });

  it('patches the cached settings, dropping courseId from the patch', () => {
    renderHook(() => useUpdateCourseSettings());
    const store = fakeLocalStore({
      dailyTimeGoalMinutes: 15,
      studyContentFilter: 'both',
    });

    capturedUpdater?.(store, {
      courseId: 'course-1',
      dailyTimeGoalMinutes: 25,
    });

    expect(store.getQuery).toHaveBeenCalledWith(
      'getActiveCourseSettings-ref',
      {},
    );
    expect(store.setQuery).toHaveBeenCalledWith(
      'getActiveCourseSettings-ref',
      {},
      { dailyTimeGoalMinutes: 25, studyContentFilter: 'both' },
    );
  });

  it.each([undefined, null])(
    'leaves the cache untouched when the query holds %s',
    (current) => {
      renderHook(() => useUpdateCourseSettings());
      const store = fakeLocalStore(current);

      capturedUpdater?.(store, {
        courseId: 'course-1',
        dailyTimeGoalMinutes: 25,
      });

      expect(store.setQuery).not.toHaveBeenCalled();
    },
  );
});
