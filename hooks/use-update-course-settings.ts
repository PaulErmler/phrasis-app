'use client';

import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

/**
 * Wraps `updateCourseSettings` with an optimistic update that patches the
 * active-course settings cache, so every surface reading those settings. The
 * homescreen daily-goal ring, the settings sheet, the content-filter badges
 * and empty states. Reflects a change immediately instead of lagging one
 * round-trip behind the tap.
 *
 * The update spreads whatever the caller passed (minus `courseId`, which is a
 * routing arg rather than a settings field), so it covers every patchable
 * field in `coursePatchableSettingsValidator` without needing a per-field
 * variant. This deliberately replaces the field-specific copies that used to
 * exist for the daily goal and the study content filter: four near-identical
 * closures meant a fix or a new field had to be remembered in four places, and
 * the home ring could disagree with the settings sheet.
 *
 * The server is still the authority. `updateCourseSettings` clamps
 * `dailyTimeGoalMinutes` via `clampDailyGoal`, so an out-of-range optimistic
 * value is corrected on the next round trip.
 */
export function useUpdateCourseSettings() {
  return useMutation(
    api.features.courses.updateCourseSettings,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getActiveCourseSettings,
      {},
    );
    if (current === undefined || current === null) return;
    const { courseId: _courseId, ...updates } = args;
    localStore.setQuery(
      api.features.courses.getActiveCourseSettings,
      {},
      { ...current, ...updates },
    );
  });
}
