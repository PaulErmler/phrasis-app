'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { MessageSquarePlus } from 'lucide-react';
import { useChat } from '@/hooks/use-chat';
import { ChatMessages } from '@/components/chat/ChatMessages';
import type { ToolRenderer, MessageFooterRenderer } from '@/components/chat/ChatMessages';
import { ChatInput } from '@/components/chat/ChatInput';
import { Button } from '@/components/ui/button';
import type { Id } from '@/convex/_generated/dataModel';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { THREAD_MESSAGE_LIMIT } from '@/convex/features/chat/constants';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { cn } from '@/lib/utils';

interface ChatPanelProps {
  threadId: string;
  toolRenderers?: Record<string, ToolRenderer>;
  messageFooter?: MessageFooterRenderer;
  cardId?: Id<'cards'>;
  onMessageSent?: () => void;
  onNewChat?: () => void;
  showSuggestions?: boolean;
  suggestions?: readonly string[];
  className?: string;
  header?: ReactNode;
  footerAction?: ReactNode;
  suggestionsAction?: ReactNode;
  /** Renders above the footer (mobile only), e.g. back button matching open-chat style */
  aboveFooterAction?: ReactNode;
}

/**
 * Reusable, embeddable chat panel combining messages and input.
 * Can be dropped into any layout — standalone page, sidebar, or overlay.
 */
export function ChatPanel({
  threadId,
  toolRenderers,
  messageFooter,
  cardId,
  onMessageSent,
  onNewChat,
  showSuggestions,
  suggestions,
  className,
  header,
  footerAction,
  suggestionsAction,
  aboveFooterAction,
}: ChatPanelProps) {
  const { isAvailable } = useFeatureQuota(FEATURE_IDS.CHAT_MESSAGES);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const [serverThreadLimitReached, setServerThreadLimitReached] = useState(false);
  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    if (threadId !== prevThreadIdRef.current) {
      prevThreadIdRef.current = threadId;
      setServerThreadLimitReached(false);
    }
  }, [threadId]);

  const handleUsageLimit = useCallback(() => {
    setPaywallOpen(true);
  }, []);

  const handleThreadLimit = useCallback(() => {
    setServerThreadLimitReached(true);
  }, []);

  const chat = useChat({ threadId, cardId, onUsageLimit: handleUsageLimit, onThreadLimit: handleThreadLimit });
  const t = useTranslations('Chat.attachments');
  const tLimit = useTranslations('Chat.threadLimit');

  const userMessageCount = useMemo(
    () => chat.messages.filter((m) => m.role === 'user').length,
    [chat.messages],
  );
  const isThreadLimitReached = serverThreadLimitReached || userMessageCount >= THREAD_MESSAGE_LIMIT;

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);

      if (!(hasText || hasAttachments)) return;

      if (isThreadLimitReached) return;

      if (!isAvailable) {
        setPaywallOpen(true);
        return;
      }

      if (message.files?.length) {
        toast.success(t('filesAttached'), {
          description: t('filesAttachedDescription', { count: message.files.length }),
        });
      }

      await chat.sendMessage(message.text || t('sentWithAttachments'));
      onMessageSent?.();
    },
    [chat, onMessageSent, t, isAvailable, isThreadLimitReached],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      chat.setText(suggestion);
    },
    [chat],
  );

  return (
    <div className="flex flex-col h-full w-full min-w-0">
      {header}

      <div className={cn("flex-1 min-h-0 relative px-4 pt-2 w-full", className)}>
        <ChatMessages
          messages={chat.messages}
          isLoading={chat.isLoading}
          threadId={threadId}
          toolRenderers={toolRenderers}
          messageFooter={messageFooter}
          contentClassName={aboveFooterAction ? 'pb-12 lg:pb-0' : undefined}
        />
        {aboveFooterAction && (
          <div className="absolute bottom-3 left-4 lg:hidden z-10">
            {aboveFooterAction}
          </div>
        )}
      </div>

      <div className="flex-none border-t bg-background">
        <div className={cn("p-4", className)}>
          {isThreadLimitReached ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <p className="text-sm text-muted-foreground">
                {tLimit('reached')}
              </p>
              {onNewChat && (
                <Button onClick={onNewChat} className="gap-2">
                  <MessageSquarePlus className="h-4 w-4" />
                  {tLimit('newConversation')}
                </Button>
              )}
            </div>
          ) : (
            <ChatInput
              onSubmit={handleSubmit}
              onSuggestionClick={handleSuggestionClick}
              text={chat.text}
              onTextChange={chat.setText}
              status={chat.status}
              isRecording={chat.voice.isRecording}
              isTranscribing={chat.voice.isTranscribing}
              onVoiceClick={chat.voice.toggle}
              suggestions={suggestions}
                showSuggestions={
                  !chat.isLoading && (showSuggestions ?? chat.messages.length === 0)
                }
              footerAction={
                <>
                  {footerAction}
                  <FeatureBadge featureId={FEATURE_IDS.CHAT_MESSAGES} />
                </>
              }
              suggestionsAction={suggestionsAction}
            />
          )}
        </div>
      </div>

      {paywallOpen && (
        <PaywallDialog
          open={paywallOpen}
          setOpen={setPaywallOpen}
          featureId={FEATURE_IDS.CHAT_MESSAGES}
        />
      )}
    </div>
  );
}
