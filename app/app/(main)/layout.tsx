'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import {
  usePreloadedQuery,
  useQuery,
  useMutation,
  useAction,
} from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { BottomNav, type View } from '@/components/app/BottomNav';
import { CourseMenu } from '@/components/app/CourseMenu';
import { useAppData } from '@/components/app/AppDataProvider';
import { Button } from '@/components/ui/button';
import { ChevronLeft, MessageSquarePlus, PanelLeft } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import { HomeView } from '@/components/app/HomeView';
import { ContentView } from '@/components/app/ContentView';
import { EnterTextsView } from '@/components/app/EnterTextsView';
import { LibraryView } from '@/components/app/LibraryView';
import { StatsView } from '@/components/app/stats/StatsView';
import { SettingsView } from '@/components/app/SettingsView';
import { LearnView } from '@/components/app/learning/LearnView';
import { SimplifiedChatView } from '@/components/app/SimplifiedChatView';
import { HelpDialog } from '@/components/app/HelpDialog';
import { AppLoadingSplash } from '@/components/LogoSpinner';

const VIEW_PATHS: Record<Exclude<View, 'chat'>, string> = {
  home: '/app',
  content: '/app/content',
  library: '/app/library',
  stats: '/app/stats',
  settings: '/app/settings',
};

function viewFromPathname(pathname: string): { view: View; chatThreadId?: string } {
  if (pathname.startsWith('/app/content')) return { view: 'content' };
  if (pathname.startsWith('/app/library')) return { view: 'library' };
  if (pathname.startsWith('/app/stats')) return { view: 'stats' };
  if (pathname.startsWith('/app/settings')) return { view: 'settings' };
  const chatMatch = pathname.match(/^\/app\/chat\/(.+)/);
  if (chatMatch) return { view: 'chat', chatThreadId: chatMatch[1] };
  return { view: 'home' };
}

