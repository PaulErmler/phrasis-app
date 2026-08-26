import { useState, useCallback } from 'react';
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

  return {
    messages,
    status,
    isLoading,
    text,
    setText,
    sendMessage,
    sendQuickAction,
    voice: {
      isRecording,
      isTranscribing,
      toggle: handleVoiceClick,
    },
  };
}
