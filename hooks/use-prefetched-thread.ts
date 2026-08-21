import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useConvexAuth, type ReactMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { reportError } from '@/lib/report-error';
import { isAuthError } from '@/lib/utils';

interface UsePrefetchedThreadReturn {
  /** Empty thread ready for LearnView, or null until the prefetch lands. */
  prefetchedThreadId: string | null;
  /** Re-run the prefetch. Call after the current thread has been consumed. */
  refreshPrefetchedThread: () => void;
  /** The underlying mutation, for callers that need a thread right now. */
  getOrCreateEmptyThread: ReactMutation<
    typeof api.features.chat.threads.getOrCreateEmptyThread
  >;
}

/**
 * Pre-creates an empty chat thread so opening chat from Learn is instant.
 *
 * The initial prefetch is gated on `isAuthenticated`: the app shell mounts
 * before Convex finishes its auth handshake (better-auth's AuthBoundary
 * renders children immediately), and Convex sends requests unauthenticated
 * until `setAuth` lands rather than queueing them. The prefetch is one-shot,
 * so racing the handshake used to strand `prefetchedThreadId` at null for the
 * whole session. Chat then had to create a thread on demand every time.
 */
export function usePrefetchedThread(): UsePrefetchedThreadReturn {
  const { isAuthenticated } = useConvexAuth();
  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );
  const [prefetchedThreadId, setPrefetchedThreadId] = useState<string | null>(
    null,
  );

  const didPrefetchThread = useRef(false);

  const refreshPrefetchedThread = useCallback(() => {
    getOrCreateEmptyThread({})
      .then(setPrefetchedThreadId)
      // Non-fatal: LearnView creates a thread on demand if this never lands.
      // Reported rather than swallowed, because a persistent failure here is
      // invisible to the user and shows up only as chat feeling slow.
      // Auth errors are excluded: a token expiring (or a sign-out) mid-flight
      // is expected and already handled by ClientAuthBoundary's redirect,
      // but the one-shot is re-armed so the prefetch retries on the next
      // auth recovery instead of staying stranded for the session.
      // Known residual: a token that expires at execution time (wake-from-
      // sleep) rejects without flipping `isAuthenticated`, so the re-arm has
      // no trigger in that path. Accepted; the client refreshes tokens
      // proactively, and LearnView creates a thread on demand anyway.
      .catch((err) => {
        if (isAuthError(err)) {
          didPrefetchThread.current = false;
          return;
        }
        reportError(err, { op: 'prefetchEmptyThread' });
      });
  }, [getOrCreateEmptyThread]);

  useEffect(() => {
    if (!isAuthenticated || didPrefetchThread.current) return;
    didPrefetchThread.current = true;
    refreshPrefetchedThread();
  }, [isAuthenticated, refreshPrefetchedThread]);

  return {
    prefetchedThreadId,
    refreshPrefetchedThread,
    getOrCreateEmptyThread,
  };
}
