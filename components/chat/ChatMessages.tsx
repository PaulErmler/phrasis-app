import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  MessageBranch,
  MessageBranchContent,
} from '@/components/ai-elements/message';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { MessageResponse } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Loader } from '@/components/ai-elements/loader';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import type { ExtendedUIMessage } from '@/lib/types/chat';
import type { ToolUIPart } from 'ai';
import type { ReactNode } from 'react';
import { getToolCallId } from '@/lib/types/tool-parts';

export type ToolRenderer = (
  toolPart: ToolUIPart,
  messageId: string,
  idx: number,
) => ReactNode | null;

interface ChatMessagesProps {
  messages: ExtendedUIMessage[];
  isLoading: boolean;
  threadId: string | null;
  toolRenderers?: Record<string, ToolRenderer>;
  contentClassName?: string;
}

/**
 * Component for displaying chat messages with streaming support.
 * Tool rendering is pluggable via `toolRenderers` — a map from
 * tool name (without "tool-" prefix) to a renderer function.
 */
export function ChatMessages({
  messages,
  isLoading,
  threadId,
  toolRenderers,
  contentClassName,
}: ChatMessagesProps) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader size={24} />
      </div>
    );
  }

  return (
    <Conversation className="relative flex-1 h-full w-full overflow-hidden flex flex-col">
      <ConversationContent className={`flex-1 overflow-y-auto px-4 ${contentClassName ?? ''}`}>
        {messages && messages.length > 0 ? (
          <>
            {messages.map((message: ExtendedUIMessage) => {
              const messageText = message.content ?? message.text ?? '';
              const isAssistantStreaming =
                message.role === 'assistant' &&
                (message.status === 'streaming' ||
                  message.status === 'pending');

              return (
                <MessageBranch key={message.id} defaultBranch={0}>
                  <MessageBranchContent>
                    <Message from={message.role}>
                      <MessageContent>
                        {isAssistantStreaming &&
                        !messageText &&
                        !message.parts?.length ? (
                            <Shimmer>Thinking...</Shimmer>
                          ) : message.parts && message.parts.length > 0 ? (
                            (() => {
                              const renderedTextParts = new Set<string>();
                              const renderedToolCalls = new Set<string>();
                              return (
                                <>
                                  {message.parts.map((part, idx: number) => {
                                    if (part.type === 'text') {
                                      const textPart = part as {
                                      type: 'text';
                                      text: string;
                                    };
                                      if (
                                        !textPart.text ||
                                      textPart.text.trim() === '' ||
                                      renderedTextParts.has(textPart.text)
                                      ) {
                                        return null;
                                      }
                                      renderedTextParts.add(textPart.text);
                                      return (
                                        <MessageResponse
                                          key={`${message.id}-text-${idx}`}
                                        >
                                          {textPart.text}
                                        </MessageResponse>
                                      );
                                    }

                                    if (part.type.startsWith('tool-')) {
                                      const toolPart = part as ToolUIPart;
                                      const toolCallId = getToolCallId(toolPart);

                                      if (
                                        toolCallId &&
                                      renderedToolCalls.has(toolCallId)
                                      ) {
                                        return null;
                                      }
                                      if (toolCallId) {
                                        renderedToolCalls.add(toolCallId);
                                      }

                                      const toolName = toolPart.type.replace(
                                        'tool-',
                                        '',
                                      );

                                      // Try pluggable renderer first
                                      if (toolRenderers?.[toolName]) {
                                        const rendered = toolRenderers[toolName](
                                          toolPart,
                                          message.id,
                                          idx,
                                        );
                                        if (rendered) return rendered;
                                      }

                                      // Fallback: generic tool UI
                                      return (
                                        <div
                                          key={`${message.id}-tool-${idx}`}
                                          className="mt-2"
                                        >
                                          <Tool>
                                            <ToolHeader
                                              title={toolName}
                                              type={toolPart.type}
                                              state={toolPart.state}
                                            />
                                            <ToolContent>
                                              <ToolInput input={toolPart.input} />
                                              <ToolOutput
                                                output={toolPart.output}
                                                errorText={toolPart.errorText}
                                              />
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

      <div className="absolute bottom-4 right-4 z-20">
        <ConversationScrollButton
          className="static! rounded-lg bg-background dark:bg-background"
          size="default"
        />
      </div>
    </Conversation>
  );
}
