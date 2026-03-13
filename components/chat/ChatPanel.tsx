'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useChat } from '@/hooks/use-chat';
import { ChatMessages } from '@/components/chat/ChatMessages';
import type { ToolRenderer, MessageFooterRenderer } from '@/components/chat/ChatMessages';
import { ChatInput } from '@/components/chat/ChatInput';
import type { Id } from '@/convex/_generated/dataModel';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import PaywallDialog from '@/components/autumn/paywall-dialog';

interface ChatPanelProps {
  threadId: string;
  toolRenderers?: Record<string, ToolRenderer>;
  messageFooter?: MessageFooterRenderer;
  cardId?: Id<'cards'>;
  onMessageSent?: () => void;
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

  const handleUsageLimit = useCallback(() => {
    setPaywallOpen(true);
  }, []);

  const chat = useChat({ threadId, cardId, onUsageLimit: handleUsageLimit });
  const t = useTranslations('Chat.attachments');

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);

      if (!(hasText || hasAttachments)) return;

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
    [chat, onMessageSent, t, isAvailable],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      chat.setText(suggestion);
    },
    [chat],
  );

  return (
    <div className={`flex flex-col h-full w-full min-w-0 ${className ?? ''}`}>
      {header}

      <div className="flex-1 min-h-0 relative px-4 pt-2">
        <ChatMessages
          messages={chat.messages}
          isLoading={false}
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

      <div className="flex-none p-4 border-t bg-background">
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
            showSuggestions ?? chat.messages.length === 0
          }
          footerAction={
            <>
              {footerAction}
              <FeatureBadge featureId={FEATURE_IDS.CHAT_MESSAGES} />
            </>
          }
          suggestionsAction={suggestionsAction}
        />
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
