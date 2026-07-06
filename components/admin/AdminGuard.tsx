'use client';

import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

/**
 * Client-side gate for admin pages. On reload the Convex client briefly
 * runs queries before the auth token is attached, so gated queries would
 * throw 'Not authorized' — children (and their useQuery calls) must not
 * mount until auth is ready AND isAdmin confirms. Server-side requireAdmin
 * remains the real protection.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const isAdmin = useQuery(
    api.admin.dashboard.isAdmin,
    isAuthenticated ? {} : 'skip',
  );

  if (isLoading || (isAuthenticated && isAdmin === undefined)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Not authorized
      </div>
    );
  }

  return <>{children}</>;
}
