'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Authenticated,
  AuthLoading,
  useMutation,
  usePreloadedQuery,
  useQuery,
  useAction,
  useConvexAuth,
} from 'convex/react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConvexError } from 'convex/values';
import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';
import { reportError } from '@/lib/report-error';
import { useAppData } from '@/components/app/AppDataProvider';
import { convexErrorCode } from '@/lib/utils';
import { shouldAdvanceOnEnter } from './lib/enterToAdvance';

/**
 * One sink for the wizard's swallow points: console + error tracking (the
 * exception) plus the `onboarding_failed` funnel event (the count). Every
 * catch in this flow deliberately lets the user continue, so without this
 * pairing a failure would be visible in neither the funnel nor the feed.
 */
function reportOnboardingFailure(
  err: unknown,
  {
    op,
    ...eventProps
  }: { op: string; step: string; reason: string } & Record<string, unknown>,
): void {
  reportError(err, { op });
  capture(CLIENT_EVENTS.ONBOARDING_FAILED, eventProps);
}

import type {
  OnboardingData,
  CurrentLevel,
  ReviewMode,
  WritingInputMode,
  AcquisitionSource,
  LearningReason,
  DailyTimeGoalMinutes,
  PlacementTestState,
} from './types';
import { EMPTY_ONBOARDING_DATA } from './types';
import {
  ogteToCurrentLevel,
  CURRENT_PLACEMENT_STRATEGY_VERSION,
  type StrategyName,
} from './lib/placementStrategies';

import { LanguagePairStep } from './steps/LanguagePairStep';
import { AcquisitionSourceStep } from './steps/AcquisitionSourceStep';
import { LearningGoalStep } from './steps/LearningGoalStep';
import { DailyTimeGoalStep } from './steps/DailyTimeGoalStep';
import { ProficiencyBranchStep } from './steps/ProficiencyBranchStep';
import { CefrSelfPickStep } from './steps/CefrSelfPickStep';
import { PlacementTestStep } from './steps/PlacementTestStep';
import { ReviewModeStep, type ReviewModeChoice } from './steps/ReviewModeStep';

/**
 * Onboarding wizard. Survey + placement only; learning starts for real the
 * moment it ends.
 *
 * Step / id / next:
 *   1.  language-pair         → acquisition
 *   2.  acquisition           → goal
 *   3.  goal                  → daily-time
 *   4.  daily-time            → proficiency
 *   5.  proficiency           → cefr-pick | placement-test | review-mode (depends on branch)
 *   6a. cefr-pick             → review-mode
 *   6b. placement-test        → review-mode
 *   7.  review-mode           → done: Continue runs `completeOnboarding`
 *                               (course + deck + seeded cards) then
 *                               `finalizeOnboarding`, and lands the user in
 *                               the REAL learning mode at /app/learn: no
 *                               filler screen, no embedded tutorial lesson
 *                               (the in-session milestone tips took that
 *                               job, see lib/tutorials/use-milestone-tips.ts),
 *                               no plan-pick step.
 *
 * `hasCompletedOnboarding` is the single source of truth for the auto-redirect
 * It stays false until `finalizeOnboarding`, so mid-flow reloads resume
 * from `onboardingProgress.step`.
 */

type StepId =
  | 'language-pair'
  | 'acquisition'
  | 'goal'
  | 'daily-time'
  | 'proficiency'
  | 'cefr-pick'
  | 'placement-test'
  | 'review-mode';

const PROGRESS_STEP_ORDER: StepId[] = [
  'language-pair',
  'acquisition',
  'goal',
  'daily-time',
  'proficiency',
  'cefr-pick', // collapsed with placement-test for progress purposes
  'review-mode',
];

/**
 * First step of the retired 12-step flow that sits AFTER the embedded first
 * lesson: 7 customizing, 8 first-lesson, 9 stats-recap, 10 word-projection,
 * 11 feature-tour, 12 plan-pick. A row at 9+ means the user finished or
 * skipped that lesson. Everything the wizard still asks for is already
 * answered, and everything past it (stats recap, word projection, feature
 * tour, plan pick) no longer exists. Those users are graduated straight out
 * to the dashboard instead of being walked back through the wizard; see
 * `useLegacyGraduation`.
 */
const LEGACY_STEP_AFTER_FIRST_LESSON = 9;

