'use client';

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { toast } from 'sonner';
import { useChat } from '@/hooks/use-chat';
import { ChatMessages } from '@/components/chat/ChatMessages';
import type { ToolRenderer } from '@/components/chat/ChatMessages';
import { ChatInput } from '@/components/chat/ChatInput';
import { SUCCESS_MESSAGES } from '@/lib/constants/chat';

interface ChatPanelProps {
  threadId: string;
  toolRenderers?: Record<string, ToolRenderer>;
  showSuggestions?: boolean;
  suggestions?: readonly string[];
  className?: string;
  header?: ReactNode;
  footerAction?: ReactNode;
  suggestionsAction?: ReactNode;
  /** Renders above the footer (mobile only), e.g. back button matching open-chat style */
  aboveFooterAction?: ReactNode;
}

/**
 * Reusable, embeddable chat panel combining messages and input.
 * Can be dropped into any layout — standalone page, sidebar, or overlay.
 */
export function ChatPanel({
  threadId,
  toolRenderers,
  showSuggestions,
  suggestions,
  className,
  header,
  footerAction,
  suggestionsAction,
  aboveFooterAction,
}: ChatPanelProps) {
  const chat = useChat({ threadId });

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);

      if (!(hasText || hasAttachments)) return;

      if (message.files?.length) {
        toast.success(SUCCESS_MESSAGES.FILES_ATTACHED, {
          description: `${message.files.length} file(s) attached to message`,
        });
      }

      await chat.sendMessage(message.text || 'Sent with attachments');
    },
    [chat],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      chat.setText(suggestion);
    },
    [chat],
  );

  return (
    <div className={`flex flex-col h-full w-full min-w-0 ${className ?? ''}`}>
      {header}

      <div className="flex-1 min-h-0 relative px-4 pt-2">
        <ChatMessages
          messages={chat.messages}
          isLoading={false}
          threadId={threadId}
          toolRenderers={toolRenderers}
          contentClassName={aboveFooterAction ? 'pb-12 lg:pb-0' : undefined}
        />
        {aboveFooterAction && (
          <div className="absolute bottom-3 left-4 lg:hidden z-10">
            {aboveFooterAction}
          </div>
        )}
      </div>

      <div className="flex-none p-4 border-t bg-background">
        <ChatInput
          onSubmit={handleSubmit}
          onSuggestionClick={handleSuggestionClick}
          text={chat.text}
          onTextChange={chat.setText}
          status={chat.status}
          isRecording={chat.voice.isRecording}
          isTranscribing={chat.voice.isTranscribing}
          onVoiceClick={chat.voice.toggle}
          suggestions={suggestions}
          showSuggestions={
            showSuggestions ?? chat.messages.length === 0
          }
          footerAction={footerAction}
          suggestionsAction={suggestionsAction}
        />
      </div>
    </div>
  );
}
