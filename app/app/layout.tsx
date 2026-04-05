import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isAuthenticated, preloadAuthQuery } from '@/lib/auth-server';
import { api } from '@/convex/_generated/api';
import { AppDataProvider } from '@/components/app/AppDataProvider';
import { ClientAuthBoundary } from '@/components/ClientAuthBoundary';
import { OnboardingGuard } from '@/components/app/OnboardingGuard';
import { AuthRefresh } from '@/components/AuthRefresh';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) {
    const cookieStore = await cookies();
    const hasSessionCookie = cookieStore.has('better-auth.session_token');

    if (!hasSessionCookie) {
      redirect('/auth/sign-in');
    }

    // Session cookie exists but server auth failed (stale tab).
    // Auto-reload so the cookie gets re-validated on a fresh request.
    console.warn('[AUTH_REFRESH] Session cookie exists but server auth failed, triggering client reload', {
      timestamp: new Date().toISOString(),
    });
    return <AuthRefresh />;
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
