'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Preloaded, usePreloadedQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { NewChatInput } from '@/components/chat/NewChatInput';
import { CollectionCarousel } from '@/components/app/CollectionCarousel';
import { CustomCollectionCarousel } from '@/components/app/CustomCollectionCarousel';
import { ProgressStatsCard } from '@/components/app/ProgressStatsCard';
import { NoCourseEmptyState } from '@/components/app/NoCourseEmptyState';
import { useTutorial } from '@/lib/tutorials/use-tutorial';
import { TUTORIAL_IDS } from '@/lib/tutorials/registry';
import type { ReviewMode } from '@/convex/types';

export function HomeView({
  preloadedCollectionProgress,
  preloadedCourseSettings,
  preloadedCustomCollectionsProgress,
  onLearnOpen,
  onChatOpen,
  onNavigateToContent,
  onNavigateToChat,
  onTutorialReady,
  animateEntrance,
  isHidden,
  hasActiveCourse,
  onOpenCourseMenu,
}: {
  preloadedCollectionProgress: Preloaded<
    typeof api.features.decks.getCollectionProgress
  >;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedCustomCollectionsProgress: Preloaded<
    typeof api.features.decks.getCustomCollectionsProgress
  >;
  onLearnOpen: () => void;
  onChatOpen: (threadId: string) => void;
  onNavigateToContent: () => void;
  onNavigateToChat: () => void;
  onTutorialReady?: (restart: () => void) => void;
  animateEntrance?: boolean;
  isHidden?: boolean;
  hasActiveCourse: boolean;
  onOpenCourseMenu: () => void;
}) {
  const t = useTranslations('AppPage');

  const { restartTutorial } = useTutorial(TUTORIAL_IDS.HOME_TOUR, {
    delayMs: 1200,
    stepCompleteOnClickIndex: 2,
  });

  useEffect(() => {
    onTutorialReady?.(restartTutorial);
  }, [onTutorialReady, restartTutorial]);

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

  if (!hasActiveCourse) {
    return (
      <div
        className="scroll-view"
        style={{ scrollbarGutter: 'stable' }}
      >
        <NoCourseEmptyState onOpenCourseMenu={onOpenCourseMenu} />
      </div>
    );
  }

  return (
    <div
      className="scroll-view"
      style={{ scrollbarGutter: 'stable' }}
    >
      <div className="app-view">
        <ProgressStatsCard
          key={courseSettings?.courseId}
          onStartReview={handleStartReview}
          animateEntrance={animateEntrance}
          skipLiveStats={isHidden}
          courseId={courseSettings?.courseId}
        />

        <NewChatInput
          showSuggestions={false}
          autoFocus={false}
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
          onNavigateToContent={onNavigateToContent}
          onNavigateToChat={onNavigateToChat}
        />
      </div>
    </div>
  );
}
