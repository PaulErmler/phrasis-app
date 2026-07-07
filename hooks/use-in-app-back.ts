'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

// Counts client-side navigations within /app/* (AppWarmup increments it on
// every pathname change). Module scope on purpose: it must survive route
// unmounts but reset on a full page load, where the browser history behind
// us may belong to another site.
let inAppNavigations = 0;

export function markInAppNavigation(): void {
  inAppNavigations += 1;
}

/**
 * Back-navigation that never exits the site: `router.back()` when we know a
 * previous in-app history entry exists (tab → learn → back returns to that
 * tab, matching the old overlay's history.back()), otherwise `/app`
 * (deep link straight into learn/chat).
 */
export function useInAppBack(): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (inAppNavigations > 0) {
      router.back();
    } else {
      router.push('/app');
    }
  }, [router]);
}
