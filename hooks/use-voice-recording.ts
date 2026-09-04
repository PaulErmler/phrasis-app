import { useState, useCallback, useRef } from 'react';
import { useAction } from 'convex/react';
import { useTranslations } from 'next-intl';
import { convexErrorCode, isPaymentPastDueError } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';

import { reportError } from '@/lib/report-error';
import { recordingToWav } from '@/lib/audio/recordingToWav';

/**
 * Auto-stop cap when the caller sets none. Chat voice input had no cap while
 * the upload was a compressed WebM; the WAV upload is 32 KB per second, so
 * three minutes is ~5.8 MB. Convex caps function arguments at 16 MiB
 * (docs.convex.dev/production/state/limits; the 1 MB figure elsewhere is
 * the stored-value limit), and three minutes is far past any message a
 * learner dictates.
 */
export const DEFAULT_MAX_RECORDING_MS = 180_000;

interface UseVoiceRecordingReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  handleVoiceClick: () => void;
}

interface UseVoiceRecordingOptions {
  /**
   * Pin transcription to one language (internal code) instead of the default
   * auto-detect. Writing-mode dictation knows the row's target language; the
   * hint gives the model its best accuracy and fixes the transcript's script.
   */
  language?: string;
  /**
   * Auto-stop the recording after this long (and transcribe what's there).
   * Defaults to `DEFAULT_MAX_RECORDING_MS`.
   */
  maxDurationMs?: number;
  /**
   * Skip the success toast. Writing mode drops the transcript straight into
   * the answer input, so a toast on every dictated answer is noise.
   */
  quiet?: boolean;
}

/**
 * Custom hook for managing voice recording and transcription
 * Handles MediaRecorder setup, audio capture, and transcription
 */
export function useVoiceRecording(
  onTranscript: (transcript: string) => void,
  onUsageLimit?: () => void,
  options?: UseVoiceRecordingOptions,
): UseVoiceRecordingReturn {
  const tErrors = useTranslations('Chat.errors');
  const tVoice = useTranslations('Chat.voice');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { language, maxDurationMs, quiet } = options ?? {};

  const transcribeAudio = useAction(
    api.features.chat.transcribe.transcribeAudio,
  );

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    // Both flags flip in one commit, and BEFORE stop(). The upload starts in
    // `onstop`, which runs on a later task, so setting `isTranscribing` there
    // leaves a render with neither flag set: the button falls back to its
    // idle mic icon between the stop click and the upload, and a click in
    // that window starts a fresh recording on top of the one still being
    // transcribed. Every consumer disables the button while `isTranscribing`,
    // so claiming it here closes the gap. `onstop` releases it again when
    // there turns out to be no audio to send.
    setIsRecording(false);
    setIsTranscribing(true);
    recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/aac',
      ];
      const mimeType = preferredTypes.find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const options = mimeType ? { mimeType } : undefined;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (maxDurationTimerRef.current) {
          clearTimeout(maxDurationTimerRef.current);
          maxDurationTimerRef.current = null;
        }
        stream.getTracks().forEach((track) => track.stop());

        if (audioChunksRef.current.length === 0) {
          // Nothing was captured, so there is nothing to send. Release the
          // state the stop claimed, or the button spins forever.
          setIsTranscribing(false);
          return;
        }

        setIsTranscribing(true);
        try {
          const audioBlob = new Blob(audioChunksRef.current, {
            type: mediaRecorder.mimeType || mimeType || '',
          });
          // The STT provider rejects WebM and MP4, the only containers
          // MediaRecorder produces, so the clip is re-encoded as 16 kHz mono
          // WAV first (see lib/audio/recordingToWav.ts).
          let audio: ArrayBuffer;
          try {
            audio = await recordingToWav(audioBlob);
          } catch (error) {
            reportError(error, { op: 'recordingToWav' });
            toast.error(tErrors('failedToTranscribe'));
            return;
          }

          const transcript = await transcribeAudio({
            audio,
            mimeType: 'audio/wav',
            ...(language ? { language } : {}),
          });

          onTranscript(transcript);
          if (!quiet) toast.success(tVoice('transcribed'));
        } catch (error) {
          if (isPaymentPastDueError(error)) {
            // Silent: the reactive payment-overdue dialog is the
            // canonical surface for this state.
          } else if (convexErrorCode(error) === 'USAGE_LIMIT') {
            onUsageLimit?.();
          } else {
            reportError(error, { op: 'transcribeAudio' });
            toast.error(tErrors('failedToTranscribe'));
          }
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      maxDurationTimerRef.current = setTimeout(
        stopRecording,
        maxDurationMs ?? DEFAULT_MAX_RECORDING_MS,
      );
    } catch (error) {
      // Deliberately not reportError: this is overwhelmingly the user
      // denying mic permission (NotAllowedError) — an expected state like
      // autoplay rejection, with the toast as its surface.
      console.error('Error starting recording:', error);
      toast.error(tErrors('microphoneAccess'));
    }
  }, [
    transcribeAudio,
    onTranscript,
    onUsageLimit,
    language,
    maxDurationMs,
    quiet,
    stopRecording,
    tErrors,
    tVoice,
  ]);

  const handleVoiceClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return {
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    handleVoiceClick,
  };
}
