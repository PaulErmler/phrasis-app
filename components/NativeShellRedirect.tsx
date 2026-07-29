'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isNativeApp } from '@/lib/native';

/**
 * Inside the Capacitor store-app shell the marketing site (with its pricing
 * section and install CTAs) must never show — any visit to the landing page
 * (e.g. after sign-out) is bounced to /app, where the auth middleware takes
 * over.
 */
export function NativeShellRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (isNativeApp()) router.replace('/app');
  }, [router]);
  return null;
}
