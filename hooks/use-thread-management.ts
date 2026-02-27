import { useEffect, useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import type { Thread } from "@/lib/types/chat";
import { ERROR_MESSAGES } from "@/lib/constants/chat";

interface UseThreadManagementProps {
  session: { user?: { id?: string } } | null;
  isPending: boolean;
}

interface UseThreadManagementReturn {
  threadId: string | null;
  threads: Thread[] | undefined;
  createThread: () => Promise<void>;
  setThreadId: (id: string) => void;
  isLoading: boolean;
  isCreating: boolean;
}

/**
 * Custom hook for managing chat thread lifecycle
 * Handles thread initialization, creation, and selection
 */
export function useThreadManagement({
  session,
  isPending,
}: UseThreadManagementProps): UseThreadManagementReturn {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Mutations and queries
  const createThreadMutation = useMutation(api.features.chat.threads.createThread);
  
  // Skip query until session is ready to prevent auth errors on reload
  const threads = useQuery(
    api.features.chat.threads.listThreads,
    session && !isPending ? {} : "skip"
  );

  // Initialize thread - use existing threads first, only create if none exist
  useEffect(() => {
    if (session && !threadId && threads !== undefined) {
      // If we have existing threads, use the first one (most recent)
      if (threads && threads.length > 0) {
        setThreadId(threads[0]._id);
      } else if (threads && threads.length === 0) {
        // Only create a new thread if there are no existing threads
        setIsCreating(true);
        createThreadMutation({})
          .then((id) => {
            setThreadId(id);
          })
          .catch((error) => {
            console.error("Failed to create thread:", error);
            toast.error(ERROR_MESSAGES.FAILED_TO_INITIALIZE);
          })
          .finally(() => {
            setIsCreating(false);
          });
      }
    }
  }, [session, threadId, threads, createThreadMutation]);

  // Create a new thread manually
  const createThread = useCallback(async () => {
    setIsCreating(true);
    try {
      const id = await createThreadMutation({});
      setThreadId(id);
    } catch (error) {
      console.error("Failed to create thread:", error);
      toast.error(ERROR_MESSAGES.FAILED_TO_CREATE_THREAD);
      throw error;
    } finally {
      setIsCreating(false);
    }
  }, [createThreadMutation]);

  const isLoading = isPending || (!!session && !threadId && threads === undefined);

  return {
    threadId,
    threads,
    createThread,
    setThreadId,
    isLoading,
    isCreating,
  };
}

