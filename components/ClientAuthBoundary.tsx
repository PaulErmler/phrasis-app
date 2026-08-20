'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useRouter } from 'next/navigation';
import { useConvexAuth } from 'convex/react';
import { AuthBoundary, type AuthClient } from '@convex-dev/better-auth/react';

import { authClient } from '@/lib/auth-client';
import { isAuthError } from '@/lib/utils';
import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';
import { api } from '@/convex/_generated/api';
import { AppLoadingSplash } from '@/components/LogoSpinner';

/** Delay before the second (and last) session-confirm attempt. */
const CONFIRM_RETRY_MS = 2000;

/**
 * Splash rendered while AuthBoundary's ErrorBoundary holds a caught auth
 * error. Reports its own mount so the parent knows the children are currently
 * unmounted and only a boundary remount can bring them back (see below).
 */
function FallbackSplash({ onMount }: { onMount: () => void }) {
  useEffect(() => onMount(), [onMount]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <AppLoadingSplash />
    </div>
  );
}

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();

  // AuthBoundary can invoke onUnauth repeatedly while unauthenticated (its
  // effect re-runs and its ErrorBoundary also calls it); one confirm cycle at
  // a time is enough.
  const confirmingRef = useRef(false);

  // AuthBoundary's ErrorBoundary never clears a caught error, before
  // `handleUnauth` learned to suppress redirects, navigating to the login
  // page was the only thing that ever unmounted it. So whenever a bounce is
  // suppressed while the fallback splash is showing, the boundary has to be
  // remounted (key bump) or the splash would outlive the recovery and the
  // user would be stuck on it until a hard reload. `remountWhenAuthed` is
  // armed by the suppressing branches of `handleUnauth`; the effect fires the
  // remount only once Convex auth actually reads authenticated again, so a
  // still-broken token refresh can't remount-loop the subtree.
  const [boundaryKey, setBoundaryKey] = useState(0);
  const [fallbackShown, setFallbackShown] = useState(false);
  const [remountWhenAuthed, setRemountWhenAuthed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !remountWhenAuthed) return;
    setRemountWhenAuthed(false);
    if (fallbackShown) {
      setFallbackShown(false);
      setBoundaryKey((key) => key + 1);
    }
    // If the fallback never rendered (the bounce came from AuthBoundary's
    // effect while children stayed mounted), recovery needs no remount,
    // just disarm.
  }, [isAuthenticated, remountWhenAuthed, fallbackShown]);

  const markFallbackShown = useCallback(() => setFallbackShown(true), []);

  /**
   * Confirm-then-redirect. `useConvexAuth()` reads unauthenticated after ANY
   * failed token mint. The Convex JWT lasts 15 minutes and the fetch that
   * renews it swallows every error, so an offline launch or a flaky
   * connection used to bounce users with a perfectly valid session cookie to
   * the login page. Only redirect once the server has definitively said
   * "no session"; on network errors, stay put. useSession's focus refetch
   * and the Convex client's token refresh recover on their own once the
   * network returns.
   *
   * NOTE: AuthBoundary itself awaits an un-guarded `authClient.getSession()`
   * right before invoking this callback (a duplicate of our first confirm
   * attempt. Don't "deduplicate" by removing ours, the library discards its
   * result). When fully offline that library call rejects before we ever run.
   */
  const handleUnauth = useCallback(async () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        let hasSession = false;
        let unreachable = false;
        try {
          const { data, error } = await authClient.getSession({
            fetchOptions: { throw: false },
          });
          hasSession = Boolean(data?.session);
          unreachable = Boolean(error);
        } catch {
          // `throw: false` only converts HTTP errors into `{ error }`; a
          // network-level failure (offline, DNS, TLS) still rejects. Same
          // meaning here: no definitive answer from the server.
          unreachable = true;
        }
        if (hasSession) {
          // The cookie session is fine. The bounce was a transient token
          // failure. Suppress the redirect and remount once auth recovers.
          capture(CLIENT_EVENTS.AUTH_BOUNCE, { confirmed: false, reason: 'still-signed-in' });
          setRemountWhenAuthed(true);
          return;
        }
        if (!unreachable) {
          // Definitive answer: no session. This is a real sign-out.
          capture(CLIENT_EVENTS.AUTH_BOUNCE, { confirmed: true });
          router.replace('/auth/sign-in');
          return;
        }
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, CONFIRM_RETRY_MS));
        }
      }
      // Both confirm attempts failed (offline, server down). Trade-off: a
      // genuinely signed-out user with no connection stays on a dead app
      // screen instead of a login form they couldn't use anyway.
      capture(CLIENT_EVENTS.AUTH_BOUNCE, { confirmed: false, reason: 'unreachable' });
      setRemountWhenAuthed(true);
    } finally {
      confirmingRef.current = false;
    }
  }, [router]);

  return (
    <AuthBoundary
      key={boundaryKey}
      // Cast: @convex-dev/better-auth 0.12.5's AuthClient type collapses
      // useSession().data to `never` under better-auth 1.6.23, so no real
      // client is assignable. Drop when a fixed release exists.
      authClient={authClient as unknown as AuthClient}
      onUnauth={handleUnauth}
      getAuthUserFn={api.auth.getAuthUser}
      isAuthError={isAuthError}
      renderFallback={() => <FallbackSplash onMount={markFallbackShown} />}
    >
      {children}
    </AuthBoundary>
  );
}
