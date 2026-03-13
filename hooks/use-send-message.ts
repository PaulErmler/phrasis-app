import { useCallback } from 'react';
import { useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { toast } from 'sonner';
import { ERROR_MESSAGES, CHAT_STATUS } from '@/lib/constants/chat';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import type { ChatStatus } from '@/lib/types/chat';

interface UseSendMessageProps {
  threadId: string;
  setStatus?: (status: ChatStatus) => void;
  onSuccess?: () => void;
  onError?: () => void;
  onUsageLimit?: (featureId: string) => void;
  cardId?: Id<'cards'>;
}

interface SendMessageOptions {
  prompt: string;
  clearInput?: () => void;
}

/**
 * Custom hook for sending messages with consistent error handling and status management.
 * Course languages are resolved server-side — an optional cardId provides
 * per-card review context (the server looks up all card data from the DB).
 */
export function useSendMessage({
  threadId,
  setStatus,
  onSuccess,
  onError,
  onUsageLimit,
  cardId,
}: UseSendMessageProps) {
  const sendMessageMutation = useMutation(
    api.features.chat.messages.sendMessage,
  );

  const sendMessage = useCallback(
    async ({ prompt, clearInput }: SendMessageOptions) => {
      if (!prompt.trim()) {
        return;
      }

      // Update status to submitted if setStatus is provided
      if (setStatus) {
        setStatus(CHAT_STATUS.SUBMITTED);
      }

      try {
        await sendMessageMutation({
          threadId,
          prompt,
          cardId,
        });

        // Clear input if callback provided
        if (clearInput) {
          clearInput();
        }

        // Call success callback if provided
        if (onSuccess) {
          onSuccess();
        }
      } catch (error) {
        if (
          error instanceof ConvexError &&
          (error.data as { code?: string })?.code === 'USAGE_LIMIT'
        ) {
          const featureId =
            (error.data as { featureId?: string })?.featureId ?? FEATURE_IDS.CHAT_MESSAGES;
          if (onUsageLimit) {
            onUsageLimit(featureId);
          }
          if (setStatus) {
            setStatus(CHAT_STATUS.READY);
          }
          return;
        }

        console.error('Failed to send message:', error);
        toast.error(ERROR_MESSAGES.FAILED_TO_SEND);

        if (setStatus) {
          setStatus(CHAT_STATUS.ERROR);
          setTimeout(() => setStatus(CHAT_STATUS.READY), 2000);
        }

        if (onError) {
          onError();
        }

        throw error;
      }
    },
    [threadId, sendMessageMutation, setStatus, onSuccess, onError, onUsageLimit, cardId],
  );

  return { sendMessage };
}
