import { useTranslations } from 'next-intl';
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
import { useSmoothText } from '@convex-dev/agent/react';
import type { ExtendedUIMessage } from '@/lib/types/chat';
import type { ToolUIPart } from 'ai';
import type { ReactNode } from 'react';
import { getToolCallId } from '@/lib/types/tool-parts';

// ---------------------------------------------------------------------------
// Extracted sub-components
// ---------------------------------------------------------------------------

function SmoothMessageResponse({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const [smoothText] = useSmoothText(text, { startStreaming: isStreaming });
  return <MessageResponse>{smoothText}</MessageResponse>;
}

function DefaultToolDisplay({
  toolPart,
  messageId,
  idx,
}: {
  toolPart: ToolUIPart;
  messageId: string;
  idx: number;
}) {
  const toolName = toolPart.type.replace('tool-', '');
  return (
    <div key={`${messageId}-tool-${idx}`} className="mt-2">
      <Tool>
        <ToolHeader title={toolName} type={toolPart.type} state={toolPart.state} />
        <ToolContent>
          <ToolInput input={toolPart.input} />
          <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
        </ToolContent>
      </Tool>
    </div>
  );
}

/**
 * Deduplicates text & tool parts, renders each via the appropriate component,
 * and appends a streaming indicator when the assistant is still generating.
 */
function MessageParts({
  message,
  isStreaming,
  toolRenderers,
  thinkingLabel,
}: {
  message: ExtendedUIMessage;
  isStreaming: boolean;
  toolRenderers?: Record<string, ToolRenderer>;
  thinkingLabel: string;
}) {
  const parts = message.parts!;
  const renderedTextParts = new Set<string>();
  const renderedToolCalls = new Set<string>();
  const elements: ReactNode[] = [];

  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx];

    if (part.type === 'text') {
      const { text } = part as { type: 'text'; text: string };
      if (!text || text.trim() === '' || renderedTextParts.has(text)) continue;
      renderedTextParts.add(text);

      elements.push(
        isStreaming ? (
          <SmoothMessageResponse
            key={`${message.id}-text-${idx}`}
            text={text}
            isStreaming
          />
        ) : (
          <MessageResponse key={`${message.id}-text-${idx}`}>
            {text}
          </MessageResponse>
        ),
      );
      continue;
    }

    if (part.type.startsWith('tool-')) {
      const toolPart = part as ToolUIPart;
      const toolCallId = getToolCallId(toolPart);
      if (toolCallId && renderedToolCalls.has(toolCallId)) continue;
      if (toolCallId) renderedToolCalls.add(toolCallId);

      const toolName = toolPart.type.replace('tool-', '');
      const custom = toolRenderers?.[toolName]?.(toolPart, message.id, idx);
      if (custom) {
        elements.push(custom);
        continue;
      }

      elements.push(
        <DefaultToolDisplay
          key={`${message.id}-tool-${idx}`}
          toolPart={toolPart}
          messageId={message.id}
          idx={idx}
        />,
      );
    }
  }

  return (
    <>
      {elements}
      {isStreaming && (
        <div key={`${message.id}-streaming`} className="mt-2">
          <Shimmer duration={1}>{thinkingLabel}</Shimmer>
        </div>
      )}
    </>
  );
}

function PlainTextContent({
  messageId,
  text,
  isStreaming,
  thinkingLabel,
}: {
  messageId: string;
  text: string;
  isStreaming: boolean;
  thinkingLabel: string;
}) {
  return (
    <>
      <MessageResponse>{text}</MessageResponse>
      {isStreaming && text && (
        <div key={`${messageId}-streaming`} className="mt-2">
          <Shimmer duration={1}>{thinkingLabel}</Shimmer>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Public types & main component
// ---------------------------------------------------------------------------

export type ToolRenderer = (
  toolPart: ToolUIPart,
  messageId: string,
  idx: number,
) => ReactNode | null;

export type MessageFooterRenderer = (
  message: ExtendedUIMessage,
) => ReactNode | null;

interface ChatMessagesProps {
  messages: ExtendedUIMessage[];
  isLoading: boolean;
  threadId: string | null;
  toolRenderers?: Record<string, ToolRenderer>;
  messageFooter?: MessageFooterRenderer;
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
  messageFooter,
  contentClassName,
}: ChatMessagesProps) {
  const t = useTranslations('Chat');

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader size={24} />
      </div>
    );
  }

  return (
    <div className="relative flex-1 h-full w-full flex flex-col overflow-hidden">
      <Conversation className="flex-1 h-full w-full">
        <ConversationContent className={`px-4 ${contentClassName ?? ''}`}>
          {messages && messages.length > 0 ? (
            <>
              {messages.map((message: ExtendedUIMessage) => {
                const messageText = message.content ?? message.text ?? '';
                const isAssistantStreaming =
                  message.role === 'assistant' &&
                  (message.status === 'streaming' ||
                    message.status === 'pending');

                const hasParts = message.parts && message.parts.length > 0;

                return (
                  <MessageBranch key={message.id} defaultBranch={0}>
                    <MessageBranchContent>
                      <Message from={message.role}>
                        <MessageContent>
                          {isAssistantStreaming && !messageText && !hasParts ? (
                            <Shimmer>{t('thinking')}</Shimmer>
                          ) : hasParts ? (
                            <MessageParts
                              message={message}
                              isStreaming={isAssistantStreaming}
                              toolRenderers={toolRenderers}
                              thinkingLabel={t('thinking')}
                            />
                          ) : (
                            <PlainTextContent
                              messageId={message.id}
                              text={messageText}
                              isStreaming={isAssistantStreaming}
                              thinkingLabel={t('thinking')}
                            />
                          )}
                        </MessageContent>
                      </Message>
                      {messageFooter &&
                        message.role === 'assistant' &&
                        messageFooter(message)}
                    </MessageBranchContent>
                  </MessageBranch>
                );
              })}
            </>
          ) : (
            <ConversationEmptyState
              title={t('emptyTitle')}
              description={t('emptyDescription')}
            />
          )}
        </ConversationContent>
      </Conversation>

      <div className="absolute bottom-4 right-4 z-20 pointer-events-none">
        <ConversationScrollButton
          className="pointer-events-auto rounded-lg bg-background dark:bg-background shadow-md"
          size="default"
        />
      </div>
    </div>
  );
}
