'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { usePreloadedQuery } from 'convex/react';
import { useAppData } from '@/components/app/AppDataProvider';

/**
 * Bounces unauthenticated-onto-app and not-yet-onboarded routes back to
 * `/app/onboarding`. The flicker that used to happen right after the user
 * finished onboarding. `/app` would briefly redirect back to
 * `/app/onboarding` before the wizard's `router.push('/app')` took effect.
 * That flash is prevented at the mutation site: `finalizeOnboarding` carries a
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

  // Strict tri-state: only redirect when we KNOW the user is not onboarded
  // (`hasCompletedOnboarding === false`). When `settings` is `null` /
  // `undefined`. Pre-hydration, briefly mid-soft-nav, or no `userSettings`
  // row yet. Leave children mounted. With the previous `?? false` default,
  // a null reading bounced the user to `/app/onboarding`, where the live
  // query (or its optimistic update) said "completed", which pushed them
  // back to `/app`. A navigation ping-pong across the (main)/onboarding
  // layout boundary. Each cycle unmounted+remounted (main)/layout and
  // refired every "once per mount" effect (syncQuotas, ensureContent,
  // tutorial timers, etc.), the actual flood you were seeing.
  const hasCompletedOnboarding = settings?.hasCompletedOnboarding;
  const isOnOnboarding = pathname.startsWith('/app/onboarding');
  const needsOnboarding = hasCompletedOnboarding === false && !isOnOnboarding;

  useEffect(() => {
    if (needsOnboarding) router.replace('/app/onboarding');
  }, [needsOnboarding, router]);

  if (needsOnboarding) return null;

  return <>{children}</>;
}
