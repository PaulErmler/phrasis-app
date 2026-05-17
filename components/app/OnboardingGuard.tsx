'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { usePreloadedQuery } from 'convex/react';
import { useAppData } from '@/components/app/AppDataProvider';

/**
 * Bounces unauthenticated-onto-app and not-yet-onboarded routes back to
 * `/app/onboarding`. The flicker that used to happen right after the user
 * finished onboarding — `/app` would briefly redirect back to
 * `/app/onboarding` before the wizard's `router.push('/app')` took effect —
 * is prevented at the mutation site: `finalizeOnboarding` carries a
 * `withOptimisticUpdate` that flips `getUserSettings.hasCompletedOnboarding`
 * to `true` in the local query cache the moment the user clicks Finish.
 * That update is visible synchronously to `usePreloadedQuery` here, so
 * the guard sees the correct value with no race window.
 */
export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { preloadedSettings } = useAppData();
  const settings = usePreloadedQuery(preloadedSettings);
  const pathname = usePathname();
  const router = useRouter();

  const hasCompletedOnboarding = settings?.hasCompletedOnboarding ?? false;
  const isOnOnboarding = pathname.startsWith('/app/onboarding');

  useEffect(() => {
    if (!hasCompletedOnboarding && !isOnOnboarding) {
      router.replace('/app/onboarding');
    }
  }, [hasCompletedOnboarding, isOnOnboarding, router]);

  if (!hasCompletedOnboarding && !isOnOnboarding) {
    return null;
  }

  return <>{children}</>;
}
