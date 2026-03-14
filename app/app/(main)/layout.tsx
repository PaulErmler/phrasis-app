'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import {
  Authenticated,
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
import { ChevronLeft } from 'lucide-react';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import { HomeView } from '@/components/app/HomeView';
import { ContentView } from '@/components/app/ContentView';
import { LibraryView } from '@/components/app/LibraryView';
import { SettingsView } from '@/components/app/SettingsView';
import { LearnView } from '@/components/app/learning/LearnView';
import { SimplifiedChatView } from '@/components/app/SimplifiedChatView';

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
    preloadedCourseStats,
    preloadedCustomCollectionsProgress,
  } = useAppData();

  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('AppPage');
  const locale = useLocale();

  const settings = usePreloadedQuery(preloadedSettings);
  const activeCourse = usePreloadedQuery(preloadedActiveCourse);

  const { isAuthenticated } = useConvexAuth();

  const [activeView, setActiveView] = useState<View>(() =>
    viewFromPathname(pathname).view,
  );
  const [chatThreadId, setChatThreadId] = useState<string | null>(() =>
    viewFromPathname(pathname).chatThreadId ?? null,
  );
  const viewBeforeChatRef = useRef<Exclude<View, 'chat'>>('home');
  const [isLearnOpen, setIsLearnOpen] = useState(false);
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);

  // Warm the getCardForReview Convex subscription before learn opens;
  // skip once learn is open since useLearningMode manages its own subscription
  useQuery(
    api.features.scheduling.getCardForReview,
    isAuthenticated && !isLearnOpen ? {} : 'skip',
  );

  // Pre-create a chat thread so LearnView can use it immediately
  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );
  const [prefetchedThreadId, setPrefetchedThreadId] = useState<string | null>(
    null,
  );
  const didPrefetchThread = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || didPrefetchThread.current) return;
    didPrefetchThread.current = true;
    getOrCreateEmptyThread({}).then(setPrefetchedThreadId).catch(() => {});
  }, [isAuthenticated, getOrCreateEmptyThread]);

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

  // Learn overlay — pushState so the browser back button can close it
  const handleLearnOpen = useCallback(() => {
    setIsLearnOpen(true);
    history.pushState(null, '', '/app/learn');
  }, []);

  const handleLearnClose = useCallback(() => {
    setIsLearnOpen(false);
    history.back();
    // Re-prefetch a fresh thread for the next learn session
    getOrCreateEmptyThread({}).then(setPrefetchedThreadId).catch(() => {});
  }, [getOrCreateEmptyThread]);

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
    <Authenticated>
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
              <Button
                variant="ghost"
                onClick={handleChatBack}
                className="gap-2 -ml-2"
              >
                <ChevronLeft className="h-4 w-4" />
                {t('views.chat')}
              </Button>
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
              preloadedCourseStats={preloadedCourseStats}
              preloadedCustomCollectionsProgress={
                preloadedCustomCollectionsProgress
              }
              onLearnOpen={handleLearnOpen}
              onChatOpen={handleOpenChat}
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
          <div
            style={{
              display:
                !isLearnOpen && activeView === 'settings'
                  ? 'contents'
                  : 'none',
            }}
          >
            <SettingsView />
          </div>
          {!isLearnOpen && activeView === 'chat' && chatThreadId && (
            <SimplifiedChatView threadId={chatThreadId} />
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
    </Authenticated>
  );
}
