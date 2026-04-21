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
import { AddCardsView } from '@/components/app/AddCardsView';
import { LibraryView } from '@/components/app/LibraryView';
import { StatsView } from '@/components/app/stats/StatsView';
import { SettingsView } from '@/components/app/SettingsView';
import { LearnView } from '@/components/app/learning/LearnView';
import { SimplifiedChatView } from '@/components/app/SimplifiedChatView';
import { HelpDialog } from '@/components/app/HelpDialog';
import { AppLoadingSplash } from '@/components/LogoSpinner';

const VIEW_PATHS: Record<Exclude<View, 'chat'>, string> = {
  home: '/app',
  library: '/app/library',
  stats: '/app/stats',
  settings: '/app/settings',
};

function viewFromPathname(pathname: string): {
  view: View;
  chatThreadId?: string;
  isLearnOpen?: boolean;
} {
  if (pathname.startsWith('/app/learn')) return { view: 'home', isLearnOpen: true };
  if (pathname.startsWith('/app/content')) return { view: 'home' };
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
  const [hasVisitedStats, setHasVisitedStats] = useState(initialView.view === 'stats');
  const [hasVisitedLibrary, setHasVisitedLibrary] = useState(initialView.view === 'library');
  const [isLearnOpen, setIsLearnOpen] = useState(initialView.isLearnOpen ?? false);
  const isLearnOpenRef = useRef(false);
  useEffect(() => { isLearnOpenRef.current = isLearnOpen; }, [isLearnOpen]);
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

  // Tab switching — pushState so browser back/forward works between tabs
  const handleViewChange = useCallback((view: View) => {
    setActiveView(view);
    isLearnOpenRef.current = false;
    setIsLearnOpen(false);
    if (view === 'stats') setHasVisitedStats(true);
    if (view === 'library') setHasVisitedLibrary(true);
    if (view !== 'chat') {
      history.pushState(null, '', VIEW_PATHS[view]);
    }
  }, []);

  const handleOpenChat = useCallback((threadId: string) => {
    setActiveView((prev) => {
      if (prev !== 'chat') viewBeforeChatRef.current = prev;
      return 'chat';
    });
    setChatThreadId(threadId);
    isLearnOpenRef.current = false;
    setIsLearnOpen(false);
    setHasVisitedStats(false);
    setHasVisitedLibrary(false);
    history.pushState(null, '', `/app/chat/${threadId}`);
  }, []);

  const handleChatBack = useCallback(() => {
    setActiveView('home');
    history.pushState(null, '', VIEW_PATHS['home']);
  }, []);

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
    setHasVisitedStats(false);
    setHasVisitedLibrary(false);
    history.pushState(null, '', '/app/learn');
    refreshPrefetchedThread();
  }, [refreshPrefetchedThread]);

  const handleLearnClose = useCallback(() => {
    setJustReturnedFromLearn(true);
    // Sync ref BEFORE history.back() to avoid a race where the popstate
    // swipe-back guard sees a stale `true` value and re-pushes /app/learn.
    isLearnOpenRef.current = false;
    setIsLearnOpen(false);
    history.back();
    refreshPrefetchedThread();
  }, [refreshPrefetchedThread]);

  // Sync state when the user navigates with browser back/forward buttons
  // (including iOS/Android edge-swipe back gestures).
  useEffect(() => {
    const onPopState = () => {
      const url = window.location.pathname;
      if (url === '/app/learn') {
        setIsLearnOpen(true);
        return;
      }
      // Left /app/learn via browser back or swipe-back. Mirror the
      // programmatic close in handleLearnClose so the return-from-learn
      // side effects (prefetched thread refresh, one-frame flag) fire.
      if (isLearnOpenRef.current) {
        setJustReturnedFromLearn(true);
        refreshPrefetchedThread();
      }
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
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [refreshPrefetchedThread]);

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
    <div className="h-svh max-h-svh md:h-screen md:max-h-screen flex flex-col overflow-hidden">
      {!isAddCardsRoute && (
        <header className="fixed top-0 left-0 right-0 z-20 border-b bg-background pt-[env(safe-area-inset-top)]">
          <div className="header-bar">
            {activeView === 'home' ? (
              <Button
                variant="ghost"
                onClick={() => setCourseMenuOpen(true)}
                className="gap-2 -ml-2 min-w-0 shrink overflow-hidden"
                data-testid="course-menu-trigger"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span className="truncate">{courseButtonLabel}</span>
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
            ) : (
              <h1 className="heading-section capitalize">
                {t(`views.${activeView}`)}
              </h1>
            )}
            <div className="flex items-center gap-1 -mr-2 shrink-0">
              {(activeView === 'home' ||
                activeView === 'library' ||
                activeView === 'stats' ||
                activeView === 'settings') && (
                <HelpDialog
                  supportOnly={
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

      {!isAddCardsRoute && (
        <div className="shrink-0 h-[calc(3.5rem+env(safe-area-inset-top))]" />
      )}

      <CourseMenu open={courseMenuOpen} onOpenChange={setCourseMenuOpen} />

      <main className="flex-1 min-h-0 flex flex-col relative z-0 overflow-hidden">
        <div
          style={{
            display:
                !isLearnOpen && activeView === 'home' && !isAddCardsRoute
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
            onNavigateToContent={() => router.push('/app/content/add-cards')}
            onNavigateToChat={handleNavigateToChat}
            onEnterTexts={() => router.push('/app/content/add-cards')}
            onTutorialReady={handleTutorialReady}
            animateEntrance={justReturnedFromLearn}
            isHidden={isLearnOpen || activeView !== 'home' || isAddCardsRoute}
            hasActiveCourse={hasActiveCourse}
            onOpenCourseMenu={handleOpenCourseMenu}
          />
        </div>
        {isAddCardsRoute && (
          <div style={{ display: !isLearnOpen ? 'contents' : 'none' }}>
            <AddCardsView onBack={() => {
              setActiveView('home');
              router.push('/app');
            }} />
          </div>
        )}
        {hasVisitedLibrary && (
          <div
            style={{
              display:
                  !isLearnOpen && activeView === 'library'
                    ? 'contents'
                    : 'none',
            }}
          >
            <LibraryView
              hasActiveCourse={hasActiveCourse}
              onOpenCourseMenu={handleOpenCourseMenu}
            />
          </div>
        )}
        {hasVisitedStats && (
          <div
            style={{
              display:
                  !isLearnOpen && activeView === 'stats'
                    ? 'contents'
                    : 'none',
            }}
          >
            <StatsView />
          </div>
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

      {!isAddCardsRoute && (
        <div className="shrink-0 h-16 pb-[env(safe-area-inset-bottom,0px)]" />
      )}
      {!isAddCardsRoute && (
        <div className={`fixed bottom-0 left-0 right-0 z-20 ${isLearnOpen ? 'pointer-events-none' : ''}`}>
          <BottomNav
            currentView={activeView}
            onViewChange={handleViewChange}
            onLearnOpen={handleLearnOpen}
          />
        </div>
      )}

      {isLearnOpen && (
        <div className="fixed inset-0 z-50 bg-background">
          <LearnView
            onBack={handleLearnClose}
            prefetchedThreadId={prefetchedThreadId ?? undefined}
          />
        </div>
      )}
    </div>
  );
}
