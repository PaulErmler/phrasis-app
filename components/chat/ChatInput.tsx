import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { VoiceRecordButton } from "./VoiceRecordButton";
import type { ChatStatus } from "@/lib/types/chat";
import { DEFAULT_SUGGESTIONS, CHAT_STATUS } from "@/lib/constants/chat";

interface ChatInputProps {
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  onSuggestionClick: (suggestion: string) => Promise<void>;
  text: string;
  onTextChange: (text: string) => void;
  status: ChatStatus;
  isRecording: boolean;
  isTranscribing: boolean;
  onVoiceClick: () => void;
  showSuggestions?: boolean;
}

/**
 * Chat input component with text input, voice recording, and file attachments
 */
export function ChatInput({
  onSubmit,
  onSuggestionClick,
  text,
  onTextChange,
  status,
  isRecording,
  isTranscribing,
  onVoiceClick,
  showSuggestions = false,
}: ChatInputProps) {
  return (
    <div className="shrink-0 border-t border-border bg-background">
      <div className="grid gap-4 pt-4">
        {showSuggestions && (
          <Suggestions className="px-4">
            {DEFAULT_SUGGESTIONS.map((suggestion) => (
              <Suggestion
                key={suggestion}
                onClick={() => onSuggestionClick(suggestion)}
                suggestion={suggestion}
              />
            ))}
          </Suggestions>
        )}
        <div className="w-full px-4 pb-4">
          <PromptInput globalDrop multiple onSubmit={onSubmit}>
            <PromptInputHeader>
              <PromptInputAttachments>
                {(attachment) => <PromptInputAttachment data={attachment} />}
              </PromptInputAttachments>
            </PromptInputHeader>
            <PromptInputBody>
              <PromptInputTextarea
                onChange={(event) => onTextChange(event.target.value)}
                value={text}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
              </PromptInputTools>
              <div className="flex items-center gap-2">
                <VoiceRecordButton
                  isRecording={isRecording}
                  isTranscribing={isTranscribing}
                  onClick={onVoiceClick}
                />
                <PromptInputSubmit
                  disabled={
                    !text.trim() ||
                    status === CHAT_STATUS.STREAMING ||
                    status === CHAT_STATUS.SUBMITTED ||
                    isRecording ||
                    isTranscribing
                  }
                  status={status}
                />
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

