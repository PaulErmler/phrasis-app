import { useCallback } from 'react';
import { useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { convexErrorCode } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { toast } from 'sonner';
import { ERROR_MESSAGES, CHAT_STATUS } from '@/lib/constants/chat';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import type { ChatStatus } from '@/lib/types/chat';
import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';
import { reportError } from '@/lib/report-error';
import type { QuickAction } from '@/convex/features/chat/quickActions';

interface UseSendMessageProps {
  threadId: string;
  setStatus?: (status: ChatStatus) => void;
  onSuccess?: () => void;
  onError?: () => void;
  onUsageLimit?: (featureId: string) => void;
  onThreadLimit?: () => void;
  onMessageTooLong?: () => void;
  cardId?: Id<'cards'>;
}

interface SendMessageOptions {
  prompt: string;
  /** Server-expanded steering action; `prompt` is then only the visible label. */
  quickAction?: QuickAction;
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
  onThreadLimit,
  onMessageTooLong,
  cardId,
}: UseSendMessageProps) {
  const sendMessageMutation = useMutation(
    api.features.chat.messages.sendMessage,
  );

  const sendMessage = useCallback(
    async ({ prompt, quickAction, clearInput }: SendMessageOptions) => {
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
          quickAction,
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
        if (error instanceof ConvexError) {
          const code = convexErrorCode(error);
          // Captured here rather than in `sendMessage`: the mutation threw, so
          // everything it scheduled — including any analytics event — rolled
          // back with it. The client is the only place these failures exist.
          capture(CLIENT_EVENTS.CHAT_MESSAGE_FAILED, {
            code: code ?? 'UNKNOWN',
            message_chars: prompt.length,
            has_card_context: cardId !== undefined,
            quick_action: quickAction?.kind,
          });

          switch (code) {
            // Swallowed silently: the reactive payment-overdue dialog is the
            // canonical surface for this state (see isPaymentPastDueError).
            case 'PAYMENT_PAST_DUE': {
              if (setStatus) {
                setStatus(CHAT_STATUS.READY);
              }
              return;
            }
            case 'USAGE_LIMIT': {
              const featureId =
                (error.data as { featureId?: string })?.featureId ?? FEATURE_IDS.CHAT_MESSAGES;
              capture(CLIENT_EVENTS.QUOTA_EXHAUSTED, { feature_id: featureId, surface: 'chat' });
              if (onUsageLimit) {
                onUsageLimit(featureId);
              }
              if (setStatus) {
                setStatus(CHAT_STATUS.READY);
              }
              return;
            }
            case 'THREAD_MESSAGE_LIMIT': {
              if (onThreadLimit) {
                onThreadLimit();
              }
              if (setStatus) {
                setStatus(CHAT_STATUS.READY);
              }
              return;
            }
            case 'MESSAGE_TOO_LONG': {
              if (onMessageTooLong) {
                onMessageTooLong();
              }
              if (setStatus) {
                setStatus(CHAT_STATUS.READY);
              }
              return;
            }
          }
        }

        reportError(error, { op: 'sendMessage', threadId });
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
    [threadId, sendMessageMutation, setStatus, onSuccess, onError, onUsageLimit, onThreadLimit, onMessageTooLong, cardId],
  );

  return { sendMessage };
}
