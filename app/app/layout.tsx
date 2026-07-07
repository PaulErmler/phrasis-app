import { preloadAuthQuery } from '@/lib/auth-server';
import { api } from '@/convex/_generated/api';
import { AppDataProvider } from '@/components/app/AppDataProvider';
import { AppWarmup } from '@/components/app/AppWarmup';
import { ClientAuthBoundary } from '@/components/ClientAuthBoundary';
import { OnboardingGuard } from '@/components/app/OnboardingGuard';
import { ScopedMessages } from '@/components/i18n/ScopedMessages';
import { APP_NAMESPACES, SHARED_NAMESPACES } from '@/i18n/namespaces';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [
    preloadedSettings,
    preloadedActiveCourse,
    preloadedCourseSettings,
    preloadedHomeSummary,
  ] = await Promise.all([
    preloadAuthQuery(api.features.courses.getUserSettings),
    preloadAuthQuery(api.features.courses.getActiveCourse),
    preloadAuthQuery(api.features.courses.getActiveCourseSettings),
    preloadAuthQuery(api.features.home.getHomeSummary),
  ]);

  return (
    <ScopedMessages namespaces={[...SHARED_NAMESPACES, ...APP_NAMESPACES]}>
      <AppDataProvider
        preloadedSettings={preloadedSettings}
        preloadedActiveCourse={preloadedActiveCourse}
        preloadedCourseSettings={preloadedCourseSettings}
        preloadedHomeSummary={preloadedHomeSummary}
      >
        <ClientAuthBoundary>
          <OnboardingGuard>
            <AppWarmup>
              {children}
            </AppWarmup>
          </OnboardingGuard>
        </ClientAuthBoundary>
      </AppDataProvider>
    </ScopedMessages>
  );
}
