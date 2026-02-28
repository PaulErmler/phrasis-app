import { api } from '@/convex/_generated/api';
import { preloadAuthQuery } from '@/lib/auth-server';
import { AppPageClient } from './AppPageClient';

export default async function AppPage() {
  const [
    preloadedSettings,
    preloadedActiveCourse,
    preloadedCollectionProgress,
    preloadedCourseSettings,
  ] = await Promise.all([
    preloadAuthQuery(api.features.courses.getUserSettings),
    preloadAuthQuery(api.features.courses.getActiveCourse),
    preloadAuthQuery(api.features.decks.getCollectionProgress),
    preloadAuthQuery(api.features.courses.getActiveCourseSettings),
  ]);

  return (
    <AppPageClient
      preloadedSettings={preloadedSettings}
      preloadedActiveCourse={preloadedActiveCourse}
      preloadedCollectionProgress={preloadedCollectionProgress}
      preloadedCourseSettings={preloadedCourseSettings}
    />
  );
}
