'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Authenticated, usePreloadedQuery } from 'convex/react';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { BottomNav } from '@/components/app/BottomNav';
import { CourseMenu } from '@/components/app/CourseMenu';
import { useAppData } from '@/components/app/AppDataProvider';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import type { View } from '@/components/app/BottomNav';

function viewFromPathname(pathname: string): View {
  if (pathname.startsWith('/app/content')) return 'content';
  if (pathname.startsWith('/app/library')) return 'library';
  if (pathname.startsWith('/app/settings')) return 'settings';
  return 'home';
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const {
    preloadedSettings,
    preloadedActiveCourse,
  } = useAppData();

  const router = useRouter();
  const pathname = usePathname();
  const currentView = viewFromPathname(pathname);
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
          {children}
        </main>

        <BottomNav currentView={currentView} />

        <div className="fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-muted/20 blur-3xl" />
        </div>
      </div>
    </Authenticated>
  );
}
