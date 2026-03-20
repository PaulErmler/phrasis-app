'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import {
  useConvexAuth,
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
import { LibraryView } from '@/components/app/LibraryView';
import { SettingsView } from '@/components/app/SettingsView';
import { LearnView } from '@/components/app/learning/LearnView';
import { SimplifiedChatView } from '@/components/app/SimplifiedChatView';

function StableAuthenticated({ children, fallback }: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const wasAuthenticated = useRef(false);

  if (isAuthenticated) {
    wasAuthenticated.current = true;
    sessionStorage.removeItem('auth_recovery_reload');
  }

  useEffect(() => {
    if (wasAuthenticated.current && !isAuthenticated && !isLoading) {
      const alreadyReloaded = sessionStorage.getItem('auth_recovery_reload');
      if (!alreadyReloaded) {
        sessionStorage.setItem('auth_recovery_reload', '1');
        window.location.reload();
      }
    }
  }, [isAuthenticated, isLoading]);

  if (isAuthenticated || (wasAuthenticated.current && isLoading)) {
    return <>{children}</>;
  }

  return <>{fallback ?? null}</>;
}

const VIEW_PATHS: Record<Exclude<View, 'chat'>, string> = {
  home: '/app',
  content: '/app/content',
  library: '/app/library',
  settings: '/app/settings',
};

function viewFromPathname(pathname: string): { view: View; chatThreadId?: string } {
  if (pathname.startsWith('/app/content')) return { view: 'content' };
  if (pathname.startsWith('/app/library')) return { view: 'library' };
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

  const justReturnedFromLearn = useRef(false);

  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('AppPage');
  const locale = useLocale();

  const settings = usePreloadedQuery(preloadedSettings);
  const activeCourse = usePreloadedQuery(preloadedActiveCourse);

  const { isAuthenticated } = useConvexAuth();

  const [initialView] = useState(() => viewFromPathname(pathname));
  const [activeView, setActiveView] = useState<View>(initialView.view);
  const [chatThreadId, setChatThreadId] = useState<string | null>(
    initialView.chatThreadId ?? null,
  );
  const viewBeforeChatRef = useRef<Exclude<View, 'chat'>>('home');
  const [isLearnOpen, setIsLearnOpen] = useState(false);

  useEffect(() => {
    if (!isLearnOpen && justReturnedFromLearn.current) {
      const id = requestAnimationFrame(() => {
        justReturnedFromLearn.current = false;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isLearnOpen]);

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
    isAuthenticated && !isLearnOpen ? {} : 'skip',
  );

  const threads = useQuery(
    api.features.chat.threads.listThreads,
    isAuthenticated && activeView === 'chat' ? {} : 'skip',
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
    if (!isAuthenticated || didPrefetchThread.current) return;
    didPrefetchThread.current = true;
    refreshPrefetchedThread();
  }, [isAuthenticated, refreshPrefetchedThread]);

  const syncQuotas = useAction(api.usage.actions.syncQuotas);
  const didSyncQuotas = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || didSyncQuotas.current) return;
    didSyncQuotas.current = true;
    syncQuotas().catch((err) => {
      console.error('Failed to sync quotas on app load:', err);
    });
  }, [syncQuotas, isAuthenticated]);

  // Onboarding redirect
  const hasCompletedOnboarding = settings?.hasCompletedOnboarding ?? true;
  useEffect(() => {
    if (hasCompletedOnboarding === false) {
      router.push('/app/onboarding');
    }
  }, [hasCompletedOnboarding, router]);

  // Tab switching — pushState so browser back/forward works between tabs
  const handleViewChange = useCallback((view: View) => {
    setActiveView(view);
    setIsLearnOpen(false);
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
    setIsLearnOpen(false);
    history.pushState(null, '', `/app/chat/${threadId}`);
  }, []);

  const handleChatBack = useCallback(() => {
    const target = viewBeforeChatRef.current;
    setActiveView(target);
    history.pushState(null, '', VIEW_PATHS[target]);
  }, []);

  const handleNewChat = useCallback(async () => {
    try {
      const newThreadId = await getOrCreateEmptyThread({});
      handleOpenChat(newThreadId);
    } catch (err) {
      console.error('Failed to create new chat:', err);
    }
  }, [getOrCreateEmptyThread, handleOpenChat]);

  // Learn overlay — pushState so the browser back button can close it
  const handleLearnOpen = useCallback(() => {
    setIsLearnOpen(true);
    history.pushState(null, '', '/app/learn');
    refreshPrefetchedThread();
  }, [refreshPrefetchedThread]);

  const handleLearnClose = useCallback(() => {
    justReturnedFromLearn.current = true;
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

  const courseButtonLabel = activeCourse
    ? t('currentCourseWithLanguages', {
        targetLanguages: activeCourse.targetLanguages
          .map((code) => getLocalizedLanguageNameByCode(code, locale))
          .join(', '),
      })
    : t('changeCourse');

  return (
    <StableAuthenticated fallback={
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background">
        <div className="relative flex items-center justify-center">
          <svg className="absolute size-28 animate-spin" viewBox="0 0 112 112" fill="none">
            <circle cx="56" cy="56" r="52" stroke="currentColor" strokeWidth="3" className="text-muted/40" />
            <path d="M56 4a52 52 0 0 1 52 52" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-muted-foreground" />
          </svg>
          <img src="/icons/icon.svg" alt="Flexling" width={72} height={72} />
        </div>
        <p className="mt-5 text-lg font-semibold text-foreground">Flexling</p>
      </div>
    }>
      <div className="h-screen flex flex-col overflow-hidden">
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
            <ThemeSwitcher className="-mr-2" />
          </div>
        </header>

        <CourseMenu open={courseMenuOpen} onOpenChange={setCourseMenuOpen} />

        <main className="flex-1 min-h-0 flex flex-col">
          {!isLearnOpen && activeView === 'home' && (
            <HomeView
              preloadedCollectionProgress={preloadedCollectionProgress}
              preloadedCourseSettings={preloadedCourseSettings}
              preloadedCustomCollectionsProgress={
                preloadedCustomCollectionsProgress
              }
              onLearnOpen={handleLearnOpen}
              onChatOpen={handleOpenChat}
              animateEntrance={justReturnedFromLearn.current}
            />
          )}
          <div
            style={{
              display:
                !isLearnOpen && activeView === 'content'
                  ? 'contents'
                  : 'none',
            }}
          >
            <ContentView onChatOpen={handleOpenChat} />
          </div>
          {!isLearnOpen && activeView === 'library' && <LibraryView />}
          {!isLearnOpen && activeView === 'settings' && <SettingsView />}
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
          <div className="fixed inset-0 z-50 bg-background">
            <LearnView
              onBack={handleLearnClose}
              prefetchedThreadId={prefetchedThreadId ?? undefined}
            />
          </div>
        )}

        <div className="fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-muted/20 blur-3xl" />
        </div>
      </div>
    </StableAuthenticated>
  );
}
