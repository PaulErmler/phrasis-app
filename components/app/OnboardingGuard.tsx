'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { usePreloadedQuery } from 'convex/react';
import { useAppData } from '@/components/app/AppDataProvider';

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
