import { useState, useCallback, useRef } from 'react';
import { useAction } from 'convex/react';
import { useTranslations } from 'next-intl';
import { convexErrorCode, isPaymentPastDueError } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';

import { reportError } from '@/lib/report-error';

function detectDefaultMime(): string {
  if (
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent)
  ) {
    return 'audio/mp4';
  }
  return 'audio/webm';
}

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
   * course-wide auto-detect. Writing-mode dictation knows the row's target
   * language, and a single locale gives Azure its best accuracy.
   */
  language?: string;
  /** Auto-stop the recording after this long (and transcribe what's there). */
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
      const chosenMime = mimeType ?? detectDefaultMime();

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
        const actualMimeType = mediaRecorder.mimeType || chosenMime;

        if (audioChunksRef.current.length === 0) {
          // Nothing was captured, so there is nothing to send. Release the
          // state the stop claimed, or the button spins forever.
          setIsTranscribing(false);
          return;
        }

        setIsTranscribing(true);
        try {
          const audioBlob = new Blob(audioChunksRef.current, {
            type: actualMimeType,
          });
          const arrayBuffer = await audioBlob.arrayBuffer();

          const transcript = await transcribeAudio({
            audio: arrayBuffer as ArrayBuffer,
            mimeType: actualMimeType,
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
      if (maxDurationMs) {
        maxDurationTimerRef.current = setTimeout(stopRecording, maxDurationMs);
      }
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
