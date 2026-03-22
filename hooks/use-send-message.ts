import { useCallback } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';
import { ERROR_MESSAGES, CHAT_STATUS } from '@/lib/constants/chat';
import type { ChatStatus } from '@/lib/types/chat';

export interface CardContext {
  sourceText: string;
  sourceLanguage: string;
  translations: { language: string; text: string }[];
  baseLanguages: string[];
  targetLanguages: string[];
}

interface UseSendMessageProps {
  threadId: string;
  setStatus?: (status: ChatStatus) => void;
  onSuccess?: () => void;
  onError?: () => void;
  cardContext?: CardContext;
}

interface SendMessageOptions {
  prompt: string;
  clearInput?: () => void;
}

/**
 * Custom hook for sending messages with consistent error handling and status management
 * Consolidates shared logic used across SearchBar and SimplifiedChatView
 */
export function useSendMessage({
  threadId,
  setStatus,
  onSuccess,
  onError,
  cardContext,
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
          cardContext,
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
        console.error('Failed to send message:', error);
        toast.error(ERROR_MESSAGES.FAILED_TO_SEND);

        // Reset status on error if setStatus is provided
        if (setStatus) {
          setStatus(CHAT_STATUS.ERROR);
          setTimeout(() => setStatus(CHAT_STATUS.READY), 2000);
        }

        // Call error callback if provided
        if (onError) {
          onError();
        }

        throw error;
      }
    },
    [threadId, sendMessageMutation, setStatus, onSuccess, onError, cardContext],
  );

  return { sendMessage };
}
