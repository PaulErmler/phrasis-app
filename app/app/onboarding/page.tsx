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
  AcquisitionSource,
  LearningReason,
  DailyTimeGoalMinutes,
  PlacementTestState,
  FirstLessonSummary,
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
import { CustomizingStep } from './steps/CustomizingStep';
import { FirstLessonStep } from './steps/FirstLessonStep';
import { StatsRecapStep } from './steps/StatsRecapStep';
import { WordProjectionStep } from './steps/WordProjectionStep';
import type { OnboardingSessionSummary } from './components/OnboardingFirstLesson';
import { FeatureTourStep } from './steps/FeatureTourStep';
import { PlanPickStep } from './steps/PlanPickStep';
import { useIsNativeApp } from '@/hooks/use-native-app';

/**
 * New onboarding wizard. 13 steps with branching at the proficiency point.
 *
 * Step / id / next:
 *   1.  language-pair         → acquisition
 *   2.  acquisition           → goal
 *   3.  goal                  → daily-time
 *   4.  daily-time            → proficiency
 *   5.  proficiency           → cefr-pick | placement-test | customizing (depends on branch)
 *   6a. cefr-pick             → customizing
 *   6b. placement-test        → customizing
 *   7.  customizing           → first-lesson (calls completeOnboarding on entry)
 *   8.  first-lesson          → stats-recap (or feature-tour on skip)
 *   9.  stats-recap           → word-projection
 *   10. word-projection       → feature-tour
 *   11. feature-tour          → plan-pick
 *   12. plan-pick             → done         (calls finalizeOnboarding)
 *
 * `hasCompletedOnboarding` is the single source of truth for the auto-redirect
 * — it stays false until the very last step (`finalizeOnboarding`), so
 * mid-flow reloads resume from `onboardingProgress.step`.
 */

type StepId =
  | 'language-pair'
  | 'acquisition'
  | 'goal'
  | 'daily-time'
  | 'proficiency'
  | 'cefr-pick'
  | 'placement-test'
  | 'customizing'
  | 'first-lesson'
  | 'stats-recap'
  | 'word-projection'
  | 'feature-tour'
  | 'plan-pick';

const PROGRESS_STEP_ORDER: StepId[] = [
  'language-pair',
  'acquisition',
  'goal',
  'daily-time',
  'proficiency',
  'cefr-pick', // collapsed with placement-test for progress purposes
  'customizing',
  'first-lesson',
  'stats-recap',
  'word-projection',
  'feature-tour',
  'plan-pick',
];

/**
 * Steps that come after `customizing` (course already created). Back is
 * disabled at these steps so the user can't navigate back to level picking
 * and try to change a level the course is already pinned to.
 */
const POST_CUSTOMIZING_STEPS: ReadonlySet<StepId> = new Set<StepId>([
  'first-lesson',
  'stats-recap',
  'word-projection',
  'feature-tour',
  'plan-pick',
]);

