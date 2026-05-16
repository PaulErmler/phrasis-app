'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Play, Clock, Headphones, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfettiBurst } from '@/components/effects/ConfettiBurst';
import {
  OnboardingFirstLesson,
  type OnboardingSessionSummary,
} from './OnboardingFirstLesson';
import type { ReviewMode } from '../types';

/**
 * First-lesson container. Two phases:
 *
 *   1. **Intro + mode picker** — Flexling logo, headline, ~10 min note,
 *      and a two-card mode selector (Audio is preselected). Picking a
 *      different mode is persisted to both `onboardingProgress` (via
 *      `onModeSelected`) and the active course's settings (via
 *      `updateCourseSettings`) before the lesson starts.
 *
 *   2. **Lesson** — real `LearningMode` rendered inline via
 *      `OnboardingFirstLesson` with onboarding coachmarks.
 */

interface Props {
  initialReviewMode: ReviewMode;
  /** Cards already rated in this first lesson before mount (reload resume). */
  initialCardsRated?: number;
  /** Persisted session id from a previous mount. Forwarded to
   *  `OnboardingFirstLesson` → `useLearningMode` so a mid-lesson reload
   *  keeps the new-words hero / session progress bar continuous. */
  initialSessionId?: string;
  onModeSelected: (mode: ReviewMode) => void;
  /** Called every time a card is rated so the parent can persist progress. */
  onCardsRatedChange?: (n: number) => void;
  /** Called once per fresh lesson when we learn the underlying session id —
   *  wizard persists it so a reload can pass it back via `initialSessionId`. */
  onSessionIdDiscovered?: (sessionId: string) => void;
  /** Live snapshot on every rated card so the wizard can persist
   *  `firstLessonSummary` continuously (survives abort/restart/skip). */
  onSnapshotUpdate?: (snapshot: OnboardingSessionSummary) => void;
  onLessonComplete: (summary: OnboardingSessionSummary) => void;
  onSkipLesson: () => void;
}

export function FirstLessonContainer({
  initialReviewMode,
  initialCardsRated,
  initialSessionId,
  onModeSelected,
  onCardsRatedChange,
  onSessionIdDiscovered,
  onSnapshotUpdate,
  onLessonComplete,
  onSkipLesson,
}: Props) {
  const t = useTranslations('Onboarding.firstLesson');
  // Resume directly in the lesson if we have prior progress (skip the intro
  // mode-picker — the user already picked + started).
  const [phase, setPhase] = useState<'intro' | 'lesson'>(
    initialCardsRated && initialCardsRated > 0 ? 'lesson' : 'intro',
  );
  const [mode, setMode] = useState<ReviewMode>(initialReviewMode);

  const activeCourse = useQuery(api.features.courses.getActiveCourse, {});
  const updateCourseSettings = useMutation(api.features.courses.updateCourseSettings);

  const handlePick = (next: ReviewMode) => {
    setMode(next);
    onModeSelected(next);
  };

  const handleStart = async () => {
    // Sync the picked mode into courseSettings before starting — the lesson
    // reads `state.courseSettings.reviewMode` to decide audio vs full flow.
    if (activeCourse?._id) {
      try {
        await updateCourseSettings({
          courseId: activeCourse._id,
          reviewMode: mode,
        });
      } catch (err) {
        console.error('Failed to persist review mode before lesson:', err);
      }
    }
    setPhase('lesson');
  };

  if (phase === 'lesson') {
    return (
      <OnboardingFirstLesson
        initialCardsRated={initialCardsRated}
        initialSessionId={initialSessionId}
        onCardsRatedChange={onCardsRatedChange}
        onSessionIdDiscovered={onSessionIdDiscovered}
        onSnapshotUpdate={onSnapshotUpdate}
        onLessonComplete={onLessonComplete}
        onAbort={() => setPhase('intro')}
      />
    );
  }

  return (
    <div
      data-testid="onboarding-step-first-lesson-intro"
      className="flex flex-col h-full items-center justify-center text-center animate-in fade-in duration-300 px-4 overflow-y-auto py-6"
    >
      <div className="max-w-md w-full space-y-5">
        {/* Flexling logo with the shared particle confetti bursting around it. */}
        <div className="relative flex justify-center h-[80px]">
          <ConfettiBurst />
          <Image
            src="/icons/icon.svg"
            alt="Flexling"
            width={72}
            height={72}
            className="rounded-2xl relative z-10"
            priority
          />
        </div>
        <h2 className="text-3xl md:text-4xl font-bold">{t('intro.title')}</h2>
        <p className="text-muted-foreground">{t('intro.subtitle')}</p>

        {/* Mode picker — Audio preselected */}
        <div className="space-y-2 text-left">
          <ModeRow
            testId="first-lesson-mode-audio"
            selected={mode === 'audio'}
            onClick={() => handlePick('audio')}
            Icon={Headphones}
            title={t('modes.audio.title')}
            description={t('modes.audio.description')}
            footnote={t('modes.audio.footnote')}
          />
          <ModeRow
            testId="first-lesson-mode-full"
            selected={mode === 'full'}
            onClick={() => handlePick('full')}
            Icon={BookOpen}
            title={t('modes.full.title')}
            description={t('modes.full.description')}
          />
        </div>

        <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground bg-muted/50 rounded-full px-3 py-1">
          <Clock className="h-3.5 w-3.5" />
          {t('duration')}
        </div>

        <div>
          <Button
            size="lg"
            className="gap-2 w-full max-w-xs mx-auto"
            onClick={handleStart}
            data-testid="first-lesson-start"
          >
            <Play className="h-4 w-4" />
            {t('start')}
          </Button>
        </div>
        <div className="pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onSkipLesson}
            data-testid="first-lesson-skip"
          >
            {t('skip')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModeRow({
  selected,
  onClick,
  Icon,
  title,
  description,
  footnote,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  footnote?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'w-full rounded-xl border p-3 md:p-4 text-left transition-all flex items-start gap-3',
        'hover:bg-accent',
        selected && 'border-primary bg-primary/5 ring-2 ring-primary/20',
      )}
    >
      <div
        className={cn(
          'shrink-0 h-9 w-9 rounded-lg flex items-center justify-center',
          selected ? 'bg-primary/15' : 'bg-muted',
        )}
      >
        <Icon className={cn('h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground mt-0.5">{description}</div>
        {footnote ? (
          <div className="text-[11px] text-muted-foreground italic mt-1">{footnote}</div>
        ) : null}
      </div>
    </button>
  );
}
