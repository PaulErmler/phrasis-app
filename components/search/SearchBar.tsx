"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";

// Components
import { ChatInput } from "@/components/chat/ChatInput";

// Hooks
import { useVoiceRecording } from "@/hooks/use-voice-recording";

// Constants & Types
import { ERROR_MESSAGES, CHAT_STATUS } from "@/lib/constants/chat";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

interface SearchBarProps {
  placeholder?: string;
  className?: string;
  showSuggestions?: boolean;
}

/**
 * Self-contained SearchBar component that handles:
 * - User input (text + voice + files)
 * - Thread creation
 * - Initial message sending
 * - Routing to chat page
 */
export function SearchBar({
  className,
  showSuggestions = true,
}: SearchBarProps) {
  const router = useRouter();
  const [text, setText] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Voice recording
  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (transcript) => {
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    }
  );

  // Mutations
  const createThread = useMutation(api.chat.threads.createThread);
  const sendMessage = useMutation(api.chat.messages.sendMessage);

  // Handle search submission - create thread, send message, route to chat
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (!message.text?.trim()) return;

      setIsProcessing(true);

      try {
        // 1. Create new thread
        const threadId = await createThread({});

        // 2. Send initial message
        await sendMessage({
          threadId,
          prompt: message.text,
        });

        // 3. Clear input
        setText("");

        // 4. Navigate to chat page
        router.push(`/app/chat/${threadId}`);
      } catch (error) {
        console.error("Failed to start chat:", error);
        toast.error(ERROR_MESSAGES.FAILED_TO_CREATE_THREAD);
        setIsProcessing(false);
      }
      // Note: Don't set isProcessing to false on success - we're navigating away
    },
    [createThread, sendMessage, router]
  );

  // Handle suggestion click
  const handleSuggestionClick = useCallback(
    async (suggestion: string) => {
      setText(suggestion);
      await handleSubmit({ text: suggestion, files: [] });
    },
    [handleSubmit]
  );

  return (
    <div className={className}>
      <ChatInput
        onSubmit={handleSubmit}
        onSuggestionClick={handleSuggestionClick}
        text={text}
        onTextChange={setText}
        status={isProcessing ? CHAT_STATUS.SUBMITTED : CHAT_STATUS.READY}
        isRecording={isRecording}
        isTranscribing={isTranscribing}
        onVoiceClick={handleVoiceClick}
        showSuggestions={showSuggestions}
      />
    </div>
  );
}

