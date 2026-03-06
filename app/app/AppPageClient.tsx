'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Authenticated, usePreloadedQuery, useAction, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { HomeView } from '@/components/app/HomeView';
import { ContentView } from '@/components/app/ContentView';
import { LibraryView } from '@/components/app/LibraryView';
import { SettingsView } from '@/components/app/SettingsView';
import { BottomNav, View } from '@/components/app/BottomNav';
import { CourseMenu } from '@/components/app/CourseMenu';
import { useAppData } from '@/components/app/AppDataProvider';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';

export function AppPageClient() {
  const {
    preloadedSettings,
    preloadedActiveCourse,
    preloadedCollectionProgress,
    preloadedCourseSettings,
    preloadedCourseStats,
    preloadedCustomCollectionsProgress,
  } = useAppData();

  const router = useRouter();
  const pathname = usePathname();
  const isLearnActive = pathname === '/app/learn';
  const [currentView, setCurrentView] = useState<View>('home');
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);
  const t = useTranslations('AppPage');
  const locale = useLocale();
  const settings = usePreloadedQuery(preloadedSettings);
  const activeCourse = usePreloadedQuery(preloadedActiveCourse);
  const syncQuotas = useAction(api.usage.actions.syncQuotas);
  const { isAuthenticated } = useConvexAuth();
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || syncedRef.current) return;
    syncedRef.current = true;
    syncQuotas().catch((err) => {
      console.error('Failed to sync quotas on app load:', err);
    });
  }, [syncQuotas, isAuthenticated]);

  const courseButtonLabel = activeCourse
    ? t('currentCourseWithLanguages', {
      targetLanguages: activeCourse.targetLanguages
        .map((code) => getLocalizedLanguageNameByCode(code, locale))
        .join(', '),
    })
    : t('changeCourse');
  const hasCompletedOnboarding = settings?.hasCompletedOnboarding ?? true;

  useEffect(() => {
    if (hasCompletedOnboarding === false) {
      router.push('/app/onboarding');
    }
  }, [hasCompletedOnboarding, router]);

  return (
    <>
      <Authenticated>
        <div className="h-screen flex flex-col overflow-hidden">
          <header className="sticky-header">
            <div className="header-bar">
              {currentView === 'home' ? (
                <Button
                  variant="ghost"
                  onClick={() => setCourseMenuOpen(true)}
                  className="gap-2 -ml-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {courseButtonLabel}
                </Button>
              ) : (
                <h1 className="heading-section capitalize">
                  {t(`views.${currentView}`)}
                </h1>
              )}
              <ThemeSwitcher className="-mr-2" />
            </div>
          </header>

          <CourseMenu open={courseMenuOpen} onOpenChange={setCourseMenuOpen} />

          <main className="flex-1 min-h-0 flex flex-col">
            {!isLearnActive && (
              <>
                {currentView === 'home' && (
                  <HomeView
                    preloadedCollectionProgress={preloadedCollectionProgress}
                    preloadedCourseSettings={preloadedCourseSettings}
                    preloadedCourseStats={preloadedCourseStats}
                    preloadedCustomCollectionsProgress={preloadedCustomCollectionsProgress}
                  />
                )}
                {currentView === 'content' && <ContentView />}
                {currentView === 'library' && <LibraryView />}
                {currentView === 'settings' && <SettingsView />}
              </>
            )}
          </main>

          <BottomNav currentView={currentView} onViewChange={setCurrentView} />

          <div className="fixed inset-0 -z-10 overflow-hidden">
            <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-muted/20 blur-3xl" />
          </div>
        </div>
      </Authenticated>
    </>
  );
}
