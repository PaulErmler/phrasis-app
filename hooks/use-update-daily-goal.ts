import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

/**
 * Wraps `updateCourseSettings` with an optimistic update that patches the
 * active-course settings cache so the daily-goal indicator (homescreen ring,
 * settings row) reflects the new goal immediately instead of lagging one
 * round-trip behind the tap. Mirrors `use-update-study-content-filter.ts`.
 */
export function useUpdateDailyGoal() {
  return useMutation(
    api.features.courses.updateCourseSettings,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getActiveCourseSettings,
      {},
    );
    if (current && args.dailyTimeGoalMinutes !== undefined) {
      localStore.setQuery(
        api.features.courses.getActiveCourseSettings,
        {},
        { ...current, dailyTimeGoalMinutes: args.dailyTimeGoalMinutes },
      );
    }
  });
}
