'use client';

import { useState } from 'react';
import { Lock, MicIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import UsageLimitDialog from '@/components/autumn/usage-limit-dialog';

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
  const { isAvailable, isLoading } = useFeatureQuota(FEATURE_IDS.TRANSCRIPTIONS);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);

  const isLocked = !isAvailable && !isLoading;

  return (
    <>
      <PromptInputButton
        onClick={isLocked ? () => setLimitDialogOpen(true) : onClick}
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
        {isTranscribing && <span className="ml-2 text-xs">{t('transcribing')}</span>}
      </PromptInputButton>
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