/** Map a persisted 1-based step number onto the current wizard order. */
function resumeStepId(savedStep: number): StepId {
  // Testimonials used to sit at index 12; plan-pick was 13. After removal,
  // plan-pick is 12. Anything past the end (stale plan-pick = 13) lands on
  // plan-pick; index 12 now is plan-pick too, so users left on testimonials
  // skip ahead cleanly.
  if (savedStep > PROGRESS_STEP_ORDER.length) return 'plan-pick';
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
  const userSettings = useQuery(api.features.courses.getUserSettings);
  const onboardingProgress = useQuery(api.features.courses.getOnboardingProgress);
  const saveProgress = useMutation(api.features.courses.saveOnboardingProgress);
  const completeOnboarding = useMutation(api.features.courses.completeOnboarding);
  // `withOptimisticUpdate` flips `hasCompletedOnboarding` to `true` in the
  // local Convex cache the moment the user clicks Finish — before the
  // server roundtrip and before `router.push('/app')`. Without it, the
  // `OnboardingGuard` on `/app` would briefly see the still-`false`
  // preloaded value (Next.js doesn't re-execute server preloads on soft
  // navigation within the same `/app/*` segment) and bounce the user
  // back to `/app/onboarding` until the live subscription delivered the
  // true value — a visible flicker. The optimistic update makes the
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

  useEffect(() => {
    if (!isAuthenticated || syncedRef.current) return;
    syncedRef.current = true;
    syncQuotas().catch((err) => {
      // Non-fatal, but it decides whether `completeOnboarding` can consume a
      // COURSES unit later — a failure here surfaces as an unexplained
      // USAGE_LIMIT three steps down, so it needs to be visible.
      reportOnboardingFailure(err, {
        op: 'onboarding.syncQuotas',
        step: 'mount',
        reason: 'sync_quotas_failed',
      });
    });
  }, [syncQuotas, isAuthenticated]);

  // Once `hasCompletedOnboarding` is true (set only by `finalizeOnboarding`,
  // the very last step of the wizard), bounce the user out. This is the
  // single source of truth — no session/local-storage gating.
  useEffect(() => {
    if (userSettings?.hasCompletedOnboarding) {
      router.push('/app');
    }
  }, [userSettings, router]);

  if (
    userSettings === undefined ||
    onboardingProgress === undefined
  ) {
    return <div className="h-dvh" />;
  }

  if (userSettings?.hasCompletedOnboarding) {
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
        firstLessonCardsRated: onboardingProgress.firstLessonCardsRated ?? 0,
        firstLessonSessionId: onboardingProgress.firstLessonSessionId ?? null,
        firstLessonSummary: onboardingProgress.firstLessonSummary ?? null,
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
      router={router}
    />
  );
}

interface SaveProgressArgs {
  step: number;
  reviewMode?: ReviewMode;
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
  firstLessonCardsRated?: number;
  firstLessonSessionId?: string;
  firstLessonSummary?: FirstLessonSummary;
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
    targetLanguages: fd.targetLanguages.length > 0 ? fd.targetLanguages : undefined,
    baseLanguages: fd.baseLanguages.length > 0 ? fd.baseLanguages : undefined,
    currentLevel: fd.currentLevel ?? undefined,
    acquisitionSource: fd.acquisitionSource ?? undefined,
    acquisitionSourceFreeText: fd.acquisitionSourceFreeText ?? undefined,
    learningGoals: fd.learningGoals.length > 0 ? fd.learningGoals : undefined,
    learningGoalFreeText: fd.learningGoalFreeText ?? undefined,
    dailyTimeGoalMinutes: fd.dailyTimeGoalMinutes ?? undefined,
    placementTest: fd.placementTest ?? undefined,
    firstLessonCardsRated:
      fd.firstLessonCardsRated > 0 ? fd.firstLessonCardsRated : undefined,
    firstLessonSessionId: fd.firstLessonSessionId ?? undefined,
    firstLessonSummary: fd.firstLessonSummary ?? undefined,
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
  router: ReturnType<typeof useRouter>;
}

