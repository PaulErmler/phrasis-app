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
  createThread: () => Promise<string>;
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

  const createThreadMutation = useMutation(
    api.features.chat.threads.createThread,
  );

  // Sync explicit threadId changes
  useEffect(() => {
    if (explicitThreadId) {
      setThreadId(explicitThreadId);
      setIsLoading(false);
    }
  }, [explicitThreadId]);

  // Auto-create on mount when requested
  useEffect(() => {
    if (!autoCreate || explicitThreadId || didAutoCreate.current) return;
    didAutoCreate.current = true;

    createThreadMutation({})
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
  }, [autoCreate, explicitThreadId, createThreadMutation]);

  const createThread = useCallback(async () => {
    setIsLoading(true);
    try {
      const id = await createThreadMutation({});
      setThreadId(id);
      return id;
    } catch (error) {
      console.error('Failed to create thread:', error);
      toast.error(ERROR_MESSAGES.FAILED_TO_CREATE_THREAD);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [createThreadMutation]);

  return {
    threadId,
    isLoading,
    createThread,
  };
}
