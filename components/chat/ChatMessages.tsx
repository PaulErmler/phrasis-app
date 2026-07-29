import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { BotIcon } from 'lucide-react';
import { MessageErrorBoundary } from '@/components/chat/MessageErrorBoundary';
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
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { useSmoothText } from '@convex-dev/agent/react';
import { dominantTextDirection } from '@/lib/languages';
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
  const [smoothText, { isStreaming: isSmoothTextStreaming }] = useSmoothText(text, { startStreaming: isStreaming });
  // Keep streaming mode active until smooth text has fully caught up,
  // preventing Streamdown from switching rendering paths mid-animation.
  const effectiveMode = isStreaming || isSmoothTextStreaming ? 'streaming' : 'static';
  const displayText = smoothText ?? text ?? '';
  // Bidi handling (dominant-script dir + text-left) lives inside
  // MessageResponse; the direction is computed from the FULL received text
  // rather than the animation buffer so a reply opening with an RTL token
  // doesn't flip to RTL until the English catches up.
  return (
    <MessageResponse mode={effectiveMode} dir={dominantTextDirection(text ?? '')}>
      {displayText}
    </MessageResponse>
  );
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
 * Deduplicates text & tool parts, renders each via the appropriate component
 * in their natural order to avoid layout shifts during streaming.
 */
function MessageParts({
  message,
  isStreaming,
  toolRenderers,
}: {
  message: ExtendedUIMessage;
  isStreaming: boolean;
  toolRenderers?: Record<string, ToolRenderer>;
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
        <SmoothMessageResponse
          key={`${message.id}-text-${idx}`}
          text={text}
          isStreaming={isStreaming}
        />,
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

  return <>{elements}</>;
}

function PlainTextContent({ text }: { text: string }) {
  return <MessageResponse>{text}</MessageResponse>;
}

// ---------------------------------------------------------------------------
// Memoized message row
// ---------------------------------------------------------------------------

interface ChatMessageRowProps {
  message: ExtendedUIMessage;
  toolRenderers?: Record<string, ToolRenderer>;
  messageFooter?: MessageFooterRenderer;
  errorFallback: string;
  errorRetryLabel: string;
  thinkingLabel: string;
}

/**
 * Cheap per-part signature for the row comparator: text length captures
 * streaming growth, tool state/id capture tool lifecycle transitions.
 */
function partsSignature(message: ExtendedUIMessage): string {
  const parts = message.parts;
  if (!parts || parts.length === 0) return '';
  let sig = '';
  for (const part of parts) {
    if (part.type === 'text') {
      sig += `t${(part as { text?: string }).text?.length ?? 0};`;
    } else if (part.type.startsWith('tool-')) {
      const toolPart = part as ToolUIPart;
      sig += `${toolPart.type}:${toolPart.state}:${getToolCallId(toolPart) ?? ''};`;
    } else {
      sig += `${part.type};`;
    }
  }
  return sig;
}

/**
 * useUIMessages rebuilds every message object on each streamed delta, so
 * object identity is useless — compare the fields that affect rendering by
 * value instead. Completed rows then bail out and only the streaming row
 * re-renders (and re-parses markdown) per token.
 */
function areRowPropsEqual(
  prev: ChatMessageRowProps,
  next: ChatMessageRowProps,
): boolean {
  const a = prev.message;
  const b = next.message;
  return (
    (a.key ?? a.id) === (b.key ?? b.id) &&
    a.status === b.status &&
    a.role === b.role &&
    (a.content ?? a.text ?? '') === (b.content ?? b.text ?? '') &&
    partsSignature(a) === partsSignature(b) &&
    prev.toolRenderers === next.toolRenderers &&
    prev.messageFooter === next.messageFooter &&
    prev.errorFallback === next.errorFallback &&
    prev.errorRetryLabel === next.errorRetryLabel &&
    prev.thinkingLabel === next.thinkingLabel
  );
}

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  toolRenderers,
  messageFooter,
  errorFallback,
  errorRetryLabel,
  thinkingLabel,
}: ChatMessageRowProps) {
  const messageText = message.content ?? message.text ?? '';
  const isAssistantStreaming =
    message.role === 'assistant' &&
    (message.status === 'streaming' || message.status === 'pending');

  const hasParts = message.parts && message.parts.length > 0;
  const hasVisibleParts =
    hasParts &&
    message.parts!.some(
      (p) =>
        (p.type === 'text' && (p as { text: string }).text?.trim()) ||
        p.type.startsWith('tool-'),
    );

  return (
    <MessageBranch defaultBranch={0}>
      <MessageBranchContent>
        <MessageErrorBoundary
          fallbackMessage={errorFallback}
          retryLabel={errorRetryLabel}
        >
          <Message from={message.role}>
            <MessageContent>
              {isAssistantStreaming && !messageText && !hasVisibleParts ? (
                <Shimmer>{thinkingLabel}</Shimmer>
              ) : hasParts ? (
                <MessageParts
                  message={message}
                  isStreaming={isAssistantStreaming}
                  toolRenderers={toolRenderers}
                />
              ) : (
                <PlainTextContent text={messageText} />
              )}
            </MessageContent>
          </Message>
          {messageFooter &&
            message.role === 'assistant' &&
            messageFooter(message)}
        </MessageErrorBoundary>
      </MessageBranchContent>
    </MessageBranch>
  );
}, areRowPropsEqual);

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
  toolRenderers,
  messageFooter,
  contentClassName,
}: ChatMessagesProps) {
  const t = useTranslations('Chat');

  const visibleMessages = messages?.filter((m) => m.role !== 'system') ?? [];
  const displayMessages = isLoading ? [] : visibleMessages;

  return (
    <div className="relative flex-1 h-full w-full flex flex-col overflow-hidden">
      <Conversation className="flex-1 h-full w-full">
        <ConversationContent className={`px-4 ${contentClassName ?? ''}`}>
          {displayMessages.length > 0 ? (
            <>
              {displayMessages.map((message: ExtendedUIMessage) => (
                <ChatMessageRow
                  key={message.key ?? message.id}
                  message={message}
                  toolRenderers={toolRenderers}
                  messageFooter={messageFooter}
                  errorFallback={t('messageError.title')}
                  errorRetryLabel={t('messageError.retry')}
                  thinkingLabel={t('thinking')}
                />
              ))}
            </>
          ) : !isLoading ? (
            <ConversationEmptyState title={t('emptyTitle')}>
              <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <BotIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                <span>{t('aiNotice')}</span>
              </div>
              <ul className="text-muted-foreground text-sm space-y-1.5 text-left list-none">
                {(['emptyBullet1', 'emptyBullet2', 'emptyBullet3'] as const).map((key) => (
                  <li key={key} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
                    {t(key)}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground/80 text-left">
                {t('emptyCreditsNote')}
              </p>
            </ConversationEmptyState>
          ) : null}
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
