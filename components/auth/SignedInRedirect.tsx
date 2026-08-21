'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { authClient } from '@/lib/auth-client';

/**
 * Sends a visitor who is already signed in away from the sign-in / sign-up
 * pages, straight to the app.
 *
 * Safety net for the auth boundary: if a transient failure ever bounces a
 * signed-in user here (see ClientAuthBoundary), the bounce costs a flash of
 * the login form instead of a needless login. `/app/onboarding` matches the
 * post-login `redirectTo`, so OnboardingGuard routes onward exactly as after
 * a real sign-in.
 *
 * Deliberate consequence: switching accounts requires signing out first (the
 * Settings sign-out button), this page no longer shows a login form to
 * someone with a live session.
 */
export function SignedInRedirect() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && session) {
      router.replace('/app/onboarding');
    }
  }, [isPending, session, router]);

  return null;
}
