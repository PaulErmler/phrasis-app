'use client';

import { useState, useCallback } from 'react';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { useVoiceRecording } from '@/hooks/use-voice-recording';
import { useChatMessages } from '@/hooks/use-chat-messages';
import { useSendMessage } from '@/hooks/use-send-message';

import { ChatMessages } from '@/components/chat/ChatMessages';
import { ChatInput } from '@/components/chat/ChatInput';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import PaywallDialog from '@/components/autumn/paywall-dialog';

interface SimplifiedChatViewProps {
  threadId: string; // Always provided, never null
}

/**
 * Simplified chat view that just displays and manages an existing conversation.
 * No thread creation or initialization logic - that's handled by SearchBar.
 */
export function SimplifiedChatView({ threadId }: SimplifiedChatViewProps) {
  const t = useTranslations('Chat.attachments');
  const [text, setText] = useState<string>('');
  const [paywallOpen, setPaywallOpen] = useState(false);
  const { isAvailable } = useFeatureQuota(FEATURE_IDS.CHAT_MESSAGES);

  const { messages, status, setStatus } = useChatMessages({ threadId });

  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (transcript) => {
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    },
  );

  const handleUsageLimit = useCallback(() => {
    setPaywallOpen(true);
  }, []);

  const { sendMessage } = useSendMessage({
    threadId,
    setStatus,
    onUsageLimit: handleUsageLimit,
  });

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);

      if (!(hasText || hasAttachments)) {
        return;
      }

      if (!isAvailable) {
        setPaywallOpen(true);
        return;
      }

      if (message.files?.length) {
        toast.success(t('filesAttached'), {
          description: t('filesAttachedDescription', { count: message.files.length }),
        });
      }

      await sendMessage({
        prompt: message.text || t('sentWithAttachments'),
        clearInput: () => setText(''),
      });
    },
    [sendMessage, isAvailable, t],
  );

  // Handle suggestion click
  const handleSuggestionClick = useCallback((suggestion: string) => {
    setText(suggestion);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 container mx-auto px-4 pb-4 pt-2">
        <ChatMessages
          messages={messages}
          isLoading={false}
          threadId={threadId}
        />
      </div>

      <div className="flex-none p-4 border-t bg-background">
        <ChatInput
          onSubmit={handleSubmit}
          onSuggestionClick={handleSuggestionClick}
          text={text}
          onTextChange={setText}
          status={status}
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          onVoiceClick={handleVoiceClick}
          showSuggestions={messages.length === 0}
          footerAction={<FeatureBadge featureId={FEATURE_IDS.CHAT_MESSAGES} />}
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
