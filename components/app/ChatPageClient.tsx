'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { SimplifiedChatView } from '@/components/app/SimplifiedChatView';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Button } from '@/components/ui/button';
import { ChevronLeft, MessageSquarePlus, PanelLeft } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';

/**
 * The /app/chat/[threadId] page: owns the chat header (the (main) layout
 * hides its own header on chat routes) plus the sidebar/thread state that
 * used to live in the old all-tabs layout.
 */
export function ChatPageClient({ threadId }: { threadId: string }) {
  const t = useTranslations('AppPage');
  const router = useRouter();

  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const sidebarInitializedRef = useRef(false);
  useEffect(() => {
    if (isDesktop && !sidebarInitializedRef.current) {
      sidebarInitializedRef.current = true;
      setChatSidebarOpen(true);
    }
  }, [isDesktop]);

  const threads = useQuery(api.features.chat.threads.listThreads, {});
  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );

  const handleNewChat = useCallback(async () => {
    try {
      const newThreadId = await getOrCreateEmptyThread({});
      router.push(`/app/chat/${newThreadId}`);
    } catch (err) {
      console.error('Failed to create new chat:', err);
    }
  }, [getOrCreateEmptyThread, router]);

  const handleThreadSelect = useCallback(
    (id: string) => {
      router.push(`/app/chat/${id}`);
    },
    [router],
  );

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-20 border-b bg-background pt-[env(safe-area-inset-top)]">
        <div className="header-bar">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              onClick={() => router.push('/app')}
              className="gap-2 -ml-2"
            >
              <ChevronLeft className="h-4 w-4" />
              {t('views.chat')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setChatSidebarOpen((prev) => !prev)}
              aria-label="Toggle conversations"
              data-testid="chat-toggle-conversations"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNewChat}
              aria-label="New chat"
              data-testid="chat-new-thread"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1 -mr-2 shrink-0">
            <ThemeSwitcher />
          </div>
        </div>
      </header>
      <div className="shrink-0 h-[calc(3.5rem+env(safe-area-inset-top))]" />
      <div className="flex-1 min-h-0">
        <SimplifiedChatView
          threadId={threadId}
          onNewChat={handleNewChat}
          onThreadSelect={handleThreadSelect}
          threads={threads}
          sidebarOpen={chatSidebarOpen}
          onSidebarOpenChange={setChatSidebarOpen}
        />
      </div>
    </>
  );
}
