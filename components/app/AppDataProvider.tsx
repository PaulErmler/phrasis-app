'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Preloaded, usePreloadedQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';

export interface AppData {
  preloadedSettings: Preloaded<typeof api.features.courses.getUserSettings>;
  preloadedActiveCourse: Preloaded<
    typeof api.features.courses.getActiveCourse
  >;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedHomeSummary: Preloaded<typeof api.features.home.getHomeSummary>;
}

export interface AppDataValue extends AppData {
  /** Live active course. The subscription is owned HERE — the one component
   *  that stays mounted across the onboarding → home soft navigation —
   *  because the server preload is snapshotted on the initial hard load
   *  (before onboarding creates the course) and Next.js never re-runs it on
   *  soft nav. A consumer that mounts fresh (e.g. the home layout) and
   *  subscribed on its own would render that stale `null` for a frame and
   *  flash the no-course empty state; reading the always-warm value from
   *  context instead means the course is present by the time home mounts. */
  activeCourse: FunctionReturnType<typeof api.features.courses.getActiveCourse>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({
  children,
  preloadedSettings,
  preloadedActiveCourse,
  preloadedCourseSettings,
  preloadedHomeSummary,
}: AppData & { children: ReactNode }) {
  // Safe above ClientAuthBoundary: getActiveCourse returns null (never
  // throws) while unauthenticated, then streams the real value once auth
  // and course creation land.
  const activeCourse = usePreloadedQuery(preloadedActiveCourse);
  const value = useMemo(
    () => ({
      preloadedSettings,
      preloadedActiveCourse,
      preloadedCourseSettings,
      preloadedHomeSummary,
      activeCourse,
    }),
    [
      preloadedSettings,
      preloadedActiveCourse,
      preloadedCourseSettings,
      preloadedHomeSummary,
      activeCourse,
    ],
  );
  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
