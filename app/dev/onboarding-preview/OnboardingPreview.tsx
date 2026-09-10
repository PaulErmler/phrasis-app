'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  OnboardingWizard,
  type SaveProgressArgs,
} from '@/app/app/onboarding/OnboardingWizard';
import {
  EMPTY_ONBOARDING_DATA,
  type OnboardingData,
} from '@/app/app/onboarding/types';
import { FLOW_ORDER, type StepId } from '@/app/app/onboarding/lib/resumeStep';
import { CURRENT_PLACEMENT_STRATEGY_VERSION } from '@/app/app/onboarding/lib/placementStrategies';

/**
 * The wizard with a floating control panel: pick a language scenario and a
 * step, and the wizard remounts there with every earlier answer filled in.
 * The placement test runs against the dev deployment's public queries; its
 * content warm-up mutation needs a session, so an empty placement sentence
 * here is the missing sign-in, not a bug in the step.
 */

type Scenario = {
  id: string;
  label: string;
  target: string | null;
  base: string | null;
};

const SCENARIOS: Scenario[] = [
  {
    id: 'fresh',
    label: 'Fresh sign-up (nothing answered)',
    target: null,
    base: null,
  },
  { id: 'ja-en', label: 'Japanese from English', target: 'ja', base: 'en' },
  { id: 'ko-en', label: 'Korean from English', target: 'ko', base: 'en' },
  { id: 'de-en', label: 'German from English', target: 'de', base: 'en' },
  { id: 'es-en', label: 'Spanish from English', target: 'es', base: 'en' },
  { id: 'en-de', label: 'English from German', target: 'en', base: 'de' },
];

/** Every step a user can be on, in flow order (placement-test beside its
 *  sibling cefr-pick, which FLOW_ORDER collapses it into). */
const STEPS: StepId[] = FLOW_ORDER.flatMap((step) =>
  step === 'cefr-pick' ? [step, 'placement-test' as const] : [step],
);

/** The answer each step settles, so a jump to step N can fill 1..N-1.
 *  placement-test shares cefr-pick's answer (both settle the level), so a
 *  jump to it also carries that answer. */
const ANSWERS: Record<StepId, Partial<OnboardingData>> = {
  'language-pair': {},
  acquisition: { acquisitionSource: 'friend' },
  'prior-apps': { priorApps: ['duolingo'] },
  goal: { learningGoals: ['travel'] },
  'daily-time': { dailyTimeGoalMinutes: 20 },
  proficiency: { proficiencyBranch: 'self-pick' },
  'cefr-pick': {
    currentLevel: 'elementary',
    placementTest: {
      strategyVersion: CURRENT_PLACEMENT_STRATEGY_VERSION,
      strategy: 'self-pick',
      history: [],
      finalLevel: 8,
    },
  },
  'placement-test': {},
  'review-mode': {},
};

function dataForJump(scenario: Scenario, step: StepId): OnboardingData {
  const data: OnboardingData = {
    ...EMPTY_ONBOARDING_DATA,
    targetLanguages: scenario.target ? [scenario.target] : [],
    baseLanguages: scenario.base ? [scenario.base] : [],
  };
  const stopAt = STEPS.indexOf(step);
  for (const earlier of STEPS.slice(0, stopAt)) {
    Object.assign(data, ANSWERS[earlier]);
  }
  return data;
}

export function OnboardingPreview() {
  const router = useRouter();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [stepId, setStepId] = useState<StepId>('language-pair');
  const [mountKey, setMountKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [lastSaved, setLastSaved] = useState<SaveProgressArgs | null>(null);
  const finishingRef = useRef(false);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const initial = useMemo(
    () => dataForJump(scenario, stepId),
    [scenario, stepId],
  );

  const jump = (nextScenarioId: string, nextStep: StepId) => {
    setScenarioId(nextScenarioId);
    setStepId(nextStep);
    setLastSaved(null);
    setMountKey((k) => k + 1);
  };

  const saveProgress = useCallback(async (args: SaveProgressArgs) => {
    setLastSaved(args);
  }, []);
  const completeOnboarding = useCallback(async () => {
    toast.success('Preview: completeOnboarding would run here');
  }, []);
  const finalizeOnboarding = useCallback(async () => {
    toast.success('Preview: finalizeOnboarding would run here');
  }, []);
  const prepareLanguagePair = useCallback(async () => {}, []);

  // The wizard's finish pushes /app/learn; here that would just bounce to
  // the sign-in page, so the push becomes a toast and the flow restarts.
  const previewRouter = useMemo(
    () =>
      ({
        ...router,
        push: (href: string) => {
          toast(`Preview: would navigate to ${href}`);
          finishingRef.current = false;
          setMountKey((k) => k + 1);
        },
      }) as ReturnType<typeof useRouter>,
    [router],
  );

  return (
    <div className="relative">
      <OnboardingWizard
        key={mountKey}
        initial={initial}
        initialStepId={stepId}
        saveProgress={saveProgress}
        completeOnboarding={completeOnboarding}
        finalizeOnboarding={finalizeOnboarding}
        prepareLanguagePair={prepareLanguagePair}
        finishingRef={finishingRef}
        router={previewRouter}
      />

      <div
        className="fixed right-3 top-3 z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border bg-background/95 shadow-lg backdrop-blur"
        data-testid="onboarding-preview-panel"
      >
        <button
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Onboarding preview
          {panelOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        {panelOpen ? (
          <div className="space-y-3 border-t px-3 py-3 text-sm">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Scenario</span>
              <select
                value={scenarioId}
                onChange={(e) => jump(e.target.value, stepId)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Jump to step
              </span>
              <div className="flex flex-wrap gap-1">
                {STEPS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => jump(scenarioId, step)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs',
                      step === stepId
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:bg-muted',
                    )}
                  >
                    {step}
                  </button>
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => jump(scenarioId, stepId)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restart at this step
            </Button>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Last saved progress payload
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px]">
                {lastSaved ? JSON.stringify(lastSaved, null, 2) : 'nothing yet'}
              </pre>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}
