'use client';

import { ChatPanel } from '@/components/chat/ChatPanel';
import { ChatHistorySidebar } from '@/components/chat/ChatHistorySidebar';
import { createCardToolRenderer } from '@/components/chat/tools/CardToolRenderer';
import { useCardApprovals } from '@/hooks/use-card-approvals';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { ChevronLeft, Loader2, MessageSquarePlus, PanelLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Authenticated, AuthLoading, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMediaQuery } from '@/hooks/use-media-query';
import { motion, AnimatePresence } from 'motion/react';

export default function ChatPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = use(params);

  return (
    <>
      <AuthLoading>
        <div className="h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AuthLoading>
      <Authenticated>
        <ChatPageContent threadId={threadId} />
      </Authenticated>
    </>
  );
}

function ChatPageContent({ threadId: initialThreadId }: { threadId: string }) {
  const router = useRouter();
  const t = useTranslations('Chat');
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [currentThreadId, setCurrentThreadId] = useState(initialThreadId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarInitializedRef = useRef(false);

  useEffect(() => {
    if (isDesktop && !sidebarInitializedRef.current) {
      sidebarInitializedRef.current = true;
      setSidebarOpen(true);
    }
  }, [isDesktop]);

  const approvals = useCardApprovals(currentThreadId);
  const threads = useQuery(api.features.chat.threads.listThreads);
  const getOrCreateEmptyThread = useMutation(api.features.chat.threads.getOrCreateEmptyThread);

  const toolRenderers = useMemo(
    () => ({
      createCard: createCardToolRenderer(approvals),
    }),
    [approvals],
  );

  const handleThreadSelect = useCallback((id: string) => {
    setCurrentThreadId(id);
    if (!isDesktop) setSidebarOpen(false);
    history.replaceState(null, '', `/app/chat/${id}`);
  }, [isDesktop]);

  const handleNewChat = useCallback(async () => {
    try {
      const newId = await getOrCreateEmptyThread({});
      setCurrentThreadId(newId);
      if (!isDesktop) setSidebarOpen(false);
      history.replaceState(null, '', `/app/chat/${newId}`);
    } catch (err) {
      console.error('Failed to create new chat:', err);
    }
  }, [getOrCreateEmptyThread, isDesktop]);

  const sidebarContent = (
    <ChatHistorySidebar
      threads={threads}
      currentThreadId={currentThreadId}
      onThreadSelect={handleThreadSelect}
      onNewChat={handleNewChat}
    />
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="sticky-header">
        <div className="header-bar">
          <div className="flex items-center gap-1">
            <Button variant="ghost" className="gap-2 -ml-2" onClick={() => router.push('/app')}>
              <ChevronLeft className="h-4 w-4" />
              {t('back')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="Toggle conversations"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNewChat}
              aria-label="New chat"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>
          <ThemeSwitcher />
        </div>
      </header>

      <main className="flex-1 min-h-0 flex">
        {/* Desktop inline sidebar */}
        {isDesktop && (
          <AnimatePresence initial={false}>
            {sidebarOpen && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 280, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="flex flex-shrink-0 border-r overflow-hidden"
              >
                <div className="w-[280px]">
                  {sidebarContent}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* Mobile sheet sidebar */}
        {!isDesktop && (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-[280px] p-0">
              <SheetTitle className="sr-only">{t('sidebar.title')}</SheetTitle>
              {sidebarContent}
            </SheetContent>
          </Sheet>
        )}

        <div className="flex-1 min-w-0">
          <ChatPanel
            threadId={currentThreadId}
            toolRenderers={toolRenderers}
            onNewChat={handleNewChat}
            className="max-w-3xl mx-auto"
          />
        </div>
      </main>
    </div>
  );
}
