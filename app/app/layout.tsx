import { preloadAuthQuery } from '@/lib/auth-server';
import { api } from '@/convex/_generated/api';
import { AppDataProvider } from '@/components/app/AppDataProvider';
import { ClientAuthBoundary } from '@/components/ClientAuthBoundary';
import { OnboardingGuard } from '@/components/app/OnboardingGuard';
import { BillingGate } from '@/components/app/BillingGate';

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
    <AppDataProvider
      preloadedSettings={preloadedSettings}
      preloadedActiveCourse={preloadedActiveCourse}
      preloadedCourseSettings={preloadedCourseSettings}
      preloadedHomeSummary={preloadedHomeSummary}
    >
      <ClientAuthBoundary>
        {/* Sibling of OnboardingGuard, not a child: the guard renders null
            for its children while redirecting, which would unmount the gate
            (and its quota sync) mid-navigation. */}
        <BillingGate />
        <OnboardingGuard>
          {children}
        </OnboardingGuard>
      </ClientAuthBoundary>
    </AppDataProvider>
  );
}
