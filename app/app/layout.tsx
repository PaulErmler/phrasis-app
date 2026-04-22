import { preloadAuthQuery } from '@/lib/auth-server';
import { api } from '@/convex/_generated/api';
import { AppDataProvider } from '@/components/app/AppDataProvider';
import { ClientAuthBoundary } from '@/components/ClientAuthBoundary';
import { OnboardingGuard } from '@/components/app/OnboardingGuard';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <ClientAuthBoundary>
        <OnboardingGuard>
          {children}
        </OnboardingGuard>
      </ClientAuthBoundary>
    </AppDataProvider>
  );
}
