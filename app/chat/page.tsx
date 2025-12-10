"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SignedIn, SignedOut } from "@daveyplate/better-auth-ui";
import { authClient } from "@/lib/auth-client";
import { Footer } from "@/components/Footer";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { toast } from "sonner";
import { Loader } from "@/components/ai-elements/loader";

// Hooks
import { useThreadManagement } from "@/hooks/use-thread-management";
import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { useChatMessages } from "@/hooks/use-chat-messages";

// Components
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ThreadSidebar } from "@/components/chat/ThreadSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";

// Constants
import { ERROR_MESSAGES, SUCCESS_MESSAGES, CHAT_STATUS } from "@/lib/constants/chat";

export default function ChatPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [text, setText] = useState<string>("");

  // Thread management
  const {
    threadId,
    threads,
    createThread,
    setThreadId,
    isLoading: isThreadLoading,
    isCreating,
  } = useThreadManagement({ session, isPending });

  // Message management
  const { messages, status, setStatus } = useChatMessages({ threadId });

  // Voice recording
  const { isRecording, isTranscribing, handleVoiceClick } = useVoiceRecording(
    (transcript) => {
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    }
  );

  // Mutations
  const sendMessage = useMutation(api.chat.messages.sendMessage);

  // Redirect if not authenticated
  useEffect(() => {
    if (!session && !isPending) {
      router.push("/");
    }
  }, [session, isPending, router]);

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
          prompt: message.text || "Sent with attachments",
        });
        setText("");
        setStatus(CHAT_STATUS.SUBMITTED);
      } catch (error) {
        console.error("Failed to send message:", error);
        toast.error(ERROR_MESSAGES.FAILED_TO_SEND);
        setStatus(CHAT_STATUS.ERROR);
        setTimeout(() => setStatus(CHAT_STATUS.READY), 2000);
      }
    },
    [threadId, sendMessage, setStatus]
  );

  // Handle suggestion click
  const handleSuggestionClick = useCallback(
    async (suggestion: string) => {
      if (!threadId) {
        toast.error(ERROR_MESSAGES.CHAT_NOT_INITIALIZED);
        return;
      }

      setStatus(CHAT_STATUS.SUBMITTED);
      try {
        await sendMessage({
          threadId,
          prompt: suggestion,
        });
      } catch (error) {
        console.error("Failed to send message:", error);
        toast.error(ERROR_MESSAGES.FAILED_TO_SEND);
        setStatus(CHAT_STATUS.ERROR);
        setTimeout(() => setStatus(CHAT_STATUS.READY), 2000);
      }
    },
    [threadId, sendMessage, setStatus]
  );

  // Loading state
  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader size={24} />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <ChatHeader onBack={() => router.push("/app")} />

      {/* Main Content */}
      <main className="flex-1 flex flex-row overflow-hidden min-h-0">
        <SignedOut>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">Redirecting to sign in...</p>
          </div>
        </SignedOut>

        <SignedIn>
          {/* Threads Sidebar */}
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
                <ChatMessages messages={messages} isLoading={isThreadLoading} />
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
        </SignedIn>
      </main>

      {/* Footer */}
      <Footer />

      {/* Background Pattern */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-linear-to-br from-emerald-100/30 to-teal-100/30 dark:from-emerald-900/10 dark:to-teal-900/10 blur-3xl" />
      </div>
    </div>
  );
}
