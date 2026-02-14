'use client';

import { useVoiceRecording } from '@/hooks/use-voice-recording';
import { VoiceRecordButton } from './VoiceRecordButton';

interface VoiceInputWrapperProps {
  /**
   * Callback to update text with the transcribed content
   * Receives the new text that should replace or append to existing text
   */
  onTranscript: (newText: string) => void;

  /**
   * Current text value (optional) - used to append transcript to existing text
   */
  currentText?: string;
}

/**
 * Wrapper component that combines voice recording hook with VoiceRecordButton
 * Handles the common pattern of appending transcripts to existing text
 *
 * @example
 * ```tsx
 * const [text, setText] = useState("");
 *
 * <VoiceInputWrapper
 *   currentText={text}
 *   onTranscript={(newText) => setText(newText)}
 * />
 * ```
 */
export function VoiceInputWrapper({
  onTranscript,
  currentText = '',
}: VoiceInputWrapperProps) {
  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (transcript) => {
      // Append transcript to existing text, or use it as the new text
      const newText = currentText ? `${currentText} ${transcript}` : transcript;
      onTranscript(newText);
    },
  );

  return (
    <VoiceRecordButton
      isRecording={isRecording}
      isTranscribing={isTranscribing}
      onClick={handleVoiceClick}
    />
  );
}
