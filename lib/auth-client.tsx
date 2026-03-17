'use client';

import type { PropsWithChildren } from 'react';
import { useRouter } from 'next/navigation';
import { createAuthClient } from 'better-auth/react';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { AuthBoundary } from '@convex-dev/better-auth/react';
import { api } from '@/convex/_generated/api';
import { isAuthError } from '@/lib/utils';

export const authClient = createAuthClient({
  plugins: [convexClient()],
});

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  const router = useRouter();
  return (
    <AuthBoundary
      authClient={authClient}
      onUnauth={() => router.replace('/auth/sign-in')}
      getAuthUserFn={api.auth.getAuthUser}
      isAuthError={isAuthError}
    >
      {children}
    </AuthBoundary>
  );
}
