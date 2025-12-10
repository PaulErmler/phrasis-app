import { useEffect, useState } from "react";
import { useUIMessages } from "@convex-dev/agent/react";
import type { UIMessagesQuery } from "@convex-dev/agent/react";
import { api } from "@/convex/_generated/api";
import type { ChatStatus, AgentUIMessage, ExtendedUIMessage } from "@/lib/types/chat";
import { CHAT_STATUS } from "@/lib/constants/chat";

interface UseChatMessagesProps {
  threadId: string | null;
}

interface UseChatMessagesReturn {
  messages: ExtendedUIMessage[];
  status: ChatStatus;
  setStatus: (status: ChatStatus) => void;
}

/**
 * Custom hook for managing chat messages and streaming status
 * Handles message retrieval and status updates based on streaming state
 */
export function useChatMessages({
  threadId,
}: UseChatMessagesProps): UseChatMessagesReturn {
  const [status, setStatus] = useState<ChatStatus>(CHAT_STATUS.READY);

  const listMessagesQuery: UIMessagesQuery<{ threadId: string }, AgentUIMessage> =
    api.chat.messages.listMessages as UIMessagesQuery<{ threadId: string }, AgentUIMessage>;

  const messageResult = useUIMessages(
    listMessagesQuery,
    threadId ? { threadId } : "skip",
    { initialNumItems: 100 }
  );

  const messages: ExtendedUIMessage[] = messageResult?.results ?? [];

  // Monitor streaming status and update button state
  useEffect(() => {
    if (!messageResult?.results) return;

    // Check if there are any messages currently streaming or pending
    const hasStreamingMessages = messageResult.results.some(
      (message) =>
        message.role === "assistant" &&
        (message.status === "streaming" || message.status === "pending")
    );

    if (hasStreamingMessages) {
      // If we have streaming messages and status is not already streaming, set it
      if (status !== CHAT_STATUS.STREAMING) {
        setTimeout(() => setStatus(CHAT_STATUS.STREAMING), 0);
      }
    } else if (
      status === CHAT_STATUS.STREAMING ||
      status === CHAT_STATUS.SUBMITTED
    ) {
      // If no streaming messages and we were in streaming/submitted state, return to ready
      setTimeout(() => setStatus(CHAT_STATUS.READY), 0);
    }
  }, [messageResult?.results, status]);

  // Reset state when thread changes
  useEffect(() => {
    if (threadId) {
      setTimeout(() => setStatus(CHAT_STATUS.READY), 0);
    }
  }, [threadId]);

  return {
    messages,
    status,
    setStatus,
  };
}

