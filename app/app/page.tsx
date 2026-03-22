import { api } from '@/convex/_generated/api';
import { preloadAuthQuery } from '@/lib/auth-server';
import { AppPageClient } from './AppPageClient';

export default async function AppPage() {
  const [
    preloadedSettings,
    preloadedActiveCourse,
    preloadedCollectionProgress,
    preloadedCourseSettings,
    preloadedCourseStats,
  ] = await Promise.all([
    preloadAuthQuery(api.features.courses.getUserSettings),
    preloadAuthQuery(api.features.courses.getActiveCourse),
    preloadAuthQuery(api.features.decks.getCollectionProgress),
    preloadAuthQuery(api.features.courses.getActiveCourseSettings),
    preloadAuthQuery(api.features.courses.getCourseStats),
  ]);

  return (
    <AppPageClient
      preloadedSettings={preloadedSettings}
      preloadedActiveCourse={preloadedActiveCourse}
      preloadedCollectionProgress={preloadedCollectionProgress}
      preloadedCourseSettings={preloadedCourseSettings}
      preloadedCourseStats={preloadedCourseStats}
    />
  );
}
