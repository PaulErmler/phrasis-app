import { useEffect, useState, useCallback, useRef } from 'react';
import { useMutation, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';
import { ERROR_MESSAGES } from '@/lib/constants/chat';
import { isAuthError } from '@/lib/utils';

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
        console.error('Failed to auto-create thread:', error);
        // A sign-out mid-flight redirects to sign-in on its own; a toast about
        // it would be noise the user can't act on. Re-arm the one-shot so a
        // transient token failure retries on the next auth recovery instead
        // of leaving the whole session without a thread.
        // Known residual: a token that expires at execution time (wake-from-
        // sleep) rejects without flipping `isAuthenticated`, so this re-arm
        // has no trigger in that path — accepted; the client refreshes tokens
        // proactively, and chat degrades to on-demand thread creation.
        if (isAuthError(error)) {
          didAutoCreate.current = false;
        } else {
          toast.error(ERROR_MESSAGES.FAILED_TO_CREATE_THREAD);
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
  ]);

  const getOrCreateEmptyThread = useCallback(async () => {
    setThreadId(null);
    setIsLoading(true);
    try {
      const id = await getOrCreateEmptyThreadMutation({});
      setThreadId(id);
      return id;
    } catch (error) {
      console.error('Failed to get or create thread:', error);
      if (!isAuthError(error)) {
        toast.error(ERROR_MESSAGES.FAILED_TO_CREATE_THREAD);
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [getOrCreateEmptyThreadMutation]);

  return {
    threadId,
    isLoading,
    getOrCreateEmptyThread,
  };
}
