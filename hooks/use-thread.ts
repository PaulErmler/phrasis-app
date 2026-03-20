import { useEffect, useState, useCallback, useRef } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';
import { ERROR_MESSAGES } from '@/lib/constants/chat';

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

  const getOrCreateEmptyThreadMutation = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );

  useEffect(() => {
    if (explicitThreadId) {
      setThreadId(explicitThreadId);
      setIsLoading(false);
    }
  }, [explicitThreadId]);

  useEffect(() => {
    if (!autoCreate || explicitThreadId || didAutoCreate.current) return;
    didAutoCreate.current = true;

    getOrCreateEmptyThreadMutation({})
      .then((id) => {
        setThreadId(id);
      })
      .catch((error) => {
        console.error('Failed to auto-create thread:', error);
        toast.error(ERROR_MESSAGES.FAILED_TO_CREATE_THREAD);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [autoCreate, explicitThreadId, getOrCreateEmptyThreadMutation]);

  const getOrCreateEmptyThread = useCallback(async () => {
    setThreadId(null);
    setIsLoading(true);
    try {
      const id = await getOrCreateEmptyThreadMutation({});
      setThreadId(id);
      return id;
    } catch (error) {
      console.error('Failed to get or create thread:', error);
      toast.error(ERROR_MESSAGES.FAILED_TO_CREATE_THREAD);
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
