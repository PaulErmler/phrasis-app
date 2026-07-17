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

import type {
  OnboardingData,
  CurrentLevel,
  ReviewMode,
  AcquisitionSource,
  LearningReason,
  DailyTimeGoalMinutes,
} from './types';
import { EMPTY_ONBOARDING_DATA } from './types';
import {
  ogteToCurrentLevel,
  CURRENT_PLACEMENT_STRATEGY_VERSION,
} from './lib/placementStrategies';

import { LanguagePairStep } from './steps/LanguagePairStep';
import { AcquisitionSourceStep } from './steps/AcquisitionSourceStep';
import { LearningGoalStep } from './steps/LearningGoalStep';
import { DailyTimeGoalStep } from './steps/DailyTimeGoalStep';
import { ProficiencyBranchStep } from './steps/ProficiencyBranchStep';
import { CefrSelfPickStep } from './steps/CefrSelfPickStep';
import { CefrConfirmDialog } from './components/CefrConfirmDialog';
import { PlacementTestStep } from './steps/PlacementTestStep';
import { CustomizingStep } from './steps/CustomizingStep';
import { FirstLessonStep } from './steps/FirstLessonStep';
import { StatsRecapStep } from './steps/StatsRecapStep';
import { WordProjectionStep } from './steps/WordProjectionStep';
import type { OnboardingSessionSummary } from './components/OnboardingFirstLesson';
import { FeatureTourStep } from './steps/FeatureTourStep';
import { PlanPickStep } from './steps/PlanPickStep';

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
      console.error('Failed to sync quotas during onboarding:', err);
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
      ? PROGRESS_STEP_ORDER[onboardingProgress.step - 1] ?? 'language-pair'
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
  placementTest?: {
    strategyVersion?: number;
    strategy: string;
    history: { level: number; knew: boolean }[];
    finalLevel?: number;
  };
  firstLessonCardsRated?: number;
  firstLessonSessionId?: string;
  firstLessonSummary?: {
    cardsRated: number;
    sessionId: string;
    dailyReviewsToday: number;
    dailyTimeMsToday: number;
    dailyNewWordsToday: number;
  };
}

/**
 * Single source of truth for the `saveOnboardingProgress` payload shape.
 * Used by all three call sites in the wizard (debounced field-change
 * `persist`, immediate `advance`, immediate `back`) so a new field landing
 * on `OnboardingData` only needs threading through here.
 */
