import { useEffect, useState, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';
import type { Thread } from '@/lib/types/chat';
import { ERROR_MESSAGES } from '@/lib/constants/chat';

interface UseThreadManagementReturn {
  threadId: string | null;
  threads: Thread[] | undefined;
  createThread: () => Promise<void>;
  setThreadId: (id: string) => void;
  isLoading: boolean;
  isCreating: boolean;
}

/**
 * Custom hook for managing chat thread lifecycle.
 * Must be rendered inside <Authenticated> from convex/react.
 */
export function useThreadManagement(): UseThreadManagementReturn {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const createThreadMutation = useMutation(
    api.features.chat.threads.createThread,
  );

  const threads = useQuery(api.features.chat.threads.listThreads);

  // Initialize thread - use existing threads first, only create if none exist
  useEffect(() => {
    if (!threadId && threads !== undefined) {
      if (threads && threads.length > 0) {
        setThreadId(threads[0]._id);
      } else if (threads && threads.length === 0) {
        setIsCreating(true);
        createThreadMutation({})
          .then((id) => {
            setThreadId(id);
          })
          .catch((error) => {
            console.error('Failed to create thread:', error);
            toast.error(ERROR_MESSAGES.FAILED_TO_INITIALIZE);
          })
          .finally(() => {
            setIsCreating(false);
          });
      }
    }
  }, [threadId, threads, createThreadMutation]);

  const createThread = useCallback(async () => {
    setIsCreating(true);
    try {
      const id = await createThreadMutation({});
      setThreadId(id);
    } catch (error) {
      console.error('Failed to create thread:', error);
      toast.error(ERROR_MESSAGES.FAILED_TO_CREATE_THREAD);
      throw error;
    } finally {
      setIsCreating(false);
    }
  }, [createThreadMutation]);

  const isLoading = !threadId && threads === undefined;

  return {
    threadId,
    threads,
    createThread,
    setThreadId,
    isLoading,
    isCreating,
  };
}