/** Map a persisted 1-based step number onto the current wizard order. */
function resumeStepId(savedStep: number): StepId {
  // Steps 1-6 line up with the previous wizard order. 7 (customizing) and 8
  // (mid-first-lesson) are old-flow rows whose users already answered the
  // survey but never settled a review mode, so resume them at the final mode
  // pick. `completeOnboarding` is idempotent, so users whose course already
  // exists (old flow got past customizing) just re-confirm the mode and
  // finish. Rows at 9+ never reach here. They graduate out first.
  if (savedStep > PROGRESS_STEP_ORDER.length) return 'review-mode';
  return PROGRESS_STEP_ORDER[savedStep - 1] ?? 'language-pair';
}

export default function OnboardingPage() {
  return (
    <>
      <AuthLoading>
        <div className="h-dvh" />
      </AuthLoading>
      <Authenticated>
        <OnboardingContent />
      </Authenticated>
    </>
  );
}

function OnboardingContent() {
  const router = useRouter();
  // Through AppDataProvider's SSR-seeded handle (B25; the onboarding page
  // renders inside app/app/layout.tsx's provider). Same getUserSettings
  // query key, so the finalize optimistic update below still reaches it.
  const { preloadedSettings } = useAppData();
  const userSettings = usePreloadedQuery(preloadedSettings);
  const onboardingProgress = useQuery(api.features.courses.getOnboardingProgress);
  const saveProgress = useMutation(api.features.courses.saveOnboardingProgress);
  const completeOnboarding = useMutation(api.features.courses.completeOnboarding);
  // `withOptimisticUpdate` flips `hasCompletedOnboarding` to `true` in the
  // local Convex cache the moment the wizard finishes, before the server
  // roundtrip and before `router.push('/app/learn')`. Without it, the
  // `OnboardingGuard` on `/app/*` would briefly see the still-`false`
  // preloaded value (Next.js doesn't re-execute server preloads on soft
  // navigation within the same `/app/*` segment) and bounce the user back
  // to `/app/onboarding` until the live subscription delivered the true
  // value. A visible flicker. The optimistic update makes the
  // post-finalize value visible synchronously to every consumer of
  // `getUserSettings`, including the layout-preloaded query.
  const finalizeOnboarding = useMutation(
    api.features.onboarding.finalizeOnboarding,
  ).withOptimisticUpdate((localStore) => {
    const current = localStore.getQuery(
      api.features.courses.getUserSettings,
      {},
    );
    if (current) {
      localStore.setQuery(
        api.features.courses.getUserSettings,
        {},
        { ...current, hasCompletedOnboarding: true },
      );
    }
  });
  const prepareLanguagePair = useMutation(api.features.onboarding.prepareLanguagePair);
  const syncQuotas = useAction(api.usage.actions.syncQuotas);
  const { isAuthenticated } = useConvexAuth();
  const syncedRef = useRef(false);
  // True while the wizard's own finish flow is driving navigation. It
  // targets /app/learn, and the generic already-onboarded bounce below must
  // not race it with a competing push to /app.
  const finishingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || syncedRef.current) return;
    syncedRef.current = true;
    syncQuotas().catch((err) => {
      // Non-fatal, but it decides whether `completeOnboarding` can consume a
      // COURSES unit later. A failure here surfaces as an unexplained
      // USAGE_LIMIT at the final step, so it needs to be visible.
      reportOnboardingFailure(err, {
        op: 'onboarding.syncQuotas',
        step: 'mount',
        reason: 'sync_quotas_failed',
      });
    });
  }, [syncQuotas, isAuthenticated]);

  // Once `hasCompletedOnboarding` is true (set only by `finalizeOnboarding`,
  // the very last step of the wizard), bounce the user out. This is the
  // single source of truth, no session/local-storage gating.
  useEffect(() => {
    if (userSettings?.hasCompletedOnboarding && !finishingRef.current) {
      router.push('/app');
    }
  }, [userSettings, router]);

  // Graduate old-flow rows that are already past the embedded first lesson.
  // Those users have a course, a review mode, and a completed (or skipped)
  // first session; the only steps they hadn't finished are ones that no
  // longer exist. Walking them back into the wizard to re-pick a mode they
  // already chose is worse than just letting them in, so finalize and let
  // the effect above bounce them to the dashboard, where the home tour plays
  // once and Start Learning takes them into the session.
  //
  // `finalizeOnboarding` is idempotent (`alreadyFinalized`) and its
  // optimistic update flips `hasCompletedOnboarding` synchronously, which is
  // what drives that bounce. The ref keeps a re-render from firing it twice
  // before the mutation lands.
  const isLegacyGraduate =
    !!userSettings?.activeCourseId &&
    !userSettings.hasCompletedOnboarding &&
    (onboardingProgress?.step ?? 0) >= LEGACY_STEP_AFTER_FIRST_LESSON;
  // Set only when finalize fails. The user then falls back to the wizard
  // (resumed at the mode pick) instead of being stranded on a blank screen.
  const [graduationFailed, setGraduationFailed] = useState(false);
  const graduatedRef = useRef(false);
  useEffect(() => {
    if (!isLegacyGraduate || graduatedRef.current) return;
    graduatedRef.current = true;
    finalizeOnboarding().catch((err) => {
      setGraduationFailed(true);
      reportOnboardingFailure(err, {
        op: 'onboarding.finalizeOnboarding',
        step: 'legacy-graduation',
        reason: 'finalize_onboarding_failed',
        will_bounce_back: true,
      });
    });
  }, [isLegacyGraduate, finalizeOnboarding]);

  if (
    userSettings === undefined ||
    onboardingProgress === undefined
  ) {
    return <div className="h-dvh" />;
  }

  if (userSettings?.hasCompletedOnboarding) {
    return <div className="h-dvh" />;
  }

  // Graduating (see the effect above), hold a blank screen rather than
  // flashing the mode-pick step for the frame or two before the redirect.
  if (isLegacyGraduate && !graduationFailed) {
    return <div className="h-dvh" />;
  }

  // Rehydrate wizard state + resume step from `onboardingProgress`. Mid-flow
  // refreshes return to the same step the user left off on.
  const initialStepId: StepId =
    onboardingProgress?.step
      ? resumeStepId(onboardingProgress.step)
      : 'language-pair';
  const initialFlowData: OnboardingData = {
    ...EMPTY_ONBOARDING_DATA,
    ...(onboardingProgress
      ? {
        reviewMode: (onboardingProgress.reviewMode as ReviewMode) ?? null,
        writingInputMode:
            (onboardingProgress.writingInputMode as WritingInputMode) ?? null,
        targetLanguages: onboardingProgress.targetLanguages ?? [],
        baseLanguages: onboardingProgress.baseLanguages ?? [],
        currentLevel: (onboardingProgress.currentLevel as CurrentLevel) ?? null,
        acquisitionSource: (onboardingProgress.acquisitionSource as AcquisitionSource) ?? null,
        acquisitionSourceFreeText: onboardingProgress.acquisitionSourceFreeText ?? null,
        learningGoals: (onboardingProgress.learningGoals as LearningReason[] | undefined) ?? [],
        learningGoalFreeText: onboardingProgress.learningGoalFreeText ?? null,
        dailyTimeGoalMinutes:
            (onboardingProgress.dailyTimeGoalMinutes as DailyTimeGoalMinutes) ?? null,
        placementTest: onboardingProgress.placementTest &&
            onboardingProgress.placementTest.strategyVersion === CURRENT_PLACEMENT_STRATEGY_VERSION
          ? {
            strategyVersion: onboardingProgress.placementTest.strategyVersion,
            strategy: onboardingProgress.placementTest.strategy,
            history: onboardingProgress.placementTest.history,
            finalLevel: onboardingProgress.placementTest.finalLevel,
          }
          : null,
      }
      : {}),
  };

  return (
    <OnboardingWizard
      initial={initialFlowData}
      initialStepId={initialStepId}
      saveProgress={saveProgress}
      completeOnboarding={completeOnboarding}
      finalizeOnboarding={finalizeOnboarding}
      prepareLanguagePair={prepareLanguagePair}
      finishingRef={finishingRef}
      router={router}
    />
  );
}

