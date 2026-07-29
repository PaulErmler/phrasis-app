'use client';

import { useSyncExternalStore } from 'react';
import { isNativeApp } from '@/lib/native';

const subscribe = () => () => {};
const getServerSnapshot = () => false;

/**
 * SSR-safe `isNativeApp()` — renders `false` on the server and during
 * hydration, then flips to the real value on the client. Store-policy
 * surfaces (pricing, checkout, install CTAs) must hide when this is true.
 */
export function useIsNativeApp(): boolean {
  return useSyncExternalStore(subscribe, isNativeApp, getServerSnapshot);
}
