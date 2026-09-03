import { useEffect, useState, useCallback, useRef } from 'react';
import { useMutation, useConvexAuth } from 'convex/react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';
import { isAuthError } from '@/lib/utils';

import { reportError } from '@/lib/report-error';

interface UseThreadOptions {
  autoCreate?: boolean;
  threadId?: string;
}

interface UseThreadReturn {
  threadId: string | null;
  isLoading: boolean;
  getOrCreateEmptyThread: () => Promise<string>;
}

/**
 * Simple thread lifecycle hook. Supports two modes:
 * - Explicit: pass a known `threadId` to use it directly
 * - Auto-create: set `autoCreate: true` to create a thread on mount
 */
export function useThread({
  autoCreate = false,
  threadId: explicitThreadId,
}: UseThreadOptions = {}): UseThreadReturn {
  const t = useTranslations('Chat.errors');
  const [threadId, setThreadId] = useState<string | null>(
    explicitThreadId ?? null,
  );
  const [isLoading, setIsLoading] = useState(autoCreate && !explicitThreadId);
  const didAutoCreate = useRef(false);
  const { isAuthenticated } = useConvexAuth();

  const getOrCreateEmptyThreadMutation = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );

  useEffect(() => {
    if (explicitThreadId) {
      setThreadId(explicitThreadId);
      setIsLoading(false);
    }
  }, [explicitThreadId]);

  // Waits for `isAuthenticated`: consumers mount this hook before Convex has
  // finished its auth handshake, and Convex sends requests unauthenticated
  // until setAuth lands rather than queueing them. Since `didAutoCreate` makes
  // this a one-shot, firing early meant a permanent failure (and a spurious
  // error toast) instead of a thread. `isLoading` already starts true here, so
  // the wait shows as loading rather than as an empty state.
  useEffect(() => {
    if (!autoCreate || explicitThreadId || didAutoCreate.current) return;
    if (!isAuthenticated) return;
    didAutoCreate.current = true;

    getOrCreateEmptyThreadMutation({})
      .then((id) => {
        setThreadId(id);
      })
      .catch((error) => {
        reportError(error, { op: 'autoCreateThread' });
        // A sign-out mid-flight redirects to sign-in on its own; a toast about
        // it would be noise the user can't act on. Re-arm the one-shot so a
        // transient token failure retries on the next auth recovery instead
        // of leaving the whole session without a thread.
        // Known residual: a token that expires at execution time (wake-from-
        // sleep) rejects without flipping `isAuthenticated`, so this re-arm
        // has no trigger in that path. Accepted; the client refreshes tokens
        // proactively, and chat degrades to on-demand thread creation.
        if (isAuthError(error)) {
          didAutoCreate.current = false;
        } else {
          toast.error(t('failedToCreateThread'));
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [
    autoCreate,
    explicitThreadId,
    isAuthenticated,
    getOrCreateEmptyThreadMutation,
    t,
  ]);

  // The current thread stays in place until the replacement id lands. Nulling
  // it first unmounted the learn view's chat panel into a spinner on every
  // card-change rotation and on "New chat", even when the server handed back
  // the very same (still empty) thread. Callers that want an optimistic
  // empty state while the new thread's queries load see
  // `ChatPanel.emptyStateWhileLoading`.
  const getOrCreateEmptyThread = useCallback(async () => {
    setIsLoading(true);
    try {
      const id = await getOrCreateEmptyThreadMutation({});
      setThreadId(id);
      return id;
    } catch (error) {
      reportError(error, { op: 'getOrCreateEmptyThread' });
      if (!isAuthError(error)) {
        toast.error(t('failedToCreateThread'));
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [getOrCreateEmptyThreadMutation, t]);

  return {
    threadId,
    isLoading,
    getOrCreateEmptyThread,
  };
}
