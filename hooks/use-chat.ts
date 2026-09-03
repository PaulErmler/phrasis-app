import { useState, useCallback } from 'react';
import { useMutation } from 'convex/react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { CHAT_STATUS } from '@/lib/constants/chat';
import { reportError } from '@/lib/report-error';
import { useChatMessages } from '@/hooks/use-chat-messages';
import { useSendMessage } from '@/hooks/use-send-message';
import { useVoiceRecording } from '@/hooks/use-voice-recording';
import type { ChatStatus, ExtendedUIMessage } from '@/lib/types/chat';
import type { Id } from '@/convex/_generated/dataModel';
import type { QuickAction } from '@/convex/features/chat/quickActions';

interface UseChatOptions {
  threadId: string;
  cardId?: Id<'cards'>;
  onUsageLimit?: (featureId: string) => void;
  onThreadLimit?: () => void;
}

interface UseChatReturn {
  messages: ExtendedUIMessage[];
  status: ChatStatus;
  isLoading: boolean;
  text: string;
  setText: (text: string) => void;
  sendMessage: (prompt?: string) => Promise<void>;
  sendQuickAction: (action: QuickAction, label: string) => Promise<void>;
  /** Generate a failed tutor reply again. `messageId` is the failed row's id. */
  retryResponse: (messageId: string) => Promise<void>;
  voice: {
    isRecording: boolean;
    isTranscribing: boolean;
    toggle: () => void;
  };
}

/**
 * Unified chat hook that composes message retrieval, sending, and voice recording
 * into a single interface for easy consumption by chat UI components.
 */
export function useChat({
  threadId,
  cardId,
  onUsageLimit,
  onThreadLimit,
}: UseChatOptions): UseChatReturn {
  const [text, setText] = useState('');

  const { messages, status, setStatus, isLoading } = useChatMessages({
    threadId,
  });

  const { sendMessage: sendMessageRaw } = useSendMessage({
    threadId,
    setStatus,
    cardId,
    onUsageLimit,
    onThreadLimit,
  });

  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (transcript) => {
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    },
  );

  const sendMessage = useCallback(
    async (prompt?: string) => {
      const messageText = prompt ?? text;
      if (!messageText.trim()) return;

      await sendMessageRaw({
        prompt: messageText,
        clearInput: () => setText(''),
      });
    },
    [text, sendMessageRaw],
  );

  const sendQuickAction = useCallback(
    async (action: QuickAction, label: string) => {
      if (!label.trim()) return;
      await sendMessageRaw({ prompt: label, quickAction: action });
    },
    [sendMessageRaw],
  );

  const tErrors = useTranslations('Chat.errors');
  const retryMutation = useMutation(api.features.chat.messages.retryResponse);
  const retryResponse = useCallback(
    async (messageId: string) => {
      // Submitted right away so the composer locks and the thinking row
      // shows as soon as the failed row is gone; the streaming message then
      // takes over the status like it does after a send.
      setStatus(CHAT_STATUS.SUBMITTED);
      try {
        await retryMutation({ threadId, messageId, cardId });
      } catch (error) {
        reportError(error, { op: 'retryResponse', threadId });
        toast.error(tErrors('retryFailed'));
        setStatus(CHAT_STATUS.READY);
      }
    },
    [retryMutation, threadId, cardId, setStatus, tErrors],
  );

  return {
    messages,
    status,
    isLoading,
    text,
    setText,
    sendMessage,
    sendQuickAction,
    retryResponse,
    voice: {
      isRecording,
      isTranscribing,
      toggle: handleVoiceClick,
    },
  };
}
