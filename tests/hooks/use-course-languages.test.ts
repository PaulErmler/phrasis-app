import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('convex/react', () => ({
  usePreloadedQuery: (v: any) => v,
}));

const useAppDataMock = vi.fn();
vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => useAppDataMock(),
}));

import { useCourseLanguages } from '@/hooks/use-course-languages';

describe('useCourseLanguages', () => {
  it('returns languages from active course', () => {
    useAppDataMock.mockReturnValue({
      preloadedActiveCourse: {
        baseLanguages: ['en'],
        targetLanguages: ['es', 'fr'],
      },
    });
    const { result } = renderHook(() => useCourseLanguages());
    expect(result.current).toEqual({
      baseLanguages: ['en'],
      targetLanguages: ['es', 'fr'],
    });
  });

  it('returns empty arrays when no active course', () => {
    useAppDataMock.mockReturnValue({ preloadedActiveCourse: null });
    const { result } = renderHook(() => useCourseLanguages());
    expect(result.current).toEqual({ baseLanguages: [], targetLanguages: [] });
  });
});
