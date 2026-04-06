import { useEffect, useRef } from 'react';
import {
  PromptInput,
  // File attachment imports — disabled for now, re-enable when file upload is supported
  // PromptInputActionAddAttachments,
  // PromptInputActionMenu,
  // PromptInputActionMenuContent,
  // PromptInputActionMenuTrigger,
  // PromptInputAttachment,
  // PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  // PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  // PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { useTranslations } from 'next-intl';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { VoiceRecordButton } from './VoiceRecordButton';
import type { ChatStatus } from '@/lib/types/chat';
import { CHAT_STATUS } from '@/lib/constants/chat';
import { cn } from '@/lib/utils';
import { MAX_MESSAGE_LENGTH } from '@/convex/features/chat/constants';

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
  autoFocus?: boolean;
}

/**
 * Chat input component with text input and voice recording.
 * File attachments are disabled for now (see commented-out code below).
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
  autoFocus = true,
}: ChatInputProps) {
  const t = useTranslations('Chat.input');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    });
  }, [autoFocus]);

  const isOverLimit = text.length > MAX_MESSAGE_LENGTH;
  const showCounter = text.length >= MAX_MESSAGE_LENGTH * 0.8;

  const defaultPrompts = [
    t('generalPrompts.howToSay'),
    t('generalPrompts.createCards'),
    t('generalPrompts.whatDoesMean'),
  ] as const;
  const items = suggestions ?? defaultPrompts;

  return (
    <div ref={containerRef} className={cn("w-full min-w-0", className ?? "")}>
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
            // File uploads disabled — add globalDrop and multiple back when re-enabling
            onSubmit={onSubmit}
            className="w-full"
          >
            {/* File attachment header — disabled for now
            <PromptInputHeader>
              <PromptInputAttachments>
                {(attachment) => <PromptInputAttachment data={attachment} />}
              </PromptInputAttachments>
            </PromptInputHeader>
            */}

            <PromptInputBody>
              <PromptInputTextarea
                placeholder={t('placeholder')}
                onChange={(event) => onTextChange(event.target.value)}
                value={text}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <div className="flex items-center gap-2">
                {footerAction}
                {showCounter && (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      isOverLimit ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {text.length}/{MAX_MESSAGE_LENGTH}
                  </span>
                )}
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
                    isOverLimit ||
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
