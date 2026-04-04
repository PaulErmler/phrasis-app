'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef } from 'react';
import { AuthBoundary } from '@convex-dev/better-auth/react';
import { api } from '@/convex/_generated/api';
import { isAuthError } from '@/lib/utils';
import { authClient } from '@/lib/auth-client';
import type { PropsWithChildren } from 'react';

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  const router = useRouter();
  const redirectingRef = useRef(false);

  const handleUnauth = useCallback(async () => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;

    try {
      // Wait briefly for any in-flight JWT refresh to settle
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify the session is truly gone before redirecting
      const { data: session } = await authClient.getSession();

      if (session?.session) {
        // Session is still valid — this was a transient JWT refresh gap.
        // The provider will eventually sync a new token.
        return;
      }

      // Session is genuinely gone — redirect to sign-in
      router.replace('/auth/sign-in');
    } catch {
      // Session check failed — redirect to be safe
      router.replace('/auth/sign-in');
    } finally {
      redirectingRef.current = false;
    }
  }, [router]);

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