interface SaveProgressArgs {
  step: number;
  reviewMode?: ReviewMode;
  /** `null` explicitly clears the stored style (Shadowing has no writing
   *  input). Must NOT be collapsed to `undefined`. The Convex client strips
   *  undefined args, which would leave a previous 'transcribe' in place. */
  writingInputMode?: WritingInputMode | null;
  targetLanguages?: string[];
  baseLanguages?: string[];
  currentLevel?: CurrentLevel;
  acquisitionSource?: string;
  acquisitionSourceFreeText?: string;
  learningGoals?: string[];
  learningGoalFreeText?: string;
  dailyTimeGoalMinutes?: number;
  placementTest?: Omit<PlacementTestState, 'strategyVersion'> & {
    strategyVersion?: number;
  };
}

/**
 * Single source of truth for the `saveOnboardingProgress` payload shape.
 * Used by all three call sites in the wizard (debounced field-change
 * `persist`, immediate `advance`, immediate `back`) so a new field landing
 * on `OnboardingData` only needs threading through here.
 */
export function buildProgressPayload(
  fd: OnboardingData,
  step: number,
): SaveProgressArgs {
  return {
    step,
    reviewMode: fd.reviewMode ?? undefined,
    // Passed through as-is, including `null`. See SaveProgressArgs.
    writingInputMode: fd.writingInputMode,
    targetLanguages: fd.targetLanguages.length > 0 ? fd.targetLanguages : undefined,
    baseLanguages: fd.baseLanguages.length > 0 ? fd.baseLanguages : undefined,
    currentLevel: fd.currentLevel ?? undefined,
    acquisitionSource: fd.acquisitionSource ?? undefined,
    acquisitionSourceFreeText: fd.acquisitionSourceFreeText ?? undefined,
    learningGoals: fd.learningGoals.length > 0 ? fd.learningGoals : undefined,
    learningGoalFreeText: fd.learningGoalFreeText ?? undefined,
    dailyTimeGoalMinutes: fd.dailyTimeGoalMinutes ?? undefined,
    placementTest: fd.placementTest ?? undefined,
  };
}

