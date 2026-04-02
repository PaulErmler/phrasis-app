'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useMutation } from 'convex/react';
import { AuthBoundary } from '@convex-dev/better-auth/react';
import { api } from '@/convex/_generated/api';
import { isAuthError } from '@/lib/utils';
import { authClient } from '@/lib/auth-client';
import type { PropsWithChildren } from 'react';

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  const router = useRouter();
  const logRedirect = useMutation(api.authRedirectLog.logAuthRedirect);

  const handleUnauth = useCallback(() => {
    authClient.getSession().then(({ data: session }) => {
      logRedirect({
        source: 'authBoundary',
        details: `hasSession=${!!session?.session}`,
      }).catch(() => {});
    }).catch(() => {
      logRedirect({
        source: 'authBoundary',
        details: 'session check failed',
      }).catch(() => {});
    });
    router.replace('/auth/sign-in');
  }, [router, logRedirect]);

  return (
    <AuthBoundary
      authClient={authClient}
      onUnauth={handleUnauth}
      getAuthUserFn={api.auth.getAuthUser}
      isAuthError={isAuthError}
    >
      {children}
    </AuthBoundary>
  );
}
