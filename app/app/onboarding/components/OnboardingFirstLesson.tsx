'use client';

import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { LearnViewOnboarding } from '@/components/app/learning/LearnView';
import { ReviewModeSwitcher } from '@/components/app/learning/ReviewModeSwitcher';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { useOnboardingLessonTutorial } from './useOnboardingLessonTutorial';
import { ONBOARDING_FIRST_LESSON_CARDS } from '@/lib/constants/onboarding';
import type { TranslateFn } from '@/lib/tutorials/types';
import type { ReviewMode } from '@/convex/types';
import type { ReviewRating } from '@/lib/scheduling';

/**
 * Onboarding first lesson — renders the real `LearnView` inline with
 * `mode='onboarding'`. The real `LearningMode` (FSRS, audio, chat,
 * word-tap) runs untouched; the in-app driver.js tutorial is suppressed
 * and our own onboarding-specific driver.js tutorial fires once on mount
 * via `useOnboardingLessonTutorial`.
 *
 * Driver.js (rather than the previous custom Coachmark) handles overlay
 * dimming including the header, highlight resolution across mobile +
 * desktop, and keyboard nav consistently.
 */

export interface OnboardingSessionSummary {
  cardsRated: number;
  sessionId: string;
  dailyReviewsToday: number;
  dailyTimeMsToday: number;
  dailyNewWordsToday: number;
}

interface Props {
  cardsThreshold?: number;
  /** Cards rated before this mount (e.g. from a persisted reload). */
  initialCardsRated?: number;
  /** Persisted session id from a previous mount. When set, `useLearningMode`
   *  adopts it instead of minting fresh so the new-words hero accumulates
   *  reviews from before AND after the reload into one bucket. */
  initialSessionId?: string;
  /** Fires after every card rated, with the new running count. */
  onCardsRatedChange?: (n: number) => void;
  /** Fires once when we learn the session id (i.e. on the first rated card).
   *  Wizard persists it via `onboardingProgress.firstLessonSessionId` so the
   *  next mount can pass it back as `initialSessionId`. */
  onSessionIdDiscovered?: (sessionId: string) => void;
  /** Fires on EVERY card rated with the latest session snapshot, not just
   *  on lesson-complete. Lets the wizard persist `firstLessonSummary`
   *  continuously so an abort+restart+skip path doesn't wipe the stats
   *  the user already earned. The lesson-complete callback is the
   *  authoritative "we're done" signal that also advances the wizard. */
  onSnapshotUpdate?: (snapshot: OnboardingSessionSummary) => void;
  onLessonComplete: (summary: OnboardingSessionSummary) => void;
  onAbort: () => void;
}

