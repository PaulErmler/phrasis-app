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
} from '@/components/ai-elements/prompt-input';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { VoiceRecordButton } from './VoiceRecordButton';
import type { ChatStatus } from '@/lib/types/chat';
import { DEFAULT_SUGGESTIONS, CHAT_STATUS } from '@/lib/constants/chat';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  onSuggestionClick: (suggestion: string) => void | Promise<void>;
  text: string;
  onTextChange: (text: string) => void;
  status: ChatStatus;
  isRecording: boolean;
  isTranscribing: boolean;
  onVoiceClick: () => void;
  showSuggestions?: boolean;
  suggestions?: readonly string[];
  className?: string;
  footerAction?: React.ReactNode;
  suggestionsAction?: React.ReactNode;
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
  suggestions,
  className,
  footerAction,
  suggestionsAction,
}: ChatInputProps) {
  const items = suggestions ?? DEFAULT_SUGGESTIONS;

  return (
    <div className={cn("w-full min-w-0", className ?? "")}>
      <div className="w-full min-w-0">
        {showSuggestions && (
          <div className="w-full min-w-0 mb-3 flex items-center gap-2">
            {suggestionsAction}
            <div className="flex-1 min-w-0">
              <Suggestions className="px-4">
                {items.map((suggestion) => (
                  <Suggestion
                    key={suggestion}
                    onClick={() => onSuggestionClick(suggestion)}
                    suggestion={suggestion}
                  />
                ))}
              </Suggestions>
            </div>
          </div>
        )}
        <div className="w-full min-w-0">
          <PromptInput
            globalDrop
            multiple
            onSubmit={onSubmit}
            className="w-full"
          >
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
              <div className="flex items-center gap-2">
                {footerAction}
                <PromptInputTools>
                  <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger />
                    <PromptInputActionMenuContent>
                      <PromptInputActionAddAttachments />
                    </PromptInputActionMenuContent>
                  </PromptInputActionMenu>
                </PromptInputTools>
              </div>
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
