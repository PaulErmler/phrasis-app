import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

/**
 * Wraps `updateCourseSettings` with an optimistic update that patches the
 * active-course settings cache so `studyContentFilter`-driven UI (tab
 * badges, learning-mode empty state) reflects the new value immediately.
 *
 * Used by every surface that toggles the content-source filter; without
 * this the badge/empty-state copy lags one round-trip behind the click.
 */
export function useUpdateStudyContentFilter() {
  return useMutation(
    api.features.courses.updateCourseSettings,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getActiveCourseSettings,
      {},
    );
    if (current && args.studyContentFilter !== undefined) {
      localStore.setQuery(
        api.features.courses.getActiveCourseSettings,
        {},
        { ...current, studyContentFilter: args.studyContentFilter },
      );
    }
  });
}
