'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Preloaded, usePreloadedQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { NewChatInput } from '@/components/chat/NewChatInput';
import { CollectionCarousel } from '@/components/app/CollectionCarousel';
import { CustomCollectionCarousel } from '@/components/app/CustomCollectionCarousel';
import { ProgressStatsCard } from '@/components/app/ProgressStatsCard';
import { useTutorial } from '@/lib/tutorials/use-tutorial';
import { TUTORIAL_IDS } from '@/lib/tutorials/registry';

type ReviewMode = 'audio' | 'full';

export function HomeView({
  preloadedCollectionProgress,
  preloadedCourseSettings,
  preloadedCourseStats,
  preloadedCustomCollectionsProgress,
  onLearnOpen,
  onChatOpen,
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
  onLearnOpen: () => void;
  onChatOpen: (threadId: string) => void;
}) {
  const t = useTranslations('AppPage');

  useTutorial(TUTORIAL_IDS.HOME_TOUR, {
    delayMs: 1200,
    stepCompleteOnClickIndex: 2,
  });

  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const updateCourseSettings = useMutation(
    api.features.courses.updateCourseSettings,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getActiveCourseSettings,
      {},
    );
    if (current !== undefined && current !== null) {
      const { courseId, ...updates } = args;
      localStore.setQuery(
        api.features.courses.getActiveCourseSettings,
        {},
        { ...current, ...updates },
      );
    }
  });

  const handleStartReview = useCallback(
    async (mode: ReviewMode) => {
      if (!courseSettings?.courseId) return;

      const currentMode = courseSettings.reviewMode ?? 'audio';
      if (currentMode !== mode) {
        void updateCourseSettings({
          courseId: courseSettings.courseId,
          reviewMode: mode,
        }).catch((error) => {
          console.error('Failed to update review mode:', error);
        });
      }

      onLearnOpen();
    },
    [courseSettings, updateCourseSettings, onLearnOpen],
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-8">
      <div className="app-view">
        <ProgressStatsCard
          preloadedCourseStats={preloadedCourseStats}
          onStartReview={handleStartReview}
        />

        <NewChatInput
          showSuggestions={false}
          className="[&_[data-slot=input-group]]:rounded-xl"
          onChatCreated={onChatOpen}
        />

        <div className="space-y-2" data-tutorial="collection-carousel">
          <h2 className="heading-section">
            {t('collections.carousel.sectionTitle')}
          </h2>
          <CollectionCarousel
            preloadedCollectionProgress={preloadedCollectionProgress}
            preloadedCourseSettings={preloadedCourseSettings}
          />
        </div>

        <CustomCollectionCarousel
          preloadedCourseSettings={preloadedCourseSettings}
          preloadedCustomCollectionsProgress={preloadedCustomCollectionsProgress}
        />
      </div>
    </div>
  );
}