export function OnboardingFirstLesson({
  cardsThreshold = ONBOARDING_FIRST_LESSON_CARDS,
  initialCardsRated = 0,
  initialSessionId,
  onCardsRatedChange,
  onSessionIdDiscovered,
  onSnapshotUpdate,
  onLessonComplete,
  onAbort,
}: Props) {
  const [cardsRated, setCardsRated] = useState(initialCardsRated);
  // Block autoplay until the core walkthrough is dismissed (closed, finished,
  // or skipped). Resume on subsequent cards by leaving this true once flipped.
  // If the user is resuming a lesson they've already rated cards in (abort →
  // restart, or page reload mid-lesson), they've already dismissed the core
  // walkthrough — start "done" so the audio play-blocker doesn't permanently
  // gate audio on the resumed mount.
  const [coreTutorialDone, setCoreTutorialDone] = useState(initialCardsRated > 0);
  // True while ANY staged tutorial driver is currently mounted. Used in
  // tandem with `coreTutorialDone` to also gate autoplay during card-actions
  // and word-tap stages on cards 2 and 4.
  const [tutorialActive, setTutorialActive] = useState(false);
  const t = useTranslations('OnboardingTutorial') as unknown as TranslateFn;

  // Sync the lesson tutorial's review-mode-specific step list with the
  // user's pick (made on the first-lesson intro) so they see the right copy.
  const courseSettings = useQuery(api.features.courses.getActiveCourseSettings, {});
  const reviewMode: ReviewMode = courseSettings?.reviewMode ?? 'audio';
  const transcribe =
    reviewMode === 'full' &&
    (courseSettings?.writingInputMode ?? 'translate') === 'transcribe';

  // Pause audio whenever a tutorial step appears so the spoken card audio
  // doesn't compete with the popover.
  const pauseAllAudio = useCallback(() => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
      if (!el.paused) el.pause();
    });
  }, []);

  // While ANY onboarding tutorial is on screen (core stage not yet
  // dismissed OR a staged popover is up), block every `<audio>` /
  // `<video>` element from playing.
  //
  // Two cooperating effects:
  //   1. An ALWAYS-ON document capture-phase `play` listener mounted on
  //      component mount. Its handler reads `blockingAudioRef.current` and
  //      pauses the offending element when the gate is up. Mounting it
  //      unconditionally closes the React effect-ordering race: child
  //      effects (useLearningAudio's merge) run before parent effects in
  //      the same commit, so if the listener were installed by an effect
  //      with a `blockingAudio` dep, an audio.play() fired from a child
  //      effect during the same commit could escape before the listener
  //      is in place.
  //   2. A state-change effect that pauses everything when the gate flips
  //      true and resumes (audio-mode only) when it flips back — same as
  //      before, just decoupled from the listener install/teardown.
  //
  // The audio player itself (`hooks/use-audio-player.ts`) also reads the
  // latest `autoPlay` value from a ref before each `.play()` call, so this
  // listener is defense-in-depth, not the primary gate.
  const blockingAudio = !coreTutorialDone || tutorialActive;
  const blockingAudioRef = useRef(blockingAudio);
  blockingAudioRef.current = blockingAudio;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = (e: Event) => {
      if (!blockingAudioRef.current) return;
      const target = e.target as HTMLMediaElement | null;
      if (target && typeof target.pause === 'function') {
        target.pause();
      }
    };
    document.addEventListener('play', handler, true);
    return () => {
      document.removeEventListener('play', handler, true);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (blockingAudio) {
      document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
        if (!el.paused) el.pause();
      });
      return;
    }
    // Gate just released — resume audio only in audio mode (full mode
    // never had autoplay to begin with). `requestAnimationFrame` lets
    // the commit + any audio-element reset settle before we hit play.
    if (reviewMode === 'audio') {
      const raf = requestAnimationFrame(() => {
        document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
          if (el.paused) el.play().catch(() => {});
        });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [blockingAudio, reviewMode]);

  // Imperative "kick playback" registered by LearnView (its merged card
  // audio is a detached `new Audio()` element the DOM sweeps above can't
  // reach). Called synchronously inside the popover-dismiss click so the
  // `.play()` keeps the user gesture — iOS refuses gesture-less playback
  // on an element that has never played.
  const resumeLessonAudioRef = useRef<(() => void) | null>(null);
  const registerResumeAudio = useCallback((fn: () => void) => {
    resumeLessonAudioRef.current = fn;
  }, []);

  useOnboardingLessonTutorial({
    t,
    reviewMode,
    transcribe,
    cardsRated,
    onStepShow: pauseAllAudio,
    onCoreComplete: () => setCoreTutorialDone(true),
    onActiveChange: (active) => {
      setTutorialActive(active);
    },
    onUserDismiss: () => resumeLessonAudioRef.current?.(),
  });

  const handleCardRated = useCallback(
    (
      _rating: ReviewRating | undefined,
      snapshot: {
        sessionId: string;
        dailyReviewsToday: number;
        dailyTimeMsToday: number;
        dailyNewWordsToday: number;
      },
    ) => {
      setCardsRated((n) => {
        const next = n + 1;
        // Defer parent-state updates until after React commits this one —
        // calling `onCardsRatedChange` (which patches the wizard's state)
        // synchronously inside a setState updater triggers React's
        // "update a component while rendering a different one" warning.
        queueMicrotask(() => {
          onCardsRatedChange?.(next);
          // Publish the session id on the very first rating so the wizard
          // can persist it. Subsequent ratings hit the same id (useLearningMode
          // doesn't rotate within a session) — onSessionIdDiscovered is
          // idempotent on the wizard side.
          onSessionIdDiscovered?.(snapshot.sessionId);
          // Persist a fresh summary on EVERY rating, not just at threshold.
          // Survives abort: if the user aborts after rating 3 cards then
          // restarts and skips, the post-lesson screens still see the
          // last-known good snapshot (3-card totals) instead of getting
          // wiped to null by the skip path.
          const liveSnapshot: OnboardingSessionSummary = {
            cardsRated: next,
            ...snapshot,
          };
          onSnapshotUpdate?.(liveSnapshot);
          if (next >= cardsThreshold) {
            onLessonComplete(liveSnapshot);
          }
        });
        return next;
      });
    },
    [
      cardsThreshold,
      onCardsRatedChange,
      onSessionIdDiscovered,
      onSnapshotUpdate,
      onLessonComplete,
    ],
  );

  // Mirror of handleCardRated for the undo button: keep the wizard's
  // lesson-progress counter in sync when a rating is taken back. Never fires
  // `onLessonComplete` — undo only ever moves the count away from the
  // threshold. The staged coachmarks are unaffected: `firedStagesRef` in
  // useOnboardingLessonTutorial claims each stage once, so dropping back
  // below a stage's card count can't re-trigger it.
  const handleCardUndone = useCallback(
    (snapshot: {
      sessionId: string;
      dailyReviewsToday: number;
      dailyTimeMsToday: number;
      dailyNewWordsToday: number;
    }) => {
      setCardsRated((n) => {
        const next = Math.max(0, n - 1);
        queueMicrotask(() => {
          onCardsRatedChange?.(next);
          onSnapshotUpdate?.({ cardsRated: next, ...snapshot });
        });
        return next;
      });
    },
    [onCardsRatedChange, onSnapshotUpdate],
  );

  const tLesson = useTranslations('Onboarding.firstLesson');
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <FirstLessonErrorBoundary
        onSkip={onAbort}
        message={tLesson('errorBoundary.message')}
        skipLabel={tLesson('errorBoundary.skip')}
      >
        <LearnViewOnboarding
          onboardingHeader={<OnboardingHeader onAbort={onAbort} />}
          onBack={onAbort}
          onCardRated={handleCardRated}
          onCardUndone={handleCardUndone}
          forceDisableAutoPlay={!coreTutorialDone || tutorialActive}
          registerResumeAudio={registerResumeAudio}
          initialSessionId={initialSessionId}
          initialSessionCardCount={initialCardsRated}
        />
      </FirstLessonErrorBoundary>
    </div>
  );
}

