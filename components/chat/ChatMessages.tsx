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
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type { ExtendedUIMessage } from "@/lib/types/chat";
import type { ToolUIPart } from "ai";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import React, { useState } from "react";
import { FlashcardConfirmation } from "./FlashcardConfirmation";
import { isCreateFlashcardToolPart, getToolCallId } from "@/lib/types/tool-parts";

interface ChatMessagesProps {
  messages: ExtendedUIMessage[];
  isLoading: boolean;
  threadId: string | null;
}

/**
 * Component for displaying chat messages with streaming support
 */
export function ChatMessages({ messages, isLoading, threadId }: ChatMessagesProps) {
  const approveFlashcard = useMutation(api.features.chat.flashcardApprovals.approveFlashcard);
  const rejectFlashcard = useMutation(api.features.chat.flashcardApprovals.rejectFlashcard);
  const [processingApprovals, setProcessingApprovals] = useState<Set<string>>(new Set());

  // Query all approvals for this thread
  const threadApprovals = useQuery(
    api.features.chat.flashcardApprovals.getApprovalsByThread,
    threadId ? { threadId } : "skip"
  );

  // Create a map of approvals by toolCallId for O(1) lookup
  const approvalsByToolCallId = React.useMemo(() => {
    type ApprovalData = {
      _id: Id<"flashcardApprovals">;
      toolCallId: string;
      text: string;
      note: string;
      status: string;
    };
    
    const byToolCallId = new Map<string, ApprovalData>();
    
    if (!threadApprovals) {
      return byToolCallId;
    }
    
    for (const approval of threadApprovals) {
      byToolCallId.set(approval.toolCallId, approval);
    }
    
    return byToolCallId;
  }, [threadApprovals]);

  const handleApprove = async (approvalId: Id<"flashcardApprovals">) => {
    setProcessingApprovals((prev) => new Set(prev).add(approvalId));
    try {
      await approveFlashcard({ approvalId });
    } catch (error) {
      console.error("Failed to approve flashcard:", error);
    } finally {
      setProcessingApprovals((prev) => {
        const next = new Set(prev);
        next.delete(approvalId);
        return next;
      });
    }
  };

  const handleReject = async (approvalId: Id<"flashcardApprovals">) => {
    setProcessingApprovals((prev) => new Set(prev).add(approvalId));
    try {
      await rejectFlashcard({ approvalId });
    } catch (error) {
      console.error("Failed to reject flashcard:", error);
    } finally {
      setProcessingApprovals((prev) => {
        const next = new Set(prev);
        next.delete(approvalId);
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader size={24} />
      </div>
    );
  }

  return (
    <Conversation className="relative flex-1 h-full w-full overflow-hidden flex flex-col">
      

      <ConversationContent className="flex-1 overflow-y-auto px-4">
        {messages && messages.length > 0 ? (
          <>
            {messages.map((message: ExtendedUIMessage) => {
              const messageText = message.content ?? message.text ?? "";
              const isAssistantStreaming =
                message.role === "assistant" &&
                (message.status === "streaming" || message.status === "pending");

              return (
                <MessageBranch key={message.id} defaultBranch={0}>
                  <MessageBranchContent>
                    <Message from={message.role}>
                      <MessageContent>
                        {isAssistantStreaming && !messageText && !message.parts?.length ? (
                          <Shimmer>Thinking...</Shimmer>
                        ) : message.parts && message.parts.length > 0 ? (
                          // Render parts in order: text parts, tool calls, and confirmations
                          (() => {
                            const renderedTextParts = new Set<string>();
                            const renderedToolCalls = new Set<string>();
                            return (
                              <>
                                {message.parts.map((part, idx: number) => {
                                  // Render text parts (skip empty ones and duplicates)
                                  if (part.type === "text") {
                                    const textPart = part as { type: "text"; text: string };
                                    if (!textPart.text || textPart.text.trim() === "" || renderedTextParts.has(textPart.text)) {
                                      return null;
                                    }
                                    renderedTextParts.add(textPart.text);
                                    return (
                                      <MessageResponse key={`${message.id}-text-${idx}`}>
                                        {textPart.text}
                                      </MessageResponse>
                                    );
                                  }
                                  
                                  // Render tool calls (excluding createFlashcard)
                                  if (part.type.startsWith("tool-")) {
                                    const toolPart = part as ToolUIPart;
                                    const toolCallId = getToolCallId(toolPart);
                                    
                                    // Deduplicate tool calls by toolCallId if present
                                    if (toolCallId && renderedToolCalls.has(toolCallId)) {
                                      return null;
                                    }
                                    if (toolCallId) {
                                      renderedToolCalls.add(toolCallId);
                                    }

                                    const toolName = toolPart.type.replace("tool-", "");
                                    
                                    // Render createFlashcard as confirmation
                                    if (isCreateFlashcardToolPart(toolPart) && threadId) {
                                      return (
                                        <FlashcardConfirmation
                                          key={`${message.id}-flashcard-${idx}`}
                                          toolPart={toolPart}
                                          approvalsByToolCallId={approvalsByToolCallId}
                                          onApprove={handleApprove}
                                          onReject={handleReject}
                                          processingApprovals={processingApprovals}
                                        />
                                      );
                                    }
                                    
                                    // Render other tools normally
                                    return (
                                      <div key={`${message.id}-tool-${idx}`} className="mt-2">
                                        <Tool>
                                          <ToolHeader 
                                            title={toolName}
                                            type={toolPart.type}
                                            state={toolPart.state}
                                          />
                                          <ToolContent>
                                            <ToolInput input={toolPart.input} />
                                            <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
                                          </ToolContent>
                                        </Tool>
                                      </div>
                                    );
                                  }
                                  
                                  return null;
                                })}
                                {isAssistantStreaming && (
                                  <div className="mt-2">
                                    <Shimmer duration={1}>Thinking...</Shimmer>
                                  </div>
                                )}
                              </>
                            );
                          })()
                        ) : (
                          // Fallback to message content if no parts
                          <>
                            <MessageResponse>{messageText}</MessageResponse>
                            {isAssistantStreaming && messageText && (
                              <div className="mt-2">
                                <Shimmer duration={1}>Thinking...</Shimmer>
                              </div>
                            )}
                          </>
                        )}
                      </MessageContent>
                    </Message>
                  </MessageBranchContent>
                </MessageBranch>
              );
            })}
            

          </>
        ) : (
          <ConversationEmptyState
            title="No messages yet"
            description="Start a conversation to see messages here"
          />
        )}
      </ConversationContent>

      {/* 4. The Scroll Button:
         Placed outside ConversationContent but inside Conversation (relative).
         Ensure your UI library supports the 'sticky' or 'absolute' positioning here.
      */}
      <div className="absolute bottom-4 right-4 z-20">
        <ConversationScrollButton 
          className="static! rounded-lg bg-background dark:bg-background" 
          size="default"
        />
      </div>

    </Conversation>
  );
}


