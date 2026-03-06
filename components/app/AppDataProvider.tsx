'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';

export interface AppData {
  preloadedSettings: Preloaded<typeof api.features.courses.getUserSettings>;
  preloadedActiveCourse: Preloaded<
    typeof api.features.courses.getActiveCourse
  >;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedCollectionProgress: Preloaded<
    typeof api.features.decks.getCollectionProgress
  >;
  preloadedCourseStats: Preloaded<
    typeof api.features.courses.getCourseStats
  >;
  preloadedCustomCollectionsProgress: Preloaded<
    typeof api.features.decks.getCustomCollectionsProgress
  >;
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({
  children,
  ...data
}: AppData & { children: ReactNode }) {
  return (
    <AppDataContext.Provider value={data}>{children}</AppDataContext.Provider>
  );
}

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
