import { useState, useCallback } from 'react';
import { useChatMessages } from '@/hooks/use-chat-messages';
import { useSendMessage } from '@/hooks/use-send-message';
import { useVoiceRecording } from '@/hooks/use-voice-recording';
import type { ChatStatus, ExtendedUIMessage } from '@/lib/types/chat';

interface UseChatOptions {
  threadId: string;
}

interface UseChatReturn {
  messages: ExtendedUIMessage[];
  status: ChatStatus;
  text: string;
  setText: (text: string) => void;
  sendMessage: (prompt?: string) => Promise<void>;
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
export function useChat({ threadId }: UseChatOptions): UseChatReturn {
  const [text, setText] = useState('');

  const { messages, status, setStatus } = useChatMessages({ threadId });

  const { sendMessage: sendMessageRaw } = useSendMessage({
    threadId,
    setStatus,
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

  return {
    messages,
    status,
    text,
    setText,
    sendMessage,
    voice: {
      isRecording,
      isTranscribing,
      toggle: handleVoiceClick,
    },
  };
}
