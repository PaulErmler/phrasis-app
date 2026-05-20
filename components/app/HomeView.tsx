'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Preloaded, usePreloadedQuery, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { HomeChatInput } from '@/components/chat/HomeChatInput';
import { SegmentedHomeSection } from '@/components/app/segmented/SegmentedHomeSection';
import { ProgressStatsCard } from '@/components/app/ProgressStatsCard';
import { NoCourseEmptyState } from '@/components/app/NoCourseEmptyState';
import { useTutorial } from '@/lib/tutorials/use-tutorial';
import { TUTORIAL_IDS } from '@/lib/tutorials/registry';
import { MessageSquare, PenLine, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { ReviewMode, SchedulingMode } from '@/convex/types';

export function HomeView({
  preloadedCourseSettings,
  onLearnOpen,
  onChatOpen,
  onNavigateToContent,
  onNavigateToChat,
  onEnterTexts,
  onTutorialReady,
  animateEntrance,
  isHidden,
  hasActiveCourse,
  onOpenCourseMenu,
}: {
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  onLearnOpen: () => void;
  onChatOpen: (threadId: string) => void;
  onNavigateToContent: () => void;
  onNavigateToChat: () => void;
  onEnterTexts: () => void;
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
  // Drives the disabled state of the Radio button on the home screen — radio
  // mode is meaningless on an empty deck. Skipped while HomeView is hidden
  // (e.g. user is mid-LearnView) so the subscription doesn't refire on every
  // radio-mode card advance. While loading we leave the button enabled so the
  // click path falls back to the toast.
  const hasPlayableCards = useQuery(
    api.features.scheduling.hasPlayableCards,
    isHidden ? 'skip' : {},
  );
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

  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );
  const [isChatNavigating, setIsChatNavigating] = useState(false);

  const handleGoToChat = useCallback(async () => {
    setIsChatNavigating(true);
    try {
      const threadId = await getOrCreateEmptyThread({});
      onChatOpen(threadId);
    } catch (error) {
      console.error('Failed to open chat:', error);
      toast.error(t('content.chat.openError'));
    } finally {
      setIsChatNavigating(false);
    }
  }, [getOrCreateEmptyThread, onChatOpen, t]);

  const handleStartLearn = useCallback(
    async (schedulingMode: SchedulingMode) => {
      if (!courseSettings?.courseId) return;

      const currentMode = courseSettings.schedulingMode ?? 'learnAndReview';
      if (currentMode !== schedulingMode) {
        // Await the mutation so Convex has committed the new schedulingMode
        // (and the local cardForReview cache is updated) before LearnView
        // mounts. Otherwise the previous mode's cached card flashes briefly,
        // its audio auto-plays, and the consumed tab-init flag prevents the
        // new card from auto-playing once it arrives.
        try {
          await updateCourseSettings({
            courseId: courseSettings.courseId,
            schedulingMode,
          });
        } catch (error) {
          console.error('Failed to update scheduling mode:', error);
        }
      }

      onLearnOpen();
    },
    [courseSettings, updateCourseSettings, onLearnOpen],
  );

  const handleReviewModeChange = useCallback(
    (mode: ReviewMode) => {
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
    },
    [courseSettings, updateCourseSettings],
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
          onStartLearn={handleStartLearn}
          reviewMode={courseSettings?.reviewMode ?? 'audio'}
          onReviewModeChange={handleReviewModeChange}
          animateEntrance={animateEntrance}
          skipLiveStats={isHidden}
          courseId={courseSettings?.courseId}
          hasPlayableCards={hasPlayableCards ?? true}
        />

        {/* Content actions */}
        <div className="card-surface space-y-2 p-3">
          <HomeChatInput onChatCreated={onChatOpen} />

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-2"
              onClick={handleGoToChat}
              disabled={isChatNavigating}
            >
              {isChatNavigating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              {t('content.chat.title')}
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-2"
              onClick={onEnterTexts}
            >
              <PenLine className="h-4 w-4" />
              {t('customContent')}
            </Button>
          </div>
        </div>

        <div className="card-surface space-y-3 p-3">
          <h2 className="heading-section px-1">
            {t('collections.carousel.sectionTitle')}
          </h2>
          <SegmentedHomeSection
            activeCourseId={courseSettings?.courseId ?? null}
            onNavigateToContent={onNavigateToContent}
            onNavigateToChat={onNavigateToChat}
          />
        </div>

      </div>
    </div>
  );
}
