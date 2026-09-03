import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, BotIcon } from 'lucide-react';
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
import type { ChatStatus, ExtendedUIMessage } from '@/lib/types/chat';
import { CHAT_STATUS } from '@/lib/constants/chat';
import type { ToolUIPart } from 'ai';
import type { ReactNode } from 'react';
import { getToolCallId } from '@/lib/types/tool-parts';

function isReasoningPart(type: string): boolean {
  return type === 'reasoning' || type === 'redacted-reasoning';
}

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
  const [smoothText, { isStreaming: isSmoothTextStreaming }] = useSmoothText(
    text,
    { startStreaming: isStreaming },
  );
  // Keep streaming mode active until smooth text has fully caught up,
  // preventing Streamdown from switching rendering paths mid-animation.
  const effectiveMode =
    isStreaming || isSmoothTextStreaming ? 'streaming' : 'static';
  const displayText = smoothText ?? text ?? '';
  // Bidi handling (dominant-script dir + text-left) lives inside
  // MessageResponse; the direction is computed from the FULL received text
  // rather than the animation buffer so a reply opening with an RTL token
  // doesn't flip to RTL until the English catches up.
  return (
    <MessageResponse
      mode={effectiveMode}
      dir={dominantTextDirection(text ?? '')}
    >
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

    // Reasoning stays off-screen: the row shows a Thinking shimmer until
    // visible text or a tool part arrives.
    if (isReasoningPart(part.type)) continue;

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

/**
 * Shown in place of (or under the partial content of) a reply whose
 * generation failed server-side, e.g. an upstream rate limit. Without this
 * the failed row rendered as an empty bubble and the thread just went quiet.
 */
function FailedReplyNotice({
  label,
  retryLabel,
  onRetry,
  disabled,
}: {
  label: string;
  retryLabel: string;
  onRetry?: () => void;
  disabled: boolean;
}) {
  return (
    <div
      role="alert"
      data-testid="chat-reply-failed"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-muted-foreground"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/70" />
      <span>{label}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          data-testid="chat-reply-retry"
          className="ml-auto shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memoized message row
// ---------------------------------------------------------------------------

interface ChatMessageRowProps {
  message: ExtendedUIMessage;
  isLastMessage: boolean;
  toolRenderers?: Record<string, ToolRenderer>;
  messageFooter?: MessageFooterRenderer;
  errorFallback: string;
  errorRetryLabel: string;
  thinkingLabel: string;
  replyFailedLabel: string;
  replyRetryLabel: string;
  onRetry?: (messageId: string) => void;
  /** A send or retry is already in flight: the retry button waits. */
  retryDisabled: boolean;
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
    } else if (isReasoningPart(part.type)) {
      continue;
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
 * object identity is useless. Compare the fields that affect rendering by
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
    prev.isLastMessage === next.isLastMessage &&
    prev.toolRenderers === next.toolRenderers &&
    prev.messageFooter === next.messageFooter &&
    prev.errorFallback === next.errorFallback &&
    prev.errorRetryLabel === next.errorRetryLabel &&
    prev.thinkingLabel === next.thinkingLabel &&
    prev.replyFailedLabel === next.replyFailedLabel &&
    prev.replyRetryLabel === next.replyRetryLabel &&
    prev.onRetry === next.onRetry &&
    prev.retryDisabled === next.retryDisabled
  );
}

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  isLastMessage,
  toolRenderers,
  messageFooter,
  errorFallback,
  errorRetryLabel,
  thinkingLabel,
  replyFailedLabel,
  replyRetryLabel,
  onRetry,
  retryDisabled,
}: ChatMessageRowProps) {
  const messageText = message.content ?? message.text ?? '';
  const isAssistantStreaming =
    message.role === 'assistant' &&
    (message.status === 'streaming' || message.status === 'pending');
  const isFailedReply =
    message.role === 'assistant' && message.status === 'failed';

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
              ) : hasVisibleParts ? (
                <MessageParts
                  message={message}
                  isStreaming={isAssistantStreaming}
                  toolRenderers={toolRenderers}
                />
              ) : isFailedReply ? null : (
                <PlainTextContent text={messageText} />
              )}
              {isFailedReply && (
                <FailedReplyNotice
                  label={replyFailedLabel}
                  retryLabel={replyRetryLabel}
                  onRetry={onRetry ? () => onRetry(message.id) : undefined}
                  disabled={retryDisabled}
                />
              )}
            </MessageContent>
          </Message>
          {messageFooter &&
            message.role === 'assistant' &&
            messageFooter(message, { isLastMessage })}
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
  meta: { isLastMessage: boolean },
) => ReactNode | null;

