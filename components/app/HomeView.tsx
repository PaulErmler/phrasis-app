'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePreloadedQuery, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useUpdateCourseSettings } from '@/hooks/use-update-course-settings';
import { HomeChatInput } from '@/components/chat/HomeChatInput';
import { SegmentedHomeSection } from '@/components/app/segmented/SegmentedHomeSection';
import { ProgressStatsCard } from '@/components/app/ProgressStatsCard';
import { WorkloadForecastCard } from '@/components/app/forecast/WorkloadForecastCard';
import { NoCourseEmptyState } from '@/components/app/NoCourseEmptyState';
import { useAppData } from '@/components/app/AppDataProvider';
import { useTutorial } from '@/lib/tutorials/use-tutorial';
import { TUTORIAL_IDS } from '@/lib/tutorials/registry';
import { MessageSquare, PenLine, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { ReviewMode, SchedulingMode } from '@/convex/types';

// Module-level guard so the all-modes content warm fires at most once per
// course per page session (not on every HomeView re-render or remount). Keyed
// by courseId so switching the active course re-warms.
const warmedCourseIds = new Set<string>();

export function HomeView({
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

  const { courseSettings, preloadedSettings } = useAppData();
  const userSettings = usePreloadedQuery(preloadedSettings);

  const { restartTutorial } = useTutorial(TUTORIAL_IDS.HOME_TOUR, {
    delayMs: 1200,
    stepCompleteOnClickIndex: 2,
    // Home stays mounted across tabs (KeepMountedView). Only auto-start
    // when home is actually visible so the overlay doesn't pop over
    // Settings / Library / Learn.
    //
    // Two more gates, both about not burning this one-time tour on a screen
    // that can't support it. A dismissal marks it complete forever:
    //   - `hasActiveCourse`: without a course HomeView renders only the
    //     empty state, so every anchor the tour highlights is absent.
    //   - `courseSettings != null`: the free-play step is anchored from
    //     `reviewMode` below, and `usePreloadedQuery` can serve a stale null
    //     immediately after the onboarding soft nav (see AppDataProvider),
    //     starting then would show a Writing user the Radio step and
    //     highlight a button that isn't on screen.
    enabled: !isHidden && hasActiveCourse && courseSettings != null,
    // Anchors the free-play step to the button that actually renders:
    // Radio (Shadowing) vs Free Study (Writing). Matches the face chosen in
    // StartLearningButton, which sets `data-tutorial` from the same field.
    // `hideDueCounts` drops the pills step when those pills are not on screen.
    context: {
      reviewMode: courseSettings?.reviewMode ?? 'audio',
      hideDueCounts: userSettings?.hideDueCounts === true,
    },
  });

  useEffect(() => {
    onTutorialReady?.(restartTutorial);
  }, [onTutorialReady, restartTutorial]);
  // Drives the disabled state of the Radio button on the home screen. Radio
  // mode is meaningless on an empty deck. Skipped while HomeView is hidden
  // (e.g. user is mid-LearnView) so the subscription doesn't refire on every
  // radio-mode card advance. While loading we leave the button enabled so the
  // click path falls back to the toast.
  const hasPlayableCards = useQuery(
    api.features.scheduling.hasPlayableCards,
    isHidden ? 'skip' : {},
  );
  const updateCourseSettings = useUpdateCourseSettings();

  const ensureAllModesContent = useMutation(
    api.features.decks.ensureUpcomingCardsContentAllModes,
  );

  // Pre-warm card content (translations + TTS) for the upcoming cards of every
  // scheduling mode while the user is on Home, so whichever mode they pick
  // starts without waiting on content generation. Skipped while HomeView is
  // hidden (user mid-LearnView, where useLearningMode already warms content).
  const courseId = courseSettings?.courseId;
  useEffect(() => {
    if (isHidden) return;
    if (!courseId) return;
    if (warmedCourseIds.has(courseId)) return;

    warmedCourseIds.add(courseId);
    ensureAllModesContent().catch((error) => {
      console.error('Failed to ensure upcoming cards content:', error);
      warmedCourseIds.delete(courseId);
    });
  }, [isHidden, courseId, ensureAllModesContent]);

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
          onReviewModeChange={handleReviewModeChange}
          animateEntrance={animateEntrance}
          skipLiveStats={isHidden}
          courseId={courseSettings?.courseId}
          hasPlayableCards={hasPlayableCards ?? true}
        />

        {/* 7-day workload forecast. Hidden with the due-count pills
            (hideDueCounts); pauses its subscription while home is hidden. */}
        <WorkloadForecastCard skip={isHidden} />

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
          {/* Section title lives inside SegmentedHomeSection now, sharing a
              row with the compact Course/Custom switcher (top right). */}
          <SegmentedHomeSection
            onNavigateToContent={onNavigateToContent}
            onNavigateToChat={onNavigateToChat}
          />
        </div>

      </div>
    </div>
  );
}
