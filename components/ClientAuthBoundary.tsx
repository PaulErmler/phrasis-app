'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from 'convex/react';
import { AuthBoundary } from '@convex-dev/better-auth/react';
import { api } from '@/convex/_generated/api';
import { isAuthError } from '@/lib/utils';
import { authClient } from '@/lib/auth-client';
import type { PropsWithChildren } from 'react';

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  const router = useRouter();
  const logAuthRedirect = useMutation(api.authRedirectLog.logAuthRedirect);
  return (
    <AuthBoundary
      authClient={authClient}
      onUnauth={() => {
        void logAuthRedirect({ source: 'authBoundary' }).catch(() => {});
        router.replace('/auth/sign-in');
      }}
      getAuthUserFn={api.auth.getAuthUser}
      isAuthError={isAuthError}
    >
      {children}
    </AuthBoundary>
  );
}