export default function MainLayout({
  children: _children,
}: {
  children: React.ReactNode;
}) {
  const {
    preloadedSettings,
    preloadedActiveCourse,
    preloadedCourseSettings,
    preloadedCollectionProgress,
    preloadedCustomCollectionsProgress,
  } = useAppData();

  const [justReturnedFromLearn, setJustReturnedFromLearn] = useState(false);
  const restartTutorialRef = useRef<(() => void) | null>(null);

  const handleTutorialReady = useCallback((restart: () => void) => {
    restartTutorialRef.current = restart;
  }, []);

  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('AppPage');
  const locale = useLocale();

  const settings = usePreloadedQuery(preloadedSettings);
  const activeCourse = usePreloadedQuery(preloadedActiveCourse);

  const [initialView] = useState(() => viewFromPathname(pathname));
  const [activeView, setActiveView] = useState<View>(initialView.view);
  const [chatThreadId, setChatThreadId] = useState<string | null>(
    initialView.chatThreadId ?? null,
  );
  const viewBeforeChatRef = useRef<Exclude<View, 'chat'>>('home');
  const [isLearnOpen, setIsLearnOpen] = useState(false);
  const isAddCardsRoute = pathname === '/app/content/add-cards';

  useEffect(() => {
    if (!isLearnOpen && justReturnedFromLearn) {
      const id = requestAnimationFrame(() => {
        setJustReturnedFromLearn(false);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isLearnOpen, justReturnedFromLearn]);

  const [courseMenuOpen, setCourseMenuOpen] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const sidebarInitializedRef = useRef(false);

  useEffect(() => {
    if (isDesktop && !sidebarInitializedRef.current) {
      sidebarInitializedRef.current = true;
      setChatSidebarOpen(true);
    }
  }, [isDesktop]);

  // Warm the getCardForReview Convex subscription before learn opens;
  // skip once learn is open since useLearningMode manages its own subscription
  useQuery(
    api.features.scheduling.getCardForReview,
    !isLearnOpen ? {} : 'skip',
  );

  const threads = useQuery(
    api.features.chat.threads.listThreads,
    activeView === 'chat' ? {} : 'skip',
  );

  // Pre-create a chat thread so LearnView can use it immediately
  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );
  const [prefetchedThreadId, setPrefetchedThreadId] = useState<string | null>(
    null,
  );
  const refreshPrefetchedThread = useCallback(() => {
    getOrCreateEmptyThread({}).then(setPrefetchedThreadId).catch(() => {});
  }, [getOrCreateEmptyThread]);

  const didPrefetchThread = useRef(false);

  useEffect(() => {
    if (didPrefetchThread.current) return;
    didPrefetchThread.current = true;
    refreshPrefetchedThread();
  }, [refreshPrefetchedThread]);

  const syncQuotas = useAction(api.usage.actions.syncQuotas);
  const didSyncQuotas = useRef(false);

  useEffect(() => {
    if (didSyncQuotas.current) return;
    didSyncQuotas.current = true;
    syncQuotas().catch((err) => {
      console.error('Failed to sync quotas on app load:', err);
    });
  }, [syncQuotas]);

  // Tab switching — router.push keeps usePathname in sync (e.g. /app/content/add-cards)
  const handleViewChange = useCallback((view: View) => {
    setActiveView(view);
    setIsLearnOpen(false);
    if (view !== 'chat') {
      router.push(VIEW_PATHS[view]);
    }
  }, [router]);

  const handleOpenChat = useCallback((threadId: string) => {
    setActiveView((prev) => {
      if (prev !== 'chat') viewBeforeChatRef.current = prev;
      return 'chat';
    });
    setChatThreadId(threadId);
    setIsLearnOpen(false);
    router.push(`/app/chat/${threadId}`);
  }, [router]);

  const handleChatBack = useCallback(() => {
    const target = viewBeforeChatRef.current;
    setActiveView(target);
    router.push(VIEW_PATHS[target]);
  }, [router]);

  const handleNewChat = useCallback(async () => {
    try {
      const newThreadId = await getOrCreateEmptyThread({});
      handleOpenChat(newThreadId);
    } catch (err) {
      console.error('Failed to create new chat:', err);
    }
  }, [getOrCreateEmptyThread, handleOpenChat]);

  const handleNavigateToChat = useCallback(() => {
    if (prefetchedThreadId) {
      handleOpenChat(prefetchedThreadId);
    } else {
      void handleNewChat();
    }
  }, [prefetchedThreadId, handleOpenChat, handleNewChat]);

  // Learn overlay — pushState so the browser back button can close it
  const handleLearnOpen = useCallback(() => {
    setIsLearnOpen(true);
    history.pushState(null, '', '/app/learn');
    refreshPrefetchedThread();
  }, [refreshPrefetchedThread]);

  const handleLearnClose = useCallback(() => {
    setJustReturnedFromLearn(true);
    setIsLearnOpen(false);
    history.back();
    refreshPrefetchedThread();
  }, [refreshPrefetchedThread]);

  // Sync state when the user navigates with browser back/forward buttons
  useEffect(() => {
    const onPopState = () => {
      const url = window.location.pathname;
      if (url === '/app/learn') {
        setIsLearnOpen(true);
      } else {
        setIsLearnOpen(false);
        const parsed = viewFromPathname(url);
        setActiveView((prev) => {
          if (parsed.view === 'chat' && prev !== 'chat') {
            viewBeforeChatRef.current = prev;
          }
          return parsed.view;
        });
        if (parsed.chatThreadId) {
          setChatThreadId(parsed.chatThreadId);
        }
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const hasActiveCourse = !!activeCourse;

  const handleOpenCourseMenu = useCallback(() => {
    setCourseMenuOpen(true);
  }, []);

  const courseButtonLabel = activeCourse
    ? t('currentCourseWithLanguages', {
      targetLanguages: activeCourse.targetLanguages
        .map((code) => getLocalizedLanguageNameByCode(code, locale))
        .join(', '),
    })
    : t('changeCourse');

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden">
      {!(activeView === 'content' && isAddCardsRoute) && (
        <header className="sticky-header">
          <div className="header-bar">
            {activeView === 'home' ? (
              <Button
                variant="ghost"
                onClick={() => setCourseMenuOpen(true)}
                className="gap-2 -ml-2"
              >
                <ChevronLeft className="h-4 w-4" />
                {courseButtonLabel}
              </Button>
            ) : activeView === 'chat' ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  onClick={handleChatBack}
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
            ) : (
              <h1 className="heading-section capitalize">
                {t(`views.${activeView}`)}
              </h1>
            )}
            <div className="flex items-center gap-1 -mr-2">
              {(activeView === 'home' ||
                activeView === 'content' ||
                activeView === 'library' ||
                activeView === 'stats' ||
                activeView === 'settings') && (
                <HelpDialog
                  supportOnly={
                    activeView === 'content' ||
                    activeView === 'library' ||
                    activeView === 'stats' ||
                    activeView === 'settings'
                  }
                  onRestartTutorial={
                    activeView === 'home'
                      ? () => restartTutorialRef.current?.()
                      : undefined
                  }
                />
              )}
              <ThemeSwitcher />
            </div>
          </div>
        </header>
      )}

      <CourseMenu open={courseMenuOpen} onOpenChange={setCourseMenuOpen} />

      <main className="flex-1 min-h-0 flex flex-col">
        <div
          style={{
            display:
                !isLearnOpen && activeView === 'home'
                  ? 'contents'
                  : 'none',
          }}
        >
          <HomeView
            preloadedCollectionProgress={preloadedCollectionProgress}
            preloadedCourseSettings={preloadedCourseSettings}
            preloadedCustomCollectionsProgress={
              preloadedCustomCollectionsProgress
            }
            onLearnOpen={handleLearnOpen}
            onChatOpen={handleOpenChat}
            onNavigateToContent={() => handleViewChange('content')}
            onNavigateToChat={handleNavigateToChat}
            onEnterTexts={() => {
              handleViewChange('content');
              router.push('/app/content/add-cards');
            }}
            onTutorialReady={handleTutorialReady}
            animateEntrance={justReturnedFromLearn}
            isHidden={isLearnOpen || activeView !== 'home'}
            hasActiveCourse={hasActiveCourse}
            onOpenCourseMenu={handleOpenCourseMenu}
          />
        </div>
        <div
          style={{
            display:
                !isLearnOpen && activeView === 'content'
                  ? 'contents'
                  : 'none',
          }}
        >
          {isAddCardsRoute ? (
            <EnterTextsView onBack={() => router.push('/app/content')} />
          ) : (
            <ContentView
              onChatOpen={handleOpenChat}
              onEnterTexts={() => router.push('/app/content/add-cards')}
              hasActiveCourse={hasActiveCourse}
              onOpenCourseMenu={handleOpenCourseMenu}
            />
          )}
        </div>
        {!isLearnOpen && activeView === 'library' && (
          <LibraryView
            hasActiveCourse={hasActiveCourse}
            onOpenCourseMenu={handleOpenCourseMenu}
          />
        )}
        {!isLearnOpen && activeView === 'stats' && (
          <StatsView />
        )}
        <div
          style={{
            display:
                !isLearnOpen && activeView === 'settings'
                  ? 'contents'
                  : 'none',
          }}
        >
          <SettingsView activeView={activeView} />
        </div>
        {!isLearnOpen && activeView === 'chat' && chatThreadId && (
          <SimplifiedChatView
            threadId={chatThreadId}
            onNewChat={handleNewChat}
            onThreadSelect={handleOpenChat}
            threads={threads}
            sidebarOpen={chatSidebarOpen}
            onSidebarOpenChange={setChatSidebarOpen}
          />
        )}
      </main>

      <BottomNav
        currentView={activeView}
        onViewChange={handleViewChange}
        onLearnOpen={handleLearnOpen}
      />

      {isLearnOpen && (
        <div className="fixed inset-x-0 top-0 z-50 h-dvh max-h-dvh bg-background">
          <LearnView
            onBack={handleLearnClose}
            prefetchedThreadId={prefetchedThreadId ?? undefined}
          />
        </div>
      )}
    </div>
  );
}
