'use client';

import { useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { usePreloadedQuery } from 'convex/react';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { BottomNav } from '@/components/app/BottomNav';
import { CourseMenu } from '@/components/app/CourseMenu';
import { useAppData } from '@/components/app/AppDataProvider';
import {
  MainShellProvider,
  type MainShell,
} from '@/components/app/MainShellContext';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import { HelpDialog } from '@/components/app/HelpDialog';

type HeaderView = 'home' | 'library' | 'stats' | 'settings';

function headerViewFromPathname(pathname: string): HeaderView {
  if (pathname.startsWith('/app/library')) return 'library';
  if (pathname.startsWith('/app/stats')) return 'stats';
  if (pathname.startsWith('/app/settings')) return 'settings';
  return 'home';
}

/**
 * Shell chrome for the main tabs: header, bottom nav, course menu. The tabs
 * themselves are real route segments (children) — Next.js owns history,
 * per-tab code-splitting, and per-segment error boundaries.
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { preloadedActiveCourse } = useAppData();
  const pathname = usePathname();
  const t = useTranslations('AppPage');
  const locale = useLocale();

  const activeCourse = usePreloadedQuery(preloadedActiveCourse);

  const view = headerViewFromPathname(pathname);
  // Chat brings its own header (back/sidebar/new-thread need page state);
  // add-cards renders chrome-less, matching the old shell.
  const isChatRoute = pathname.startsWith('/app/chat');
  const isAddCardsRoute = pathname === '/app/content/add-cards';
  const showHeader = !isChatRoute && !isAddCardsRoute;

  const [courseMenuOpen, setCourseMenuOpen] = useState(false);

  const restartTutorialRef = useRef<(() => void) | null>(null);
  const shell = useMemo<MainShell>(
    () => ({
      openCourseMenu: () => setCourseMenuOpen(true),
      registerTutorialRestart: (restart) => {
        restartTutorialRef.current = restart;
      },
    }),
    [],
  );

  const courseButtonLabel = activeCourse
    ? t('currentCourseWithLanguages', {
      targetLanguages: activeCourse.targetLanguages
        .map((code) => getLocalizedLanguageNameByCode(code, locale))
        .join(', '),
    })
    : t('changeCourse');

  return (
    <div className="h-dvh max-h-dvh md:h-screen md:max-h-screen flex flex-col overflow-hidden">
      {showHeader && (
        <header className="fixed top-0 left-0 right-0 z-20 border-b bg-background pt-[env(safe-area-inset-top)]">
          <div className="header-bar">
            {view === 'home' ? (
              <Button
                variant="ghost"
                onClick={() => setCourseMenuOpen(true)}
                className="gap-2 -ml-2 min-w-0 shrink overflow-hidden"
                data-testid="course-menu-trigger"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span className="truncate">{courseButtonLabel}</span>
              </Button>
            ) : (
              <h1 className="heading-section capitalize">
                {t(`views.${view}`)}
              </h1>
            )}
            <div className="flex items-center gap-1 -mr-2 shrink-0">
              <HelpDialog
                supportOnly={view !== 'home'}
                onRestartTutorial={
                  view === 'home'
                    ? () => restartTutorialRef.current?.()
                    : undefined
                }
              />
              <ThemeSwitcher />
            </div>
          </div>
        </header>
      )}

      {showHeader && (
        <div className="shrink-0 h-[calc(3.5rem+env(safe-area-inset-top))]" />
      )}

      <CourseMenu open={courseMenuOpen} onOpenChange={setCourseMenuOpen} />

      <main className="flex-1 min-h-0 flex flex-col relative z-0 overflow-hidden">
        <MainShellProvider value={shell}>{children}</MainShellProvider>
      </main>

      {!isAddCardsRoute && (
        <div className="shrink-0 h-[calc(4rem+env(safe-area-inset-bottom,0px))]" />
      )}
      {!isAddCardsRoute && (
        <div className="fixed bottom-0 left-0 right-0 z-20">
          <BottomNav />
        </div>
      )}
    </div>
  );
}
