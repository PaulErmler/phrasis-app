import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  MessageBranch,
  MessageBranchContent,
} from "@/components/ai-elements/message";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Loader } from "@/components/ai-elements/loader";
import type { ExtendedUIMessage } from "@/lib/types/chat";

interface ChatMessagesProps {
  messages: ExtendedUIMessage[];
  isLoading: boolean;
}

/**
 * Component for displaying chat messages with streaming support
 */
export function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader size={24} />
      </div>
    );
  }

  return (
    <Conversation className="flex-1 min-h-0 overflow-y-auto">
      <ConversationContent>
        {messages && messages.length > 0 ? (
          messages.map((message: ExtendedUIMessage) => {
            const messageText = message.content ?? message.text ?? "";
            const isAssistantStreaming =
              message.role === "assistant" &&
              (message.status === "streaming" || message.status === "pending");

            return (
              <MessageBranch key={message.id} defaultBranch={0}>
                <MessageBranchContent>
                  <Message from={message.role}>
                    <MessageContent>
                      {isAssistantStreaming && !messageText ? (
                        <Shimmer>Thinking...</Shimmer>
                      ) : (
                        <MessageResponse>{messageText}</MessageResponse>
                      )}
                      {isAssistantStreaming && messageText && (
                        <div className="mt-2">
                          <Shimmer duration={1}>Thinking...</Shimmer>
                        </div>
                      )}
                    </MessageContent>
                  </Message>
                </MessageBranchContent>
              </MessageBranch>
            );
          })
        ) : (
          <ConversationEmptyState
            title="No messages yet"
            description="Start a conversation to see messages here"
          />
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

