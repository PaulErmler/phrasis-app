'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useConvexAuth } from 'convex/react';
import type { PropsWithChildren } from 'react';

import { AppLoadingSplash } from '@/components/LogoSpinner';

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const hasBeenAuthenticatedRef = useRef(false);

  if (isAuthenticated && !hasBeenAuthenticatedRef.current) {
    hasBeenAuthenticatedRef.current = true;
  }

  // Once we've authenticated once this session, stay rendered
  // across WebSocket reconnects (e.g. mobile app resume).
  const sticky = hasBeenAuthenticatedRef.current;

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !sticky) {
      router.replace('/auth/sign-in');
    }
  }, [isLoading, isAuthenticated, sticky, router]);

  if (sticky) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <AppLoadingSplash />
      </div>
    );
  }

  if (isAuthenticated) return <>{children}</>;

  return null;
}
