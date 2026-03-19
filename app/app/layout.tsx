import { redirect } from 'next/navigation';
import { isAuthenticated, preloadAuthQuery } from '@/lib/auth-server';
import { api } from '@/convex/_generated/api';
import { AppDataProvider } from '@/components/app/AppDataProvider';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) {
    redirect('/auth/sign-in');
  }

  const [
    preloadedSettings,
    preloadedActiveCourse,
    preloadedCourseSettings,
    preloadedCollectionProgress,
    preloadedCustomCollectionsProgress,
  ] = await Promise.all([
    preloadAuthQuery(api.features.courses.getUserSettings),
    preloadAuthQuery(api.features.courses.getActiveCourse),
    preloadAuthQuery(api.features.courses.getActiveCourseSettings),
    preloadAuthQuery(api.features.decks.getCollectionProgress),
    preloadAuthQuery(api.features.decks.getCustomCollectionsProgress),
  ]);

  return (
    <AppDataProvider
      preloadedSettings={preloadedSettings}
      preloadedActiveCourse={preloadedActiveCourse}
      preloadedCourseSettings={preloadedCourseSettings}
      preloadedCollectionProgress={preloadedCollectionProgress}
      preloadedCustomCollectionsProgress={preloadedCustomCollectionsProgress}
    >
      {children}
    </AppDataProvider>
  );
}
