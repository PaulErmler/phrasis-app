'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Lock, MicIcon, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVoiceRecording } from '@/hooks/use-voice-recording';
import { useFeatureLock } from '@/components/feature_tracking/useFeatureLock';
import { FEATURE_IDS } from '@/convex/features/featureIds';

/** Auto-stop cap for a dictated answer; answers are single sentences. */
const MAX_RECORDING_MS = 30_000;

interface WritingVoiceButtonProps {
  /** Row's target language; pins Azure to one locale instead of language-ID. */
  language: string;
  /** Receives the transcript; the caller fills the input and submits. */
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

/**
 * Mic button in the writing-mode answer row, next to the check mark. First
 * click records, second click stops; the transcript then lands in the input
 * and submits (stop = submit). Same 36px outline styling as its siblings.
 * Bills the existing `transcriptions` quota; locked state mirrors the chat
 * mic (components/chat/VoiceRecordButton.tsx).
 */
export function WritingVoiceButton({
  language,
  onTranscript,
  disabled = false,
}: WritingVoiceButtonProps) {
  const t = useTranslations('Chat.voice');
  const { isLocked, openLimitDialog, limitDialog } = useFeatureLock(
    FEATURE_IDS.TRANSCRIPTIONS,
  );

  // The hook captures its callback when recording STARTS; routing through a
  // ref makes the async transcript land on the freshest handler, so a row
  // that got submitted by keyboard mid-transcription can ignore it.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (text) => onTranscriptRef.current(text),
    openLimitDialog,
    { language, maxDurationMs: MAX_RECORDING_MS, quiet: true },
  );

  const label = isRecording ? t('stopRecording') : t('startRecording');

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled || isTranscribing}
        onClick={isLocked ? openLimitDialog : handleVoiceClick}
        className={`h-9 w-9 shrink-0 ${
          isRecording ? 'border-destructive text-destructive' : ''
        }`}
        aria-label={isTranscribing ? t('transcribing') : label}
        data-testid="writing-voice-button"
      >
        {isLocked ? (
          <Lock className="h-4 w-4" />
        ) : isTranscribing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isRecording ? (
          <Square className="h-4 w-4 animate-pulse fill-current" />
        ) : (
          <MicIcon className="h-4 w-4" />
        )}
      </Button>
      {limitDialog}
    </>
  );
}
