'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';

import { ChatInput } from '@/components/chat/ChatInput';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import PaywallDialog from '@/components/autumn/paywall-dialog';

import { useVoiceRecording } from '@/hooks/use-voice-recording';

import { CHAT_STATUS } from '@/lib/constants/chat';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';

interface NewChatInputProps {
  placeholder?: string;
  className?: string;
  showSuggestions?: boolean;
  onChatCreated?: (threadId: string) => void;
}

/**
 * Component for initiating new chat conversations
 *
 * Handles the complete flow of starting a new chat:
 * - User input (text + voice + files)
 * - Thread creation
 * - Initial message sending
 * - Navigation to chat page
 *
 * This component is typically used on the home page to start new conversations.
 */
export function NewChatInput({
  className,
  showSuggestions = true,
  onChatCreated,
}: NewChatInputProps) {
  const t = useTranslations('Chat.errors');
  const router = useRouter();
  const [text, setText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const { isAvailable } = useFeatureQuota(FEATURE_IDS.CHAT_MESSAGES);

  // Voice recording
  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (transcript) => {
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    },
  );

  // Mutations
  const createThread = useMutation(api.features.chat.threads.createThread);
  const sendMessageMutation = useMutation(
    api.features.chat.messages.sendMessage,
  );

  // Handle chat initiation - create thread, send message, route to chat
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (!message.text?.trim()) return;

      if (!isAvailable) {
        setPaywallOpen(true);
        return;
      }

      setIsProcessing(true);

      try {
        const threadId = await createThread({});

        await sendMessageMutation({
          threadId,
          prompt: message.text,
        });

        setText('');
        if (onChatCreated) {
          onChatCreated(threadId);
        } else {
          router.push(`/app/chat/${threadId}`);
        }
      } catch (error) {
        if (
          error instanceof ConvexError &&
          (error.data as { code?: string })?.code === 'USAGE_LIMIT'
        ) {
          setPaywallOpen(true);
          setIsProcessing(false);
          return;
        }
        console.error('Failed to start chat:', error);
        toast.error(t('failedToCreateThread'));
        setIsProcessing(false);
      }
    },
    [createThread, sendMessageMutation, router, isAvailable, t, onChatCreated],
  );

  // Handle suggestion click - populate input instead of sending
  const handleSuggestionClick = useCallback((suggestion: string) => {
    setText(suggestion);
  }, []);

  return (
    <div className={className}>
      <ChatInput
        onSubmit={handleSubmit}
        onSuggestionClick={handleSuggestionClick}
        text={text}
        onTextChange={setText}
        status={isProcessing ? CHAT_STATUS.SUBMITTED : CHAT_STATUS.READY}
        isRecording={isRecording}
        isTranscribing={isTranscribing}
        onVoiceClick={handleVoiceClick}
        showSuggestions={showSuggestions}
        footerAction={<FeatureBadge featureId={FEATURE_IDS.CHAT_MESSAGES} />}
      />
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
