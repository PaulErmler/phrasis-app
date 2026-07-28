'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'convex/react';
import { useTranslations } from 'next-intl';
import {
  Sparkles,
  Mic,
  ArrowUp,
  Square,
  Loader2,
  Lock,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/convex/_generated/api';
import { useVoiceRecording } from '@/hooks/use-voice-recording';
import { useImeSafeEnter } from '@/hooks/use-ime-safe-enter';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import LowQuotaDialog from '@/components/autumn/low-quota-dialog';
import UsageLimitDialog from '@/components/autumn/usage-limit-dialog';
import { cn, convexErrorCode, isPaymentPastDueError } from '@/lib/utils';

/**
 * Compact single-row chat-input surface used on the home view. Matches the
 * "prototype J" design: Sparkles prefix → text input → voice button → send
 * button, with a low-quota bar appended underneath when the user is close to
 * or has hit their monthly message limit.
 *
 * Deliberately simpler than {@link NewChatInput} (no suggestions, no
 * multi-line textarea, no character counter) because the home-view input is
 * a quick-start shortcut — full chat composition happens after navigation.
 */

const LOW_BALANCE_THRESHOLD = 5;

interface HomeChatInputProps {
  /** If provided, receives the new thread id and is responsible for opening
   * the chat view. Otherwise the input routes to `/app/chat/<threadId>`. */
  onChatCreated?: (threadId: string) => void;
}

export function HomeChatInput({ onChatCreated }: HomeChatInputProps) {
  const t = useTranslations('Chat.input');
  const tErrors = useTranslations('Chat.errors');
  const tQuota = useTranslations('FeatureTracking');
  const router = useRouter();
  const { compositionProps, isComposingEvent } = useImeSafeEnter();

  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [lowQuotaOpen, setLowQuotaOpen] = useState(false);

  const {
    isAvailable,
    balance,
    unlimited,
    isLoading: quotaLoading,
  } = useFeatureQuota(FEATURE_IDS.CHAT_MESSAGES);

  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (transcript) => {
      setText((prev) => (prev ? `${prev.trimEnd()} ${transcript}` : transcript));
    },
  );

  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );
  const sendMessageMutation = useMutation(
    api.features.chat.messages.sendMessage,
  );

  const handleSubmit = useCallback(async () => {
    const prompt = text.trim();
    if (!prompt) return;

    if (!isAvailable) {
      setPaywallOpen(true);
      return;
    }

    setIsProcessing(true);
    try {
      const threadId = await getOrCreateEmptyThread({});
      await sendMessageMutation({ threadId, prompt });
      setText('');
      setIsProcessing(false);
      if (onChatCreated) {
        onChatCreated(threadId);
      } else {
        router.push(`/app/chat/${threadId}`);
      }
    } catch (error) {
      // Silent: the reactive payment-overdue dialog is the canonical
      // surface for this state (see isPaymentPastDueError).
      if (isPaymentPastDueError(error)) {
        setIsProcessing(false);
        return;
      }
      if (convexErrorCode(error) === 'USAGE_LIMIT') {
        setPaywallOpen(true);
        setIsProcessing(false);
        return;
      }
      if (convexErrorCode(error) === 'MESSAGE_TOO_LONG') {
        toast.error(tErrors('messageTooLong'));
        setIsProcessing(false);
        return;
      }
      console.error('Failed to start chat:', error);
      toast.error(tErrors('failedToCreateThread'));
      setIsProcessing(false);
    }
  }, [
    text,
    isAvailable,
    getOrCreateEmptyThread,
    sendMessageMutation,
    onChatCreated,
    router,
    tErrors,
  ]);

  const canSubmit =
    text.trim().length > 0 && !isProcessing && !isRecording && !isTranscribing;

  const showQuotaBar =
    !quotaLoading && !unlimited && balance <= LOW_BALANCE_THRESHOLD;
  const depleted = showQuotaBar && balance <= 0;

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
        <div className="flex items-center gap-2 px-3 py-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // isComposingEvent: Enter confirms an IME conversion (ja/zh/ko/vi)
              // rather than sending. See `useImeSafeEnter`.
              if (e.key === 'Enter' && !e.shiftKey && !isComposingEvent(e)) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            {...compositionProps}
            placeholder={t('placeholder')}
            disabled={isProcessing}
            data-testid="chat-new-input"
            // Learners often type in the target language — dir="auto" makes
            // RTL input read right-to-left while typing.
            dir="auto"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />

          <HomeVoiceButton
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            onClick={handleVoiceClick}
            disabled={isProcessing}
          />

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            aria-label="Send"
            data-testid="chat-submit"
            className={cn(
              'rounded-md p-1.5 text-primary-foreground transition-colors',
              canSubmit
                ? 'bg-primary hover:bg-primary/90'
                : 'bg-primary/40',
            )}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>

        {showQuotaBar && (
          <button
            type="button"
            onClick={() =>
              depleted ? setPaywallOpen(true) : setLowQuotaOpen(true)
            }
            className={cn(
              'flex w-full items-center justify-between border-t px-3 py-1.5 text-xs transition-colors',
              depleted
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/15'
                : 'bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300',
            )}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Lock className="h-3 w-3" />
              {depleted ? tQuota('limitReached') : tQuota('left', { balance })}
            </span>
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {paywallOpen && (
        <PaywallDialog
          open={paywallOpen}
          setOpen={setPaywallOpen}
          featureId={FEATURE_IDS.CHAT_MESSAGES}
        />
      )}
      {lowQuotaOpen && balance > 0 && (
        <LowQuotaDialog
          open={lowQuotaOpen}
          setOpen={setLowQuotaOpen}
          balance={balance}
          featureId={FEATURE_IDS.CHAT_MESSAGES}
        />
      )}
    </>
  );
}

/**
 * Inline voice button styled to fit the compact home-view input row. Mirrors
 * the quota-aware behavior of {@link VoiceRecordButton} but renders as a
 * plain icon button so it can sit flush with the send button.
 */
function HomeVoiceButton({
  isRecording,
  isTranscribing,
  onClick,
  disabled,
}: {
  isRecording: boolean;
  isTranscribing: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('Chat.voice');
  const { isAvailable, isLoading } = useFeatureQuota(FEATURE_IDS.TRANSCRIPTIONS);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);

  const isLocked = !isAvailable && !isLoading;

  return (
    <>
      <button
        type="button"
        onClick={isLocked ? () => setLimitDialogOpen(true) : onClick}
        disabled={disabled || isTranscribing}
        aria-label={isRecording ? t('stopRecording') : t('startRecording')}
        className={cn(
          'rounded-md p-1.5 transition-colors disabled:opacity-50',
          isRecording
            ? 'text-red-500 hover:bg-red-500/10'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {isLocked ? (
          <Lock className="h-4 w-4" />
        ) : isTranscribing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isRecording ? (
          <Square className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </button>
      {limitDialogOpen && (
        <UsageLimitDialog
          open={limitDialogOpen}
          setOpen={setLimitDialogOpen}
          featureId={FEATURE_IDS.TRANSCRIPTIONS}
        />
      )}
    </>
  );
}
