'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { usePreloadedQuery, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { BottomNav, type View } from '@/components/app/BottomNav';
import { CourseMenu } from '@/components/app/CourseMenu';
import { useAppData } from '@/components/app/AppDataProvider';
import { Button } from '@/components/ui/button';
import { ChevronLeft, MessageSquarePlus, PanelLeft } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useNowMinute } from '@/hooks/use-now-minute';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import { getUserTimezone } from '@/lib/timezone';
import { usePrefetchedThread } from '@/hooks/use-prefetched-thread';
import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';
import {
  getSessionReviewCount,
  resetSessionReviewCount,
} from '@/lib/posthog/review-session-counter';
import { HomeView } from '@/components/app/HomeView';
import { FreePlanUpgradeBadge } from '@/components/app/FreePlanUpgradeBadge';
import { AddCardsView } from '@/components/app/AddCardsView';
import { LibraryView } from '@/components/app/LibraryView';
import { StatsView } from '@/components/app/stats/StatsView';
import { SettingsView } from '@/components/app/SettingsView';
import { LearnView } from '@/components/app/learning/LearnView';
import { SimplifiedChatView } from '@/components/app/SimplifiedChatView';
import { HelpDialog } from '@/components/app/HelpDialog';
import { ViewErrorBoundary } from '@/components/app/ViewErrorBoundary';
import { reportError } from '@/lib/report-error';

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
  if (pathname.startsWith('/app/learn'))
    return { view: 'home', isLearnOpen: true };
  if (pathname.startsWith('/app/content')) return { view: 'home' };
  if (pathname.startsWith('/app/library')) return { view: 'library' };
  if (pathname.startsWith('/app/stats')) return { view: 'stats' };
  if (pathname.startsWith('/app/settings')) return { view: 'settings' };
  const chatMatch = pathname.match(/^\/app\/chat\/(.+)/);
  if (chatMatch) return { view: 'chat', chatThreadId: chatMatch[1] };
  return { view: 'home' };
}

/** Keep-mounted view shell: the view stays mounted for the lifetime of the
 *  layout and toggles between `display: contents` (visible) and
 *  `display: none`, so switching tabs never loses view state. Must stay at
 *  MODULE scope. Declared inside `MainLayout` it would be a new component
 *  type each render, remounting (and resetting) every view. */
function KeepMountedView({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: visible ? 'contents' : 'none' }}>
      <ViewErrorBoundary>{children}</ViewErrorBoundary>
    </div>
  );
}