interface ChatMessagesProps {
  messages: ExtendedUIMessage[];
  isLoading: boolean;
  threadId: string | null;
  toolRenderers?: Record<string, ToolRenderer>;
  messageFooter?: MessageFooterRenderer;
  contentClassName?: string;
  /** Rendered inside the empty state, below the intro bullets (e.g. quick-action tiles). */
  emptyStateExtra?: ReactNode;
  /**
   * Show the empty state while the thread's messages are still loading
   * instead of a blank pane. For surfaces whose threads are known to be
   * empty on arrival (the learn view rotates to a fresh thread per card), so
   * the quick-action tiles appear at once rather than after a round trip.
   */
  emptyStateWhileLoading?: boolean;
  /** Composer status. Shows thinking before the assistant message exists. */
  status?: ChatStatus;
  /** Generate a failed reply again; the failed row offers a retry button when set. */
  onRetry?: (messageId: string) => void;
}

/**
 * Component for displaying chat messages with streaming support.
 * Tool rendering is pluggable via `toolRenderers`. A map from
 * tool name (without "tool-" prefix) to a renderer function.
 */
export function ChatMessages({
  messages,
  isLoading,
  toolRenderers,
  messageFooter,
  contentClassName,
  emptyStateExtra,
  emptyStateWhileLoading = false,
  status,
  onRetry,
}: ChatMessagesProps) {
  const t = useTranslations('Chat');
  const retryDisabled =
    status === CHAT_STATUS.SUBMITTED || status === CHAT_STATUS.STREAMING;

  const visibleMessages = messages?.filter((m) => m.role !== 'system') ?? [];
  const displayMessages = isLoading ? [] : visibleMessages;
  const lastMessage = displayMessages[displayMessages.length - 1];
  const showPendingThinking =
    (status === CHAT_STATUS.SUBMITTED || status === CHAT_STATUS.STREAMING) &&
    lastMessage?.role === 'user';

  return (
    <div className="relative flex-1 h-full w-full flex flex-col overflow-hidden">
      <Conversation className="flex-1 h-full w-full">
        <ConversationContent className={`px-4 ${contentClassName ?? ''}`}>
          {displayMessages.length > 0 ? (
            <>
              {displayMessages.map(
                (message: ExtendedUIMessage, index: number) => (
                  <ChatMessageRow
                    key={message.key ?? message.id}
                    message={message}
                    isLastMessage={index === displayMessages.length - 1}
                    toolRenderers={toolRenderers}
                    messageFooter={messageFooter}
                    errorFallback={t('messageError.title')}
                    errorRetryLabel={t('messageError.retry')}
                    thinkingLabel={t('thinking')}
                    replyFailedLabel={t('replyFailed.title')}
                    replyRetryLabel={t('replyFailed.retry')}
                    onRetry={onRetry}
                    retryDisabled={retryDisabled}
                  />
                ),
              )}
              {showPendingThinking ? (
                <Message from="assistant">
                  <MessageContent>
                    <Shimmer>{t('thinking')}</Shimmer>
                  </MessageContent>
                </Message>
              ) : null}
            </>
          ) : !isLoading || emptyStateWhileLoading ? (
            <ConversationEmptyState>
              <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <BotIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                <span>{t('aiNotice')}</span>
              </div>
              {emptyStateExtra}
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
