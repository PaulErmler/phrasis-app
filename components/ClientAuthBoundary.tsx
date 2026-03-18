'use client';

import { useRouter } from 'next/navigation';
import { AuthBoundary } from '@convex-dev/better-auth/react';
import { api } from '@/convex/_generated/api';
import { isAuthError } from '@/lib/utils';
import { authClient } from '@/lib/auth-client';
import type { PropsWithChildren } from 'react';

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
