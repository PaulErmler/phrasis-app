import { ConvexHttpClient } from 'convex/browser';
import { redirect } from 'next/navigation';
import { isAuthenticated, preloadAuthQuery } from '@/lib/auth-server';
import { api } from '@/convex/_generated/api';
import { env } from '@/lib/env';
import { AppDataProvider } from '@/components/app/AppDataProvider';
import { ClientAuthBoundary } from '@/components/ClientAuthBoundary';
import { OnboardingGuard } from '@/components/app/OnboardingGuard';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) {
    try {
      const http = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
      await http.mutation(api.authRedirectLog.logAuthRedirect, {
        source: 'layout',
      });
    } catch {
      // Still redirect; logging is best-effort.
    }
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
      <ClientAuthBoundary>
        <OnboardingGuard>
          {children}
        </OnboardingGuard>
      </ClientAuthBoundary>

    </AppDataProvider>
  );
}
