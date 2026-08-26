'use client';

import { Lock, MicIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { useFeatureLock } from '@/components/feature_tracking/useFeatureLock';
import { FEATURE_IDS } from '@/convex/features/featureIds';

interface VoiceRecordButtonProps {
  isRecording: boolean;
  isTranscribing: boolean;
  onClick: () => void;
}

export function VoiceRecordButton({
  isRecording,
  isTranscribing,
  onClick,
}: VoiceRecordButtonProps) {
  const t = useTranslations('Chat.voice');
  const { isLocked, openLimitDialog, limitDialog } = useFeatureLock(
    FEATURE_IDS.TRANSCRIPTIONS,
  );

  return (
    <>
      <PromptInputButton
        onClick={isLocked ? openLimitDialog : onClick}
        variant="ghost"
        disabled={isTranscribing}
        className={isRecording ? 'text-red-500' : ''}
      >
        {isLocked ? (
          <Lock size={16} />
        ) : (
          <MicIcon size={16} className={isRecording ? 'animate-pulse' : ''} />
        )}
        <span className="sr-only">
          {isRecording ? t('stopRecording') : t('startRecording')}
        </span>
        {isRecording && <span className="ml-2 text-xs">{t('recording')}</span>}
        {isTranscribing && (
          <span className="ml-2 text-xs">{t('transcribing')}</span>
        )}
      </PromptInputButton>
      {limitDialog}
    </>
  );
}
