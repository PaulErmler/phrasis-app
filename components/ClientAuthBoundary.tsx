'use client';

import { type PropsWithChildren } from 'react';
import { useRouter } from 'next/navigation';
import { AuthBoundary } from '@convex-dev/better-auth/react';

import { authClient } from '@/lib/auth-client';
import { isAuthError } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import { AppLoadingSplash } from '@/components/LogoSpinner';

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  const router = useRouter();
  return (
    <AuthBoundary
      authClient={authClient}
      onUnauth={() => router.replace('/auth/sign-in')}
      getAuthUserFn={api.auth.getAuthUser}
      isAuthError={isAuthError}
      renderFallback={() => (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background">
          <AppLoadingSplash />
        </div>
      )}
    >
      {children}
    </AuthBoundary>
  );
}