function OnboardingWizard({
  initial,
  initialStepId,
  saveProgress,
  completeOnboarding,
  finalizeOnboarding,
  prepareLanguagePair,
  router,
}: WizardProps) {
  const t = useTranslations('Onboarding.wizard');
  const isNative = useIsNativeApp();
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
  // newer step=N+1 row — so a reload resumes one step behind.
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
      // this eager merge that save writes the pre-persist data — dropping
      // the just-selected field — while also cancelling the debounce that
      // carried it, so the value never reaches the server.
      dataRef.current = { ...dataRef.current, ...partial };
      setData((d) => ({ ...d, ...partial }));
      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
      persistDebounceRef.current = setTimeout(() => {
        const fd = dataRef.current;
        const stepNum = PROGRESS_STEP_ORDER.indexOf(stepIdRef.current) + 1;
        saveProgress(buildProgressPayload(fd, Math.max(1, stepNum)))
          .catch((err) => console.error('Failed to save progress:', err));
      }, 250);
    },
    [saveProgress],
  );

  // Session snapshot from the embedded first lesson — drives the
  // stats-recap + word-projection screens. Reads from `data.firstLessonSummary`
  // (persisted in `onboardingProgress`) so a mid-flow reload doesn't drop
  // the numbers; `setLessonSummary` writes to both local state and the
  // server via `persist`.
  const lessonSummary: OnboardingSessionSummary | null = data.firstLessonSummary;
  const setLessonSummary = useCallback(
    (s: OnboardingSessionSummary | null) => {
      persist({ firstLessonSummary: s });
    },
    [persist],
  );

  // Steps excluded from back-history: transient/loading screens the user
  // shouldn't be able to revisit. The wizard skips these on back nav by
  // never pushing them onto the history stack in the first place.
  const TRANSIENT_STEPS: ReadonlySet<StepId> = useMemo(
    () => new Set<StepId>(['customizing']),
    [],
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
        .catch((err) => console.error(`Failed to save ${label} step:`, err));
    }
  }, [saveProgress]);

  const advance = useCallback((to: StepId) => {
    setHistory((h) => (TRANSIENT_STEPS.has(stepId) ? h : [...h, stepId]));
    setStepId(to);
    saveStepNow(to, 'advance');
  }, [stepId, TRANSIENT_STEPS, saveStepNow]);

  /**
   * Funnel instrumentation. One event per step entry, carrying how long the
   * previous step took — which is enough to build both the drop-off funnel and
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
  // plan-pick never shows the bar (and the store-app shell skips the step
  // entirely), so it's excluded from the denominator — otherwise the last
  // visible value is 92% and the bar never completes.
  const totalSteps = PROGRESS_STEP_ORDER.length - 1;
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
      // Non-fatal — content warmup is best-effort, and we advance regardless.
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
      advance('customizing');
    } else if (data.proficiencyBranch === 'self-pick') {
      advance('cefr-pick');
    } else if (data.proficiencyBranch === 'test') {
      advance('placement-test');
    }
  };

  // Continue on cefr-pick starts the course at the picked level directly —
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
    advance('customizing');
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
    advance('customizing');
  };

  const onCustomizingReady = useCallback(() => {
    advance('first-lesson');
  }, [advance]);

  // Wraps `completeOnboarding` in a stable callback that the CustomizingStep
  // can fire once on mount. The mutation is idempotent server-side, so a
  // repeat call (e.g. after the user backs out and re-enters customizing) is
  // a no-op rather than an error.
  const customizingMountAction = useCallback(async () => {
    try {
      await completeOnboarding();
    } catch (err) {
      // The single worst failure in the flow: CustomizingStep lets the progress
      // bar finish and advances regardless, so the user walks into the first
      // lesson with no course. Without this event it is invisible.
      reportOnboardingFailure(err, {
        op: 'onboarding.completeOnboarding',
        step: 'customizing',
        reason: 'complete_onboarding_failed',
        advanced_anyway: true,
        code: err instanceof ConvexError ? convexErrorCode(err) : undefined,
      });
      toast.error(t('errors.completeFailed'));
    }
  }, [completeOnboarding, t]);

  const onFinalize = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await finalizeOnboarding();
    } catch (err) {
      // Navigates to /app regardless, where OnboardingGuard sees
      // hasCompletedOnboarding === false and bounces the user straight back
      // here — the classic "onboarding loop" report, now traceable.
      reportOnboardingFailure(err, {
        op: 'onboarding.finalizeOnboarding',
        step: 'plan-pick',
        reason: 'finalize_onboarding_failed',
        will_bounce_back: true,
      });
    }
    router.push('/app');
  }, [finalizeOnboarding, router]);

  // A session persisted at plan-pick can resume inside the store-app shell
  // (e.g. onboarding started in the browser, continued in the app). The shell
  // never shows the plan picker, so finalize straight away.
  const autoFinalized = useRef(false);
  useEffect(() => {
    if (!isNative || stepId !== 'plan-pick' || autoFinalized.current) return;
    autoFinalized.current = true;
    void onFinalize();
  }, [isNative, stepId, onFinalize]);

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
    default:
      return;
    }
  };

  const stepHasOwnAdvance =
    stepId === 'customizing' ||
    stepId === 'placement-test' ||
    stepId === 'first-lesson' ||
    stepId === 'stats-recap' ||
    stepId === 'word-projection' ||
    stepId === 'feature-tour' ||
    stepId === 'plan-pick';

  // Enter advances the wizard, so a keyboard user can answer the whole flow
  // without reaching for the mouse. Only on steps that render the shared
  // Continue button — the rest own their advance and their own CTAs.
  //
  // Bubble phase on purpose: Coachmark listens in the CAPTURE phase and
  // stopPropagation()s, so while a coachmark is up Enter dismisses it and
  // never reaches this. Radix dialogs likewise handle Enter inside their own
  // focus trap.
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

  // Passes useCallback values + useState setters into a plain function called
  // during render — `react-hooks/refs` can't tell these aren't refs, so the
  // rule fires a false positive here.
   
  // In the store-app shell the plan picker never renders — the auto-finalize
  // effect above is already navigating to /app, so bridge with a spinner.
  const stepNode =
    isNative && stepId === 'plan-pick' ? (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ) : (
      renderStep({
        stepId,
        data,
        persist,
        onPlacementComplete,
        onCustomizingReady,
        customizingMountAction,
        setCefrSlidLevel,
        lessonSummary,
        setLessonSummary,
        onAdvance: advance,
        onFinalize,
      })
    );

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden">
      {/* Top progress bar — hidden inside the embedded first lesson (the
          lesson's own chrome takes over) and on the final plan-pick step
          (the pricing CTAs need the full canvas). */}
      {stepId !== 'first-lesson' && stepId !== 'plan-pick' ? (
        <div className="bg-background border-b shrink-0 pt-[var(--safe-top)]">
          <div className="container mx-auto px-4 py-3">
            <Progress value={progressPct} className="h-1.5" />
          </div>
        </div>
      ) : null}

      <main className="flex-1 overflow-hidden">
        {stepId === 'first-lesson' ? (
          // Full-width — the embedded LearnView wants the whole canvas.
          <div className="h-full">{stepNode}</div>
        ) : (
          <div className="container mx-auto px-4 max-w-4xl h-full flex flex-col overflow-hidden">
            {stepNode}
          </div>
        )}
      </main>

      {!stepHasOwnAdvance ? (
        <div className="border-t bg-background shrink-0 pb-[var(--safe-bottom)]">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              {history.length > 0 && !POST_CUSTOMIZING_STEPS.has(stepId) ? (
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

function renderStep({
  stepId,
  data,
  persist,
  onPlacementComplete,
  onCustomizingReady,
  customizingMountAction,
  setCefrSlidLevel,
  lessonSummary,
  setLessonSummary,
  onAdvance,
  onFinalize,
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
  onCustomizingReady: () => void;
  customizingMountAction: () => Promise<unknown>;
  setCefrSlidLevel: (n: number) => void;
  lessonSummary: OnboardingSessionSummary | null;
  setLessonSummary: (s: OnboardingSessionSummary | null) => void;
  onAdvance: (to: StepId) => void;
  onFinalize: () => void;
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
  case 'customizing':
    return (
      <CustomizingStep
        onReady={onCustomizingReady}
        onMountAction={customizingMountAction}
      />
    );
  case 'first-lesson':
    return (
      <FirstLessonStep
        initialReviewMode={data.reviewMode ?? 'audio'}
        initialCardsRated={data.firstLessonCardsRated}
        initialSessionId={data.firstLessonSessionId ?? undefined}
        onModeSelected={(m) => persist({ reviewMode: m })}
        onCardsRatedChange={(n) => persist({ firstLessonCardsRated: n })}
        onSessionIdDiscovered={(id) => persist({ firstLessonSessionId: id })}
        onSnapshotUpdate={(snapshot) => setLessonSummary(snapshot)}
        onLessonComplete={(summary) => {
          setLessonSummary(summary);
          onAdvance('stats-recap');
        }}
        onSkipLesson={() => {
          // Skip the stats-recap and word-projection screens — they're
          // only meaningful when the user actually rated cards.
          onAdvance('feature-tour');
        }}
      />
    );
  case 'stats-recap':
    return (
      <StatsRecapStep
        summary={lessonSummary}
        reviewMode={data.reviewMode ?? 'audio'}
        onContinue={() => onAdvance('word-projection')}
      />
    );
  case 'word-projection':
    return (
      <WordProjectionStep
        summary={lessonSummary}
        dailyTimeGoalMinutes={data.dailyTimeGoalMinutes ?? 10}
        onDailyTimeChange={(m) => persist({ dailyTimeGoalMinutes: m })}
        onContinue={() => onAdvance('feature-tour')}
      />
    );
  case 'feature-tour':
    return <FeatureTourStep onComplete={() => onAdvance('plan-pick')} />;
  case 'plan-pick':
    return <PlanPickStep onContinue={onFinalize} />;
  }
}
