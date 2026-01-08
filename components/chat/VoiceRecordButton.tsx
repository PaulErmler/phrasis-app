import { MicIcon } from "lucide-react";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";

interface VoiceRecordButtonProps {
  isRecording: boolean;
  isTranscribing: boolean;
  onClick: () => void;
}

/**
 * Voice recording button with recording and transcribing states
 */
export function VoiceRecordButton({
  isRecording,
  isTranscribing,
  onClick,
}: VoiceRecordButtonProps) {
  return (
    <PromptInputButton
      onClick={onClick}
      variant="ghost"
      disabled={isTranscribing}
      className={isRecording ? "text-red-500" : ""}
    >
      <MicIcon size={16} className={isRecording ? "animate-pulse" : ""} />
      <span className="sr-only">
        {isRecording ? "Stop recording" : "Start recording"}
      </span>
      {isRecording && <span className="ml-2 text-xs">Recording...</span>}
      {isTranscribing && <span className="ml-2 text-xs">Transcribing...</span>}
    </PromptInputButton>
  );
}




