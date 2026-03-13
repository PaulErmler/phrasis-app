'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Authenticated, Unauthenticated, AuthLoading, useConvexAuth, useMutation } from 'convex/react';
import { Footer } from '@/components/Footer';
import { api } from '@/convex/_generated/api';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { toast } from 'sonner';
import { Loader } from '@/components/ai-elements/loader';

// Hooks
import { useThreadManagement } from '@/hooks/use-thread-management';
import { useVoiceRecording } from '@/hooks/use-voice-recording';
import { useChatMessages } from '@/hooks/use-chat-messages';

// Components
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ThreadSidebar } from '@/components/chat/ThreadSidebar';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { ChatInput } from '@/components/chat/ChatInput';

// Constants
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  CHAT_STATUS,
} from '@/lib/constants/chat';

export default function ChatPage() {
  const router = useRouter();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <ChatHeader onBack={() => router.push('/app')} />

      <AuthLoading>
        <div className="flex-1 flex items-center justify-center">
          <Loader size={24} />
        </div>
      </AuthLoading>

      <Unauthenticated>
        <UnauthenticatedRedirect />
      </Unauthenticated>

      <Authenticated>
        <ChatPageContent />
      </Authenticated>

      <Footer />
    </div>
  );
}

function UnauthenticatedRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.push('/');
  }, [router]);

  return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to sign in...</p>
    </div>
  );
}

function ChatPageContent() {
  const [text, setText] = useState<string>('');

  // Thread management (no session/isPending needed — already inside <Authenticated>)
  const {
    threadId,
    threads,
    createThread,
    setThreadId,
    isLoading: isThreadLoading,
    isCreating,
  } = useThreadManagement();

  // Message management
  const { messages, status, setStatus } = useChatMessages({ threadId });

  // Voice recording
  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (transcript) => {
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    },
  );

  // Mutations
  const sendMessage = useMutation(api.features.chat.messages.sendMessage);

  // Handle message submission
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (!threadId) {
        toast.error(ERROR_MESSAGES.CHAT_NOT_INITIALIZED);
        return;
      }

      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);

      if (!(hasText || hasAttachments)) {
        return;
      }

      setStatus(CHAT_STATUS.SUBMITTED);

      if (message.files?.length) {
        toast.success(SUCCESS_MESSAGES.FILES_ATTACHED, {
          description: `${message.files.length} file(s) attached to message`,
        });
      }

      try {
        await sendMessage({
          threadId,
          prompt: message.text || 'Sent with attachments',
        });
        setText('');
        setStatus(CHAT_STATUS.SUBMITTED);
      } catch (error) {
        console.error('Failed to send message:', error);
        toast.error(ERROR_MESSAGES.FAILED_TO_SEND);
        setStatus(CHAT_STATUS.ERROR);
        setTimeout(() => setStatus(CHAT_STATUS.READY), 2000);
      }
    },
    [threadId, sendMessage, setStatus],
  );

  // Handle suggestion click - populate input instead of sending
  const handleSuggestionClick = useCallback((suggestion: string) => {
    setText(suggestion);
  }, []);

  return (
    <main className="flex-1 flex flex-row overflow-hidden min-h-0">
      <ThreadSidebar
        threads={threads}
        threadId={threadId}
        onThreadSelect={setThreadId}
        onNewThread={createThread}
        isCreating={isCreating}
      />

      {/* Chat Area */}
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full min-h-0">
        {!threadId ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader size={24} />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <ChatMessages
              messages={messages}
              isLoading={isThreadLoading}
              threadId={threadId}
            />
            <ChatInput
              onSubmit={handleSubmit}
              onSuggestionClick={handleSuggestionClick}
              text={text}
              onTextChange={setText}
              status={status}
              isRecording={isRecording}
              isTranscribing={isTranscribing}
              onVoiceClick={handleVoiceClick}
              showSuggestions={messages.length === 0}
            />
          </div>
        )}
      </div>
    </main>
  );
}
