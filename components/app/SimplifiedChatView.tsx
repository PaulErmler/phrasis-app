"use client";

import { useState, useCallback } from "react";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

// Hooks
import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { useChatMessages } from "@/hooks/use-chat-messages";

// Components
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";

// Constants
import { ERROR_MESSAGES, SUCCESS_MESSAGES, CHAT_STATUS } from "@/lib/constants/chat";

interface SimplifiedChatViewProps {
  threadId: string; // Always provided, never null
}

/**
 * Simplified chat view that just displays and manages an existing conversation.
 * No thread creation or initialization logic - that's handled by SearchBar.
 */
export function SimplifiedChatView({ threadId }: SimplifiedChatViewProps) {
  const [text, setText] = useState<string>("");

  // Message management
  const { messages, status, setStatus } = useChatMessages({ threadId });

  // Voice recording
  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (transcript) => {
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    }
  );

  // Mutations
  const sendMessage = useMutation(api.chat.messages.sendMessage);

  // Handle message submission
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);

      if (!(hasText || hasAttachments)) {
        return;
      }

      setStatus(CHAT_STATUS.SUBMITTED);

      if (message.files?.length) {
        toast.success(SUCCESS_MESSAGES.FILES_ATTACHED, {
          description: `${message.files.length} file(s) attached to message`,
        });
      }

      try {
        await sendMessage({
          threadId,
          prompt: message.text || "Sent with attachments",
        });
        setText("");
      } catch (error) {
        console.error("Failed to send message:", error);
        toast.error(ERROR_MESSAGES.FAILED_TO_SEND);
        setStatus(CHAT_STATUS.ERROR);
        setTimeout(() => setStatus(CHAT_STATUS.READY), 2000);
      }
    },
    [threadId, sendMessage, setStatus]
  );

  // Handle suggestion click
  const handleSuggestionClick = useCallback(
    async (suggestion: string) => {
      setStatus(CHAT_STATUS.SUBMITTED);
      try {
        await sendMessage({
          threadId,
          prompt: suggestion,
        });
      } catch (error) {
        console.error("Failed to send message:", error);
        toast.error(ERROR_MESSAGES.FAILED_TO_SEND);
        setStatus(CHAT_STATUS.ERROR);
        setTimeout(() => setStatus(CHAT_STATUS.READY), 2000);
      }
    },
    [threadId, sendMessage, setStatus]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 container mx-auto px-4 pb-4 pt-2">
          <ChatMessages messages={messages} isLoading={false} threadId={threadId} />
      </div>

      <div className="flex-none p-4 border-t bg-background ">
          <ChatInput
            onSubmit={handleSubmit}
            onSuggestionClick={handleSuggestionClick}
            text={text}
            onTextChange={setText}
            status={status}
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            onVoiceClick={handleVoiceClick}
            showSuggestions={messages.length === 0}
          />
      </div>
    </div>
  );
}

