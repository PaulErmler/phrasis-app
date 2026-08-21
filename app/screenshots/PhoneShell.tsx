'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BottomNav, type View } from '@/components/app/BottomNav';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

/**
 * Replica of the real /app shell from app/app/(main)/layout.tsx, same
 * header, spacers, and (real) BottomNav, without any Convex data
 * dependencies. Only used by the store-screenshot pages.
 */
export function PhoneShell({
  activeView,
  courseLabel,
  children,
}: {
  activeView: View;
  /** Home shows the course-menu trigger instead of the view title. */
  courseLabel?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('AppPage');

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden bg-background text-foreground">
      <header className="fixed top-0 left-0 right-0 z-20 border-b bg-background pt-[env(safe-area-inset-top)]">
        <div className="header-bar">
          {activeView === 'home' && courseLabel ? (
            <Button
              variant="ghost"
              className="gap-2 -ml-2 min-w-0 shrink overflow-hidden"
            >
              <ChevronLeft className="h-4 w-4 shrink-0" />
              <span className="truncate">{courseLabel}</span>
            </Button>
          ) : (
            <h1 className="heading-section capitalize">
              {t(`views.${activeView}`)}
            </h1>
          )}
          <div className="flex items-center gap-1 -mr-2 shrink-0">
            <Button variant="ghost" size="icon" aria-label="Help">
              <HelpCircle className="h-5 w-5" />
            </Button>
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <div className="shrink-0 h-[calc(3.5rem+env(safe-area-inset-top))]" />

      <main className="flex-1 min-h-0 flex flex-col relative z-0 overflow-hidden">
        {children}
      </main>

      <div className="shrink-0 h-[calc(4rem+env(safe-area-inset-bottom,0px))]" />
      <div className="fixed bottom-0 left-0 right-0 z-20">
        <BottomNav
          currentView={activeView}
          onViewChange={() => {}}
          onLearnOpen={() => {}}
        />
      </div>
    </div>
  );
}
