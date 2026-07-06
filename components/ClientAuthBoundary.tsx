'use client';

import { type PropsWithChildren } from 'react';
import { useRouter } from 'next/navigation';
import { AuthBoundary, type AuthClient } from '@convex-dev/better-auth/react';

import { authClient } from '@/lib/auth-client';
import { isAuthError } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import { AppLoadingSplash } from '@/components/LogoSpinner';

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  const router = useRouter();
  return (
    <AuthBoundary
      // Cast: @convex-dev/better-auth 0.12.5's AuthClient type collapses
      // useSession().data to `never` under better-auth 1.6.23, so no real
      // client is assignable. Drop when a fixed release exists.
      authClient={authClient as unknown as AuthClient}
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