function buildProgressPayload(
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
  const [data, setData] = useState<OnboardingData>(initial);
  const [stepId, setStepId] = useState<StepId>(initialStepId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<StepId[]>([]);
  // Live OGTE level the user has dialled in on the CEFR slider, kept in
  // wizard state so the Continue button and confirm dialog can read it.
  const [cefrSlidLevel, setCefrSlidLevel] = useState<number>(8);
  // Whether the CEFR confirm dialog is open (driven by the wizard's Continue
  // button on the cefr-pick step).
  const [cefrDialogOpen, setCefrDialogOpen] = useState(false);
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
    // `persist` is defined just below — adding it as a dep is the standard
    // forward-ref pattern; React still wires the dependency correctly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

  // Steps excluded from back-history: transient/loading screens the user
  // shouldn't be able to revisit. The wizard skips these on back nav by
  // never pushing them onto the history stack in the first place.
  const TRANSIENT_STEPS: ReadonlySet<StepId> = useMemo(
    () => new Set<StepId>(['customizing']),
    [],
  );

  const advance = useCallback((to: StepId) => {
    setHistory((h) => (TRANSIENT_STEPS.has(stepId) ? h : [...h, stepId]));
    setStepId(to);
    // Persist the new step *immediately* (no debounce). Without this, a user
    // who clicks Continue without changing any field never triggers `persist`,
    // so the saved step stays behind and a reload resumes at the wrong place.
    // Cancel any pending field-change debounce so its (now stale) save can't
    // arrive after this immediate one and roll the step back.
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current);
      persistDebounceRef.current = null;
    }
    const stepNum = PROGRESS_STEP_ORDER.indexOf(to) + 1;
    if (stepNum > 0) {
      saveProgress(buildProgressPayload(dataRef.current, stepNum))
        .catch((err) => console.error('Failed to save advance step:', err));
    }
  }, [stepId, TRANSIENT_STEPS, saveProgress]);

  const back = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) {
        setStepId(prev);
        // Same rationale as in `advance`: cancel any pending debounce so a
        // stale field-change save can't overwrite this immediate one.
        if (persistDebounceRef.current) {
          clearTimeout(persistDebounceRef.current);
          persistDebounceRef.current = null;
        }
        const stepNum = PROGRESS_STEP_ORDER.indexOf(prev) + 1;
        if (stepNum > 0) {
          saveProgress(buildProgressPayload(dataRef.current, stepNum))
            .catch((err) => console.error('Failed to save back step:', err));
        }
      }
      return h.slice(0, -1);
    });
  }, [saveProgress]);

  // Progress bar percentage
  const progressIndex = useMemo(() => {
    const idx = PROGRESS_STEP_ORDER.indexOf(
      stepId === 'placement-test' ? 'cefr-pick' : stepId,
    );
    return Math.max(0, idx);
  }, [stepId]);
  const totalSteps = PROGRESS_STEP_ORDER.length;
  const progressPct = ((progressIndex + 1) / totalSteps) * 100;

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
      console.error('prepareLanguagePair failed:', err);
      // Non-fatal — content warmup is best-effort.
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

  const onCefrConfirm = () => {
    // Continue on cefr-pick opens the confirmation dialog rather than
    // advancing directly. The dialog gives the user the choice between
    // starting at the picked level or refining via a quick adaptive test.
    setCefrDialogOpen(true);
  };

  const onCefrDialogStartHere = useCallback(() => {
    setCefrDialogOpen(false);
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

  const onCefrDialogTakeQuickTest = useCallback(() => {
    setCefrDialogOpen(false);
    // Seed the placement test with the user's picked level so the first
    // question lands at their range.
    persist({
      placementTest: {
        strategyVersion: CURRENT_PLACEMENT_STRATEGY_VERSION,
        strategy: 'self-pick-seed',
        history: [],
        finalLevel: cefrSlidLevel,
      },
    });
    advance('placement-test');
  }, [cefrSlidLevel, persist, advance]);

  const onPlacementComplete = (result: {
    strategy: import('./lib/placementStrategies').StrategyName;
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
      console.error('completeOnboarding failed:', err);
      toast.error(t('errors.completeFailed'));
    }
  }, [completeOnboarding, t]);

  const onFinalize = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await finalizeOnboarding();
    } catch (err) {
      console.error('finalizeOnboarding failed:', err);
    }
    router.push('/app');
  }, [finalizeOnboarding, router]);

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
      onCefrConfirm();
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

  // Passes useCallback values + useState setters into a plain function called
  // during render — `react-hooks/refs` can't tell these aren't refs, so the
  // rule fires a false positive here.
   
  const stepNode = renderStep({
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
  });

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden">
      {/* Top progress bar — hidden inside the embedded first lesson (the
          lesson's own chrome takes over) and on the final plan-pick step
          (the pricing CTAs need the full canvas). */}
      {stepId !== 'first-lesson' && stepId !== 'plan-pick' ? (
        <div className="bg-background border-b shrink-0">
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
        <div className="border-t bg-background shrink-0">
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

      <CefrConfirmDialog
        open={cefrDialogOpen}
        ogteLevel={cefrSlidLevel}
        onOpenChange={setCefrDialogOpen}
        onStartHere={onCefrDialogStartHere}
        onTakeQuickTest={onCefrDialogTakeQuickTest}
      />
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
    strategy: import('./lib/placementStrategies').StrategyName;
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