interface WizardProps {
  initial: OnboardingData;
  initialStepId: StepId;
  saveProgress: (args: SaveProgressArgs) => Promise<unknown>;
  completeOnboarding: () => Promise<unknown>;
  finalizeOnboarding: () => Promise<unknown>;
  prepareLanguagePair: (args: {
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<unknown>;
  finishingRef: React.MutableRefObject<boolean>;
  router: ReturnType<typeof useRouter>;
}

function OnboardingWizard({
  initial,
  initialStepId,
  saveProgress,
  completeOnboarding,
  finalizeOnboarding,
  prepareLanguagePair,
  finishingRef,
  router,
}: WizardProps) {
  const t = useTranslations('Onboarding.wizard');
  const [data, setData] = useState<OnboardingData>(initial);
  const [stepId, setStepId] = useState<StepId>(initialStepId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<StepId[]>([]);
  // Live OGTE level the user has dialled in on the CEFR slider, kept in
  // wizard state so the Continue button can read it.
  const [cefrSlidLevel, setCefrSlidLevel] = useState<number>(8);
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    dataRef.current = data;
  });
  // Mirror `stepId` into a ref so the debounced `persist` reads the latest
  // value at fire time instead of capturing it in a closure. Without this,
  // a sequence like (1) field change on step N → schedules debounce, (2)
  // user clicks Continue → step jumps to N+1 + immediate save, (3) stale
  // debounce fires 250ms later with the captured step=N and overwrites the
  // newer step=N+1 row, so a reload resumes one step behind.
  const stepIdRef = useRef(stepId);
  useLayoutEffect(() => {
    stepIdRef.current = stepId;
  });

  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(
    (partial: Partial<OnboardingData>) => {
      // Merge into the ref synchronously, not just via the layout effect:
      // `advance`/`back` fire an immediate save from `dataRef.current` in
      // the same tick as a preceding `persist(...)` (e.g. the level
      // handlers do `persist({ currentLevel }); advance(...)`), and the
      // layout-effect refresh only lands after the next commit. Without
      // this eager merge that save writes the pre-persist data, dropping
      // the just-selected field, while also cancelling the debounce that
      // carried it, so the value never reaches the server.
      dataRef.current = { ...dataRef.current, ...partial };
      setData((d) => ({ ...d, ...partial }));
      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
      persistDebounceRef.current = setTimeout(() => {
        const fd = dataRef.current;
        const stepNum = PROGRESS_STEP_ORDER.indexOf(stepIdRef.current) + 1;
        saveProgress(buildProgressPayload(fd, Math.max(1, stepNum)))
          .catch((err) => reportError(err, { op: 'saveOnboardingProgress' }));
      }, 250);
    },
    [saveProgress],
  );

  // Persist the new step *immediately* (no debounce). Without this, a user
  // who clicks Continue without changing any field never triggers `persist`,
  // so the saved step stays behind and a reload resumes at the wrong place.
  // Cancel any pending field-change debounce so its (now stale) save can't
  // arrive after this immediate one and roll the step back.
  const saveStepNow = useCallback((step: StepId, label: string) => {
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current);
      persistDebounceRef.current = null;
    }
    const stepNum = PROGRESS_STEP_ORDER.indexOf(step) + 1;
    if (stepNum > 0) {
      saveProgress(buildProgressPayload(dataRef.current, stepNum))
        .catch((err) => reportError(err, { op: 'saveOnboardingProgress', step: label }));
    }
  }, [saveProgress]);

  const advance = useCallback((to: StepId) => {
    setHistory((h) => [...h, stepId]);
    setStepId(to);
    saveStepNow(to, 'advance');
  }, [stepId, saveStepNow]);

  /**
   * Funnel instrumentation. One event per step entry, carrying how long the
   * previous step took, which is enough to build both the drop-off funnel and
   * the per-step timing chart from a single event type.
   *
   * Driven off `stepId` rather than wired into `advance`/`back` so it cannot be
   * bypassed: the flow also lands on steps via resume-from-`onboardingProgress`
   * and via the branch jumps out of `proficiency`.
   */
  const stepEnteredAtRef = useRef<number>(Date.now());
  const previousStepRef = useRef<StepId | null>(null);
  useEffect(() => {
    const now = Date.now();
    const previousStep = previousStepRef.current;
    capture(CLIENT_EVENTS.ONBOARDING_STEP_VIEWED, {
      step: stepId,
      step_index: PROGRESS_STEP_ORDER.indexOf(stepId) + 1,
      previous_step: previousStep ?? undefined,
      previous_step_duration_ms:
        previousStep === null ? undefined : now - stepEnteredAtRef.current,
    });
    previousStepRef.current = stepId;
    stepEnteredAtRef.current = now;
  }, [stepId]);

  const back = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) {
        setStepId(prev);
        saveStepNow(prev, 'back');
      }
      return h.slice(0, -1);
    });
  }, [saveStepNow]);

  // Progress bar percentage
  const progressIndex = useMemo(() => {
    const idx = PROGRESS_STEP_ORDER.indexOf(
      stepId === 'placement-test' ? 'cefr-pick' : stepId,
    );
    return Math.max(0, idx);
  }, [stepId]);
  const totalSteps = PROGRESS_STEP_ORDER.length;
  const progressPct = Math.min(100, ((progressIndex + 1) / totalSteps) * 100);

  // ─── Per-step rendering & controls ─────────────────────────────────────

  const isLanguagePairValid =
    data.baseLanguages[0] && data.targetLanguages[0] &&
    data.baseLanguages[0] !== data.targetLanguages[0];

  const onLanguagePairContinue = async () => {
    const source = data.baseLanguages[0];
    const target = data.targetLanguages[0];
    if (!source || !target) return;
    try {
      await prepareLanguagePair({ sourceLanguage: source, targetLanguage: target });
    } catch (err) {
      // Non-fatal. Content warmup is best-effort, and we advance regardless.
      // But "advanced anyway" is exactly the state that later shows up as a
      // placement test with no content, so record why.
      reportOnboardingFailure(err, {
        op: 'onboarding.prepareLanguagePair',
        step: 'language-pair',
        reason: 'prepare_language_pair_failed',
        advanced_anyway: true,
      });
    }
    advance('acquisition');
  };

  const onProficiencyContinue = () => {
    if (data.proficiencyBranch === 'new') {
      persist({ currentLevel: 'beginner' });
      advance('review-mode');
    } else if (data.proficiencyBranch === 'self-pick') {
      advance('cefr-pick');
    } else if (data.proficiencyBranch === 'test') {
      advance('placement-test');
    }
  };

  // Continue on cefr-pick starts the course at the picked level directly,
  // no confirmation dialog. Users who want the adaptive test instead reach it
  // via the proficiency step's "take a test" branch.
  const onCefrPickContinue = useCallback(() => {
    persist({
      currentLevel: ogteToCurrentLevel(cefrSlidLevel),
      placementTest: {
        strategyVersion: CURRENT_PLACEMENT_STRATEGY_VERSION,
        strategy: 'self-pick',
        history: [],
        finalLevel: cefrSlidLevel,
      },
    });
    advance('review-mode');
  }, [cefrSlidLevel, persist, advance]);

  const onPlacementComplete = (result: {
    strategy: StrategyName;
    history: { level: number; knew: boolean }[];
    finalOgteLevel: number;
    currentLevel: CurrentLevel;
  }) => {
    persist({
      currentLevel: result.currentLevel,
      placementTest: {
        strategyVersion: CURRENT_PLACEMENT_STRATEGY_VERSION,
        strategy: result.strategy,
        history: result.history,
        finalLevel: result.finalOgteLevel,
      },
    });
    advance('review-mode');
  };

  /**
   * The wizard's finish: create the course (deck + seeded cards, quota
   * consumed) with the chosen review mode, flag onboarding done, and land
   * the user in the REAL learning mode. `completeOnboarding` failing keeps
   * the user on this step with a toast, advancing without a course would
   * drop them into an empty learn view. `finalizeOnboarding` failing still
   * navigates (matching the old behaviour): OnboardingGuard bounces back
   * here, which the funnel event makes traceable.
   */
  const onFinishOnboarding = useCallback(async () => {
    setIsSubmitting(true);
    // Flush the mode pick before the course is created from the progress row
    // The debounced persist may not have fired yet.
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current);
      persistDebounceRef.current = null;
    }
    try {
      await saveProgress(
        buildProgressPayload(
          dataRef.current,
          PROGRESS_STEP_ORDER.indexOf('review-mode') + 1,
        ),
      );
      await completeOnboarding();
    } catch (err) {
      reportOnboardingFailure(err, {
        op: 'onboarding.completeOnboarding',
        step: 'review-mode',
        reason: 'complete_onboarding_failed',
        code: err instanceof ConvexError ? convexErrorCode(err) : undefined,
      });
      toast.error(t('errors.completeFailed'));
      setIsSubmitting(false);
      return;
    }
    finishingRef.current = true;
    try {
      await finalizeOnboarding();
    } catch (err) {
      reportOnboardingFailure(err, {
        op: 'onboarding.finalizeOnboarding',
        step: 'review-mode',
        reason: 'finalize_onboarding_failed',
        will_bounce_back: true,
      });
    }
    router.push('/app/learn');
  }, [saveProgress, completeOnboarding, finalizeOnboarding, finishingRef, router, t]);

  // Continue-button enable state per step.
  const continueDisabled = (): boolean => {
    switch (stepId) {
    case 'language-pair':
      return !isLanguagePairValid;
    case 'acquisition':
      return data.acquisitionSource === null;
    case 'goal':
      return data.learningGoals.length === 0;
    case 'daily-time':
      return data.dailyTimeGoalMinutes === null;
    case 'proficiency':
      return data.proficiencyBranch === null;
    case 'cefr-pick':
      return false; // slider has a value at all times; button is always enabled
    case 'review-mode':
      return data.reviewMode === null;
    default:
      return false;
    }
  };

  const onContinue = async () => {
    switch (stepId) {
    case 'language-pair':
      await onLanguagePairContinue();
      return;
    case 'acquisition':
      advance('goal');
      return;
    case 'goal':
      advance('daily-time');
      return;
    case 'daily-time':
      advance('proficiency');
      return;
    case 'proficiency':
      onProficiencyContinue();
      return;
    case 'cefr-pick':
      onCefrPickContinue();
      return;
    case 'review-mode':
      await onFinishOnboarding();
      return;
    default:
      return;
    }
  };

  const stepHasOwnAdvance = stepId === 'placement-test';

  // Enter advances the wizard, so a keyboard user can answer the whole flow
  // without reaching for the mouse. Only on steps that render the shared
  // Continue button. The rest own their advance and their own CTAs.
  const onContinueRef = useRef(onContinue);
  useLayoutEffect(() => {
    onContinueRef.current = onContinue;
  });
  const continueBlocked = continueDisabled() || isSubmitting;
  useEffect(() => {
    if (stepHasOwnAdvance || continueBlocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!shouldAdvanceOnEnter(e)) return;
      e.preventDefault();
      void onContinueRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepHasOwnAdvance, continueBlocked]);

  const stepNode = renderStep({
    stepId,
    data,
    persist,
    onPlacementComplete,
    setCefrSlidLevel,
  });

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden">
      <div className="bg-background border-b shrink-0 pt-[var(--safe-top)]">
        <div className="container mx-auto px-4 py-3">
          <Progress value={progressPct} className="h-1.5" />
        </div>
      </div>

      <main className="flex-1 overflow-hidden">
        <div className="container mx-auto px-4 max-w-4xl h-full flex flex-col overflow-hidden">
          {stepNode}
        </div>
      </main>

      {!stepHasOwnAdvance ? (
        <div className="border-t bg-background shrink-0 pb-[var(--safe-bottom)]">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              {history.length > 0 ? (
                <Button
                  variant="ghost"
                  onClick={back}
                  disabled={isSubmitting}
                  className="gap-2"
                  data-testid="onboarding-back"
                >
                  <ChevronLeft className="h-4 w-4" /> {t('back')}
                </Button>
              ) : (
                <div />
              )}
              <Button
                onClick={onContinue}
                disabled={continueDisabled() || isSubmitting}
                className="min-w-[120px]"
                data-testid="onboarding-continue"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> {t('loading')}
                  </>
                ) : stepId === 'cefr-pick' ? (
                  t('pickThisLevel')
                ) : stepId === 'review-mode' ? (
                  t('startLearning')
                ) : (
                  t('continue')
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Derive the review-mode step's flat 3-way choice from the two persisted
 *  fields (reviewMode + writingInputMode). */
function reviewModeChoice(data: OnboardingData): ReviewModeChoice | null {
  if (data.reviewMode === null) return null;
  if (data.reviewMode === 'audio') return 'audio';
  return data.writingInputMode === 'transcribe' ? 'transcribe' : 'translate';
}

function renderStep({
  stepId,
  data,
  persist,
  onPlacementComplete,
  setCefrSlidLevel,
}: {
  stepId: StepId;
  data: OnboardingData;
  persist: (partial: Partial<OnboardingData>) => void;
  onPlacementComplete: (r: {
    strategy: StrategyName;
    history: { level: number; knew: boolean }[];
    finalOgteLevel: number;
    currentLevel: CurrentLevel;
  }) => void;
  setCefrSlidLevel: (n: number) => void;
}) {
  switch (stepId) {
  case 'language-pair':
    return (
      <LanguagePairStep
        source={data.baseLanguages[0] ?? null}
        target={data.targetLanguages[0] ?? null}
        onSource={(code) => persist({ baseLanguages: code ? [code] : [] })}
        onTarget={(code) => persist({ targetLanguages: code ? [code] : [] })}
      />
    );
  case 'acquisition':
    return (
      <AcquisitionSourceStep
        selected={data.acquisitionSource}
        freeText={data.acquisitionSourceFreeText}
        onSelect={(s) => persist({ acquisitionSource: s })}
        onFreeText={(t) => persist({ acquisitionSourceFreeText: t })}
      />
    );
  case 'goal':
    return (
      <LearningGoalStep
        selected={data.learningGoals}
        freeText={data.learningGoalFreeText}
        onToggle={(g) => {
          const next = data.learningGoals.includes(g)
            ? data.learningGoals.filter((x) => x !== g)
            : [...data.learningGoals, g];
          persist({ learningGoals: next });
        }}
        onFreeText={(t) => persist({ learningGoalFreeText: t })}
      />
    );
  case 'daily-time':
    return (
      <DailyTimeGoalStep
        selected={data.dailyTimeGoalMinutes}
        onSelect={(m) => persist({ dailyTimeGoalMinutes: m })}
      />
    );
  case 'proficiency':
    return (
      <ProficiencyBranchStep
        selected={data.proficiencyBranch}
        onSelect={(b) => persist({ proficiencyBranch: b })}
      />
    );
  case 'cefr-pick':
    return (
      <CefrSelfPickStep
        sourceLanguage={data.baseLanguages[0] ?? 'en'}
        targetLanguage={data.targetLanguages[0] ?? 'es'}
        initialOgteLevel={data.placementTest?.finalLevel ?? 8}
        onLevelChange={setCefrSlidLevel}
      />
    );
  case 'placement-test':
    return (
      <PlacementTestStep
        targetLanguage={data.targetLanguages[0] ?? 'es'}
        sourceLanguage={data.baseLanguages[0] ?? 'en'}
        initialOgteLevel={data.placementTest?.finalLevel}
        onComplete={onPlacementComplete}
      />
    );
  case 'review-mode':
    return (
      <ReviewModeStep
        selected={reviewModeChoice(data)}
        onSelect={(choice) =>
          persist({
            reviewMode: choice === 'audio' ? 'audio' : 'full',
            writingInputMode: choice === 'audio' ? null : choice,
          })
        }
      />
    );
  }
}
