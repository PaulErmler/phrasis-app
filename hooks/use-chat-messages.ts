import { useEffect, useReducer, useRef } from "react";
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

// State for the reducer
interface ChatMessagesState {
  status: ChatStatus;
  hasStreamingMessages: boolean;
}

// Actions for the reducer
type ChatMessagesAction =
  | { type: "SET_STATUS"; status: ChatStatus }
  | { type: "UPDATE_STREAMING"; hasStreamingMessages: boolean }
  | { type: "RESET_THREAD" };

/**
 * Reducer for managing chat status with predictable state transitions
 */
function chatMessagesReducer(
  state: ChatMessagesState,
  action: ChatMessagesAction
): ChatMessagesState {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, status: action.status };

    case "UPDATE_STREAMING":
      // Automatically transition status based on streaming state
      if (action.hasStreamingMessages) {
        // If messages are streaming and we're not already in streaming state
        if (state.status !== CHAT_STATUS.STREAMING) {
          return { ...state, status: CHAT_STATUS.STREAMING, hasStreamingMessages: true };
        }
        return { ...state, hasStreamingMessages: true };
      } else {
        // No streaming messages - return to ready if we were streaming/submitted
        if (state.status === CHAT_STATUS.STREAMING || state.status === CHAT_STATUS.SUBMITTED) {
          return { ...state, status: CHAT_STATUS.READY, hasStreamingMessages: false };
        }
        return { ...state, hasStreamingMessages: false };
      }

    case "RESET_THREAD":
      return { status: CHAT_STATUS.READY, hasStreamingMessages: false };

    default:
      return state;
  }
}

/**
 * Custom hook for managing chat messages and streaming status
 * Handles message retrieval and status updates based on streaming state
 */
export function useChatMessages({
  threadId,
}: UseChatMessagesProps): UseChatMessagesReturn {
  const [state, dispatch] = useReducer(chatMessagesReducer, {
    status: CHAT_STATUS.READY,
    hasStreamingMessages: false,
  });

  // Track previous streaming state to avoid unnecessary dispatches
  const prevStreamingRef = useRef<boolean | null>(null);

  const listMessagesQuery: UIMessagesQuery<{ threadId: string }, AgentUIMessage> =
    api.chat.messages.listMessages as UIMessagesQuery<{ threadId: string }, AgentUIMessage>;

  const messageResult = useUIMessages(
    listMessagesQuery,
    threadId ? { threadId } : "skip",
    { 
      initialNumItems: 100,
      stream: true
    }
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

    // Only dispatch if the streaming state actually changed
    if (prevStreamingRef.current !== hasStreamingMessages) {
      prevStreamingRef.current = hasStreamingMessages;
      dispatch({ type: "UPDATE_STREAMING", hasStreamingMessages });
    }
  }, [messageResult?.results]);

  // Reset state when thread changes
  useEffect(() => {
    if (threadId) {
      prevStreamingRef.current = null;
      dispatch({ type: "RESET_THREAD" });
    }
  }, [threadId]);

  // Wrapper to allow external status updates
  const setStatus = (status: ChatStatus) => {
    dispatch({ type: "SET_STATUS", status });
  };

  return {
    messages,
    status: state.status,
    setStatus,
  };
}