interface FirstLessonErrorBoundaryProps {
  onSkip: () => void;
  message: string;
  skipLabel: string;
  children: ReactNode;
}

class FirstLessonErrorBoundary extends Component<
  FirstLessonErrorBoundaryProps,
  { hasError: boolean }
> {
  constructor(props: FirstLessonErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('OnboardingFirstLesson error boundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col h-full items-center justify-center text-center px-4 gap-4">
          <p className="text-muted-foreground max-w-sm">{this.props.message}</p>
          <Button onClick={this.props.onSkip}>{this.props.skipLabel}</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Header — minimal onboarding chrome ─────────────────────────────────────

function OnboardingHeader({ onAbort }: { onAbort: () => void }) {
  const t = useTranslations('Onboarding.firstLesson');
  const activeCourse = useQuery(api.features.courses.getActiveCourse, {});
  const courseSettings = useQuery(api.features.courses.getActiveCourseSettings, {});
  const updateCourseSettings = useMutation(api.features.courses.updateCourseSettings);

  const currentMode: ReviewMode = courseSettings?.reviewMode ?? 'audio';
  const handleChange = (mode: ReviewMode) => {
    if (!activeCourse?._id) return;
    updateCourseSettings({ courseId: activeCourse._id, reviewMode: mode }).catch((err) =>
      console.error('Failed to update review mode during onboarding:', err),
    );
  };

  return (
    <header className="sticky-header">
      <div className="container mx-auto px-4 h-14 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onAbort}
          className="gap-1 -ml-2"
          aria-label={t('abortAria')}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{t('abort')}</span>
        </Button>
        <div className="flex-1" />
        <div
          className="w-56 sm:w-72"
          data-coachmark-anchor="mode-switcher"
          data-tutorial="mode-switcher"
        >
          <ReviewModeSwitcher value={currentMode} onChange={handleChange} />
        </div>
      </div>
    </header>
  );
}
