import { useState, useCallback, useRef } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/constants/chat";

interface UseVoiceRecordingReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  handleVoiceClick: () => void;
}

/**
 * Custom hook for managing voice recording and transcription
 * Handles MediaRecorder setup, audio capture, and transcription
 */
export function useVoiceRecording(
  onTranscript: (transcript: string) => void
): UseVoiceRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const transcribeAudio = useAction(api.features.chat.transcribe.transcribeAudio);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        if (audioChunksRef.current.length > 0) {
          setIsTranscribing(true);
          try {
            const audioBlob = new Blob(audioChunksRef.current, {
              type: "audio/webm",
            });
            const arrayBuffer = await audioBlob.arrayBuffer();

            const transcript = await transcribeAudio({
              audio: arrayBuffer as ArrayBuffer,
            });

            onTranscript(transcript);
            toast.success(SUCCESS_MESSAGES.VOICE_TRANSCRIBED);
          } catch (error) {
            console.error("Transcription error:", error);
            toast.error(ERROR_MESSAGES.FAILED_TO_TRANSCRIBE);
          } finally {
            setIsTranscribing(false);
          }
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
      toast.error(ERROR_MESSAGES.MICROPHONE_ACCESS);
    }
  }, [transcribeAudio, onTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

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




