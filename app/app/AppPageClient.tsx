'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { RedirectToSignIn } from '@daveyplate/better-auth-ui';
import { Authenticated, usePreloadedQuery, Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { HomeView } from '@/components/app/HomeView';
import { ContentView } from '@/components/app/ContentView';
import { LibraryView } from '@/components/app/LibraryView';
import { SettingsView } from '@/components/app/SettingsView';
import { BottomNav, View } from '@/components/app/BottomNav';
import { CourseMenu } from '@/components/app/CourseMenu';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';

export function AppPageClient({
  preloadedSettings,
  preloadedActiveCourse,
  preloadedCollectionProgress,
  preloadedCourseSettings,
  preloadedCourseStats,
}: {
  preloadedSettings: Preloaded<typeof api.features.courses.getUserSettings>;
  preloadedActiveCourse: Preloaded<typeof api.features.courses.getActiveCourse>;
  preloadedCollectionProgress: Preloaded<
    typeof api.features.decks.getCollectionProgress
  >;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedCourseStats: Preloaded<
    typeof api.features.courses.getCourseStats
  >;
}) {
  const router = useRouter();
  const [currentView, setCurrentView] = useState<View>('home');
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);
  const t = useTranslations('AppPage');
  const locale = useLocale();
  const settings = usePreloadedQuery(preloadedSettings);
  const activeCourse = usePreloadedQuery(preloadedActiveCourse);

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
      <RedirectToSignIn />
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

          <main className="flex-1 min-h-0 overflow-y-auto container mx-auto px-4 py-8">
            {currentView === 'home' && (
              <HomeView
                preloadedCollectionProgress={preloadedCollectionProgress}
                preloadedCourseSettings={preloadedCourseSettings}
                preloadedCourseStats={preloadedCourseStats}
              />
            )}
            {currentView === 'content' && <ContentView />}
            {currentView === 'library' && <LibraryView />}
            {currentView === 'settings' && <SettingsView />}
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
