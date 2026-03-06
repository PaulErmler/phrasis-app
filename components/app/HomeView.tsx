'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Preloaded, usePreloadedQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { NewChatInput } from '@/components/chat/NewChatInput';
import { CollectionCarousel } from '@/components/app/CollectionCarousel';
import { CustomCollectionCarousel } from '@/components/app/CustomCollectionCarousel';
import { ProgressStatsCard } from '@/components/app/ProgressStatsCard';

type ReviewMode = 'audio' | 'full';

export function HomeView({
  preloadedCollectionProgress,
  preloadedCourseSettings,
  preloadedCourseStats,
  preloadedCustomCollectionsProgress,
}: {
  preloadedCollectionProgress: Preloaded<
    typeof api.features.decks.getCollectionProgress
  >;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedCourseStats: Preloaded<
    typeof api.features.courses.getCourseStats
  >;
  preloadedCustomCollectionsProgress: Preloaded<
    typeof api.features.decks.getCustomCollectionsProgress
  >;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('AppPage');
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigatingMode, setNavigatingMode] = useState<ReviewMode | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const updateCourseSettings = useMutation(api.features.courses.updateCourseSettings);

  useEffect(() => {
    clearTimeout(timerRef.current);
    setIsNavigating(false);
    setNavigatingMode(null);
  }, [pathname]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleStartReview = useCallback(async (mode: ReviewMode) => {
    if (!courseSettings?.courseId) return;

    const currentMode = courseSettings.reviewMode ?? 'audio';
    if (currentMode !== mode) {
      await updateCourseSettings({ courseId: courseSettings.courseId, reviewMode: mode });
    }

    router.push('/app/learn');
    setNavigatingMode(mode);
    timerRef.current = setTimeout(() => setIsNavigating(true), 500);
  }, [router, courseSettings, updateCourseSettings]);

  const isLearnOverlayActive = pathname === '/app/learn';

  return (
    <div className="flex-1 overflow-y-auto px-4 py-8">
    <div className="app-view">
      {!isLearnOverlayActive && (
        <ProgressStatsCard
          preloadedCourseStats={preloadedCourseStats}
          onStartReview={handleStartReview}
          isNavigating={isNavigating}
          navigatingMode={navigatingMode}
        />
      )}

      <NewChatInput showSuggestions={false} className="[&_[data-slot=input-group]]:rounded-xl" />

      {/* Collection Carousel - Select difficulty and add cards */}
      <div className="space-y-2">
        <h2 className="heading-section">
          {t('collections.carousel.sectionTitle')}
        </h2>
        <CollectionCarousel
          preloadedCollectionProgress={preloadedCollectionProgress}
          preloadedCourseSettings={preloadedCourseSettings}
        />
      </div>

      {/* Custom Collections Carousel */}
      <CustomCollectionCarousel
        preloadedCourseSettings={preloadedCourseSettings}
        preloadedCustomCollectionsProgress={preloadedCustomCollectionsProgress}
      />

    </div>
    </div>
  );
}
