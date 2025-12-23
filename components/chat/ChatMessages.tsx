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
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

interface ChatMessagesProps {
  messages: ExtendedUIMessage[];
  isLoading: boolean;
  threadId: string | null;
}

/**
 * Component for displaying chat messages with streaming support
 */
export function ChatMessages({ messages, isLoading, threadId }: ChatMessagesProps) {
  const approveFlashcard = useMutation(api.chat.flashcardApprovals.approveFlashcard);
  const rejectFlashcard = useMutation(api.chat.flashcardApprovals.rejectFlashcard);
  const [processingApprovals, setProcessingApprovals] = useState<Set<string>>(new Set());

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
                      {isAssistantStreaming && !messageText && !message.parts?.length ? (
                        <Shimmer>Thinking...</Shimmer>
                      ) : message.parts && message.parts.length > 0 ? (
                        // Render parts in order: text parts, tool calls, and confirmations
                        <>
                          {message.parts.map((part, idx: number) => {
                            // Render text parts (skip empty ones)
                            if (part.type === "text") {
                              const textPart = part as { type: "text"; text: string };
                              if (!textPart.text || textPart.text.trim() === "") {
                                return null;
                              }
                              return (
                                <MessageResponse key={`${message.id}-text-${idx}`}>
                                  {textPart.text}
                                </MessageResponse>
                              );
                            }
                            
                            // Render tool calls (excluding createFlashcard)
                            if (part.type.startsWith("tool-")) {
                              const toolPart = part as ToolUIPart;
                              const toolName = toolPart.type.replace("tool-", "");
                              
                              // Render createFlashcard as confirmation
                              if (toolName === "createFlashcard" && threadId) {
                                return (
                                  <FlashcardConfirmation
                                    key={`${message.id}-flashcard-${idx}`}
                                    threadId={threadId}
                                    messageId={message.id}
                                    toolPart={toolPart}
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

/**
 * Component for displaying flashcard confirmation
 */
interface FlashcardConfirmationProps {
  threadId: string;
  messageId: string;
  toolPart: ToolUIPart;
  onApprove: (approvalId: Id<"flashcardApprovals">) => Promise<void>;
  onReject: (approvalId: Id<"flashcardApprovals">) => Promise<void>;
  processingApprovals: Set<string>;
}

function FlashcardConfirmation({
  threadId,
  messageId,
  toolPart,
  onApprove,
  onReject,
  processingApprovals,
}: FlashcardConfirmationProps) {
  const t = useTranslations("Chat.flashcardConfirmation");
  const [approvalId, setApprovalId] = useState<Id<"flashcardApprovals"> | null>(null);
  const [approvalState, setApprovalState] = useState<"pending" | "approved" | "rejected">("pending");
  const createApprovalRequest = useMutation(api.chat.flashcardApprovals.createApprovalRequest);
  
  // Extract stable values from toolPart
  const input = toolPart.input as Record<string, unknown>;
  const text = (input?.text as string) || "";
  const note = (input?.note as string) || "";
  
  // Extract toolCallId value (stable across renders)
  const toolCallId = (toolPart as Record<string, unknown>).toolCallId as string;
  

  
  // Create approval request on mount (only once per unique toolCallId)
  useEffect(() => {
    if (!approvalId) {
      createApprovalRequest({
        threadId,
        messageId,
        toolCallId,
        text,
        note,
      })
        .then((id) => {
          setApprovalId(id);
        })
        .catch((error) => {
          console.error("Failed to create approval request:", error);
        });
    }
  }, [approvalId, createApprovalRequest, threadId, messageId, toolCallId, text, note]);
  
  const handleApprovalClick = async () => {
    if (!approvalId) return;
    await onApprove(approvalId);
    setApprovalState("approved");
  };
  
  const handleRejectionClick = async () => {
    if (!approvalId) return;
    await onReject(approvalId);
    setApprovalState("rejected");
  };
  
  const isProcessing = approvalId ? processingApprovals.has(approvalId) : false;
  
  if (approvalState === "approved") {
    return (
      <Alert className="my-3 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <AlertDescription className="text-green-700 dark:text-green-300">
          ✓ {t("approved")}
        </AlertDescription>
      </Alert>
    );
  }
  
  if (approvalState === "rejected") {
    return (
      <Alert className="my-3 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
        <AlertDescription className="text-red-700 dark:text-red-300">
          {t("rejected")}
        </AlertDescription>
      </Alert>
    );
  }
  
  return (
    <Alert className="my-3 flex flex-col gap-3">
      <AlertDescription>
        <div className="space-y-2 text-sm">
          <p><strong>{t("textLabel")}:</strong> {text}</p>
          <p><strong>{t("noteLabel")}:</strong> {note}</p>
        </div>
      </AlertDescription>
      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={handleRejectionClick}
          disabled={isProcessing || !approvalId}
          variant="outline"
          size="sm"
          className="h-8 px-3 text-sm"
        >
          {t("rejectButton")}
        </Button>
        <Button
          onClick={handleApprovalClick}
          disabled={isProcessing || !approvalId}
          size="sm"
          className="h-8 px-3 text-sm"
        >
          {t("approveButton")}
        </Button>
      </div>
    </Alert>
  );
}