export default function MainLayout({
  children: _children,
}: {
  children: React.ReactNode;
}) {
  const { preloadedSettings, activeCourse } = useAppData();

  const [justReturnedFromLearn, setJustReturnedFromLearn] = useState(false);
  const restartTutorialRef = useRef<(() => void) | null>(null);

  const handleTutorialReady = useCallback((restart: () => void) => {
    restartTutorialRef.current = restart;
  }, []);

  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('AppPage');
  const tChatSidebar = useTranslations('Chat.sidebar');
  const locale = useLocale();

  // Result unused, but the hook call keeps the preloaded-settings
  // subscription mounted for the lifetime of the layout.
  const _settings = usePreloadedQuery(preloadedSettings);
  // activeCourse comes from AppDataProvider's always-mounted subscription,
  // subscribing here instead would start cold after the onboarding soft nav
  // and flash the stale preloaded null (no-course empty state).

  const [initialView] = useState(() => viewFromPathname(pathname));
  const [activeView, setActiveView] = useState<View>(initialView.view);
  const [chatThreadId, setChatThreadId] = useState<string | null>(
    initialView.chatThreadId ?? null,
  );
  const viewBeforeChatRef = useRef<Exclude<View, 'chat'>>('home');
  const [hasVisitedStats, setHasVisitedStats] = useState(
    initialView.view === 'stats',
  );
  const [hasVisitedLibrary, setHasVisitedLibrary] = useState(
    initialView.view === 'library',
  );
  const [isLearnOpen, setIsLearnOpen] = useState(
    initialView.isLearnOpen ?? false,
  );
  const isLearnOpenRef = useRef(false);
  useEffect(() => {
    if (isLearnOpen && !isLearnOpenRef.current) {
      // A session just opened — via the learn button, a /app/learn deep-link
      // mount, or popstate forward. Resetting on the open *transition* (not
      // in handleLearnOpen) covers all three, so a back-then-forward reopen
      // can't report the previous session's tally.
      resetSessionReviewCount();
    }
    isLearnOpenRef.current = isLearnOpen;
  }, [isLearnOpen]);
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
  // skip once learn is open since useLearningMode manages its own subscription.
  // Match the hook's args (timezone + minute-quantized `now`) byte-identically
  // so we hit the same subscription cache entry and the warm subscription
  // survives the handoff. Paused while learn is open (query is skipped then;
  // useNowMinute re-quantizes on unpause).
  const warmupNow = useNowMinute(isLearnOpen);
  useQuery(
    api.features.scheduling.getCardForReview,
    !isLearnOpen ? { timezone: getUserTimezone(), now: warmupNow } : 'skip',
  );

  const threads = useQuery(
    api.features.chat.threads.listThreads,
    activeView === 'chat' ? {} : 'skip',
  );

  // Pre-create a chat thread so LearnView can use it immediately
  const {
    prefetchedThreadId,
    refreshPrefetchedThread,
    getOrCreateEmptyThread,
  } = usePrefetchedThread();

  // Quota syncing lives in BillingGate (mounted in the /app layout) so that
  // routes outside this group, notably the standalone /app/learn page. Are
  // covered too.

  // Tab switching. pushState so browser back/forward works between tabs
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
      reportError(err, { op: 'newChatThread' });
    }
  }, [getOrCreateEmptyThread, handleOpenChat]);

  const handleNavigateToChat = useCallback(() => {
    if (prefetchedThreadId) {
      handleOpenChat(prefetchedThreadId);
    } else {
      void handleNewChat();
    }
  }, [prefetchedThreadId, handleOpenChat, handleNewChat]);

  const handleNavigateToAddCards = useCallback(() => {
    router.push('/app/content/add-cards');
  }, [router]);

  // Wall-clock start of the current learn session, used to derive its duration
  // on close. Deliberately a ref: this must not trigger a re-render of a layout
  // that owns every tab in the app.
  const learnStartedAtRef = useRef<number | null>(null);

  // Learn overlay. pushState so the browser back button can close it
  const handleLearnOpen = useCallback(() => {
    setIsLearnOpen(true);
    setHasVisitedStats(false);
    setHasVisitedLibrary(false);
    history.pushState(null, '', '/app/learn');
    refreshPrefetchedThread();
    learnStartedAtRef.current = Date.now();
    // Session-level, not per-review: the per-review detail already lives in
    // dailyStats/courseStats, and duplicating it into PostHog would dominate
    // the event bill for no analytical gain.
    capture(CLIENT_EVENTS.REVIEW_SESSION_STARTED, {
      course_id: activeCourse?._id,
      target_languages: activeCourse?.targetLanguages,
      current_level: activeCourse?.currentLevel,
    });
  }, [refreshPrefetchedThread, activeCourse]);

  const handleLearnClose = useCallback(() => {
    setJustReturnedFromLearn(true);
    isLearnOpenRef.current = false;
    setIsLearnOpen(false);
    // Always land on Home, regardless of which tab opened the session.
    // replaceState (not pushState) swaps the /app/learn entry so the history
    // stack doesn't grow learn→home→learn on repeated sessions; browser
    // back from Home still returns to the pre-learn view.
    setActiveView('home');
    history.replaceState(null, '', VIEW_PATHS['home']);
    refreshPrefetchedThread();
    const startedAt = learnStartedAtRef.current;
    learnStartedAtRef.current = null;
    capture(CLIENT_EVENTS.REVIEW_SESSION_ENDED, {
      duration_ms: startedAt === null ? undefined : Date.now() - startedAt,
      reviews_count: getSessionReviewCount(),
      course_id: activeCourse?._id,
      target_languages: activeCourse?.targetLanguages,
      current_level: activeCourse?.currentLevel,
    });
  }, [refreshPrefetchedThread, activeCourse]);

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
    <div className="h-dvh max-h-dvh md:h-screen md:max-h-screen flex flex-col overflow-hidden">
      {!isAddCardsRoute && (
        <header className="fixed top-0 left-0 right-0 z-20 border-b bg-background pt-[var(--safe-top)]">
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
                  aria-label={tChatSidebar('toggleConversations')}
                  data-testid="chat-toggle-conversations"
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNewChat}
                  aria-label={tChatSidebar('newChat')}
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
              {activeView === 'home' && <FreePlanUpgradeBadge />}
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
        <div className="shrink-0 h-[calc(3.5rem+var(--safe-top))]" />
      )}

      <CourseMenu open={courseMenuOpen} onOpenChange={setCourseMenuOpen} />

      <main className="flex-1 min-h-0 flex flex-col relative z-0 overflow-hidden">
        <KeepMountedView
          visible={!isLearnOpen && activeView === 'home' && !isAddCardsRoute}
        >
          <HomeView
            onLearnOpen={handleLearnOpen}
            onChatOpen={handleOpenChat}
            onNavigateToContent={handleNavigateToAddCards}
            onNavigateToChat={handleNavigateToChat}
            onEnterTexts={handleNavigateToAddCards}
            onTutorialReady={handleTutorialReady}
            animateEntrance={justReturnedFromLearn}
            isHidden={isLearnOpen || activeView !== 'home' || isAddCardsRoute}
            hasActiveCourse={hasActiveCourse}
            onOpenCourseMenu={handleOpenCourseMenu}
          />
        </KeepMountedView>
        {isAddCardsRoute && (
          <KeepMountedView visible={!isLearnOpen}>
            <ViewErrorBoundary>
              <AddCardsView
                onBack={() => {
                  setActiveView('home');
                  router.push('/app');
                }}
              />
            </ViewErrorBoundary>
          </KeepMountedView>
        )}
        {hasVisitedLibrary && (
          <KeepMountedView visible={!isLearnOpen && activeView === 'library'}>
            <LibraryView
              hasActiveCourse={hasActiveCourse}
              onOpenCourseMenu={handleOpenCourseMenu}
            />
          </KeepMountedView>
        )}
        {hasVisitedStats && (
          <KeepMountedView visible={!isLearnOpen && activeView === 'stats'}>
            <StatsView />
          </KeepMountedView>
        )}
        <KeepMountedView visible={!isLearnOpen && activeView === 'settings'}>
          <SettingsView activeView={activeView} />
        </KeepMountedView>
        {!isLearnOpen && activeView === 'chat' && chatThreadId && (
          <ViewErrorBoundary>
            <SimplifiedChatView
              threadId={chatThreadId}
              onNewChat={handleNewChat}
              onThreadSelect={handleOpenChat}
              threads={threads}
              sidebarOpen={chatSidebarOpen}
              onSidebarOpenChange={setChatSidebarOpen}
            />
          </ViewErrorBoundary>
        )}
      </main>

      {!isAddCardsRoute && (
        <>
          <div className="shrink-0 h-[calc(4rem+var(--safe-bottom))]" />
          <div
            className={`fixed bottom-0 left-0 right-0 z-20 ${isLearnOpen ? 'pointer-events-none' : ''}`}
          >
            <BottomNav
              currentView={activeView}
              onViewChange={handleViewChange}
              onLearnOpen={handleLearnOpen}
            />
          </div>
        </>
      )}

      {isLearnOpen && (
        <div className="fixed inset-0 z-50 bg-background">
          <ViewErrorBoundary>
            <LearnView
              onBack={handleLearnClose}
              prefetchedThreadId={prefetchedThreadId ?? undefined}
              onNavigateToChat={handleNavigateToChat}
              onNavigateToAddCustomCards={handleNavigateToAddCards}
            />
          </ViewErrorBoundary>
        </div>
      )}
    </div>
  );
}
