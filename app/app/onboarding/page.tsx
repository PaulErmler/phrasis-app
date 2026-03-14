'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Authenticated, AuthLoading, useMutation, useQuery, useAction, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { OnboardingProvider, useOnboarding, type OnboardingStep } from '@onboardjs/react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { ReviewModeStep } from './onboarding_steps/ReviewModeStep';
import { TargetLanguagesStep } from './onboarding_steps/TargetLanguagesStep';
import { CurrentLevelStep } from './onboarding_steps/CurrentLevelStep';
import { BaseLanguagesStep } from './onboarding_steps/BaseLanguagesStep';
import { LoadingStep } from './onboarding_steps/LoadingStep';
import type { OnboardingData, CurrentLevel, ReviewMode } from './types';

function TargetLanguageStepComponent() {
  const { state, updateContext } = useOnboarding();
  const flowData = (state?.context?.flowData ?? {}) as OnboardingData;

  const handleSelect = (code: string) => {
    updateContext({ flowData: { ...flowData, targetLanguages: [code] } });
  };

  return (
    <TargetLanguagesStep
      selectedLanguages={flowData.targetLanguages ?? []}
      excludeLanguages={flowData.baseLanguages ?? []}
      onToggleLanguage={handleSelect}
    />
  );
}

function BaseLanguageStepComponent() {
  const { state, updateContext } = useOnboarding();
  const flowData = (state?.context?.flowData ?? {}) as OnboardingData;

  const handleSelect = (code: string) => {
    updateContext({ flowData: { ...flowData, baseLanguages: [code] } });
  };

  return (
    <BaseLanguagesStep
      selectedLanguages={flowData.baseLanguages ?? []}
      excludeLanguages={flowData.targetLanguages ?? []}
      onToggleLanguage={handleSelect}
    />
  );
}

const DIFFICULTY_FEEDBACK: Record<CurrentLevel, string> = {
  beginner: "We'll start with the basics!",
  elementary: 'Great, you already know the essentials!',
  intermediate: 'Nice, you have a solid foundation!',
  upper_intermediate: "Impressive, you're well on your way!",
  advanced: "Excellent, you're nearly fluent!",
  proficient: "Amazing, let's refine your mastery!",
};

function DifficultyStepComponent() {
  const { state, updateContext } = useOnboarding();
  const flowData = (state?.context?.flowData ?? {}) as OnboardingData;
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSelect = (level: CurrentLevel) => {
    updateContext({ flowData: { ...flowData, currentLevel: level } });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback(DIFFICULTY_FEEDBACK[level]);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1500);
  };

  return (
    <div className="relative h-full">
      <CurrentLevelStep
        selectedLevel={(flowData.currentLevel as CurrentLevel) ?? null}
        onSelectLevel={handleSelect}
      />
      <FeedbackBadge message={feedback} />
    </div>
  );
}

const REVIEW_MODE_FEEDBACK: Record<ReviewMode, string> = {
  full: 'Great for active practice!',
  audio: 'Perfect for learning on the go!',
};

function ReviewModeStepComponent() {
  const { state, updateContext } = useOnboarding();
  const flowData = (state?.context?.flowData ?? {}) as OnboardingData;
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSelect = (mode: ReviewMode) => {
    updateContext({ flowData: { ...flowData, reviewMode: mode } });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback(REVIEW_MODE_FEEDBACK[mode]);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1500);
  };

  return (
    <div className="relative h-full">
      <ReviewModeStep
        selectedMode={(flowData.reviewMode as ReviewMode) ?? null}
        onSelectMode={handleSelect}
      />
      <FeedbackBadge message={feedback} />
    </div>
  );
}

function FeedbackBadge({ message }: { message: string | null }) {
  return (
    <AnimatePresence mode="wait">
      {message && (
        <motion.div
          key={message}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -5, scale: 0.95 }}
          transition={{ duration: 0.25 }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-medium shadow-lg"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const onboardingSteps: OnboardingStep[] = [
  { id: 'target-language', component: TargetLanguageStepComponent },
  { id: 'base-language', component: BaseLanguageStepComponent },
  { id: 'difficulty', component: DifficultyStepComponent },
  { id: 'review-mode', component: ReviewModeStepComponent },
  { id: 'finish', component: () => null, nextStep: null },
];

export default function OnboardingPage() {
  return (
    <>
      <AuthLoading>
        <div className="h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AuthLoading>
      <Authenticated>
        <OnboardingContent />
      </Authenticated>
    </>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const t = useTranslations('Onboarding');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userSettings = useQuery(api.features.courses.getUserSettings);
  const onboardingProgress = useQuery(api.features.courses.getOnboardingProgress);
  const saveProgress = useMutation(api.features.courses.saveOnboardingProgress);
  const completeOnboarding = useMutation(api.features.courses.completeOnboarding);
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

  useEffect(() => {
    if (userSettings?.hasCompletedOnboarding) {
      router.push('/app');
    }
  }, [userSettings, router]);

  const initialFlowData: OnboardingData = onboardingProgress
    ? {
      reviewMode: (onboardingProgress.reviewMode as ReviewMode) || null,
      targetLanguages: onboardingProgress.targetLanguages || [],
      currentLevel: (onboardingProgress.currentLevel as CurrentLevel) || null,
      baseLanguages: onboardingProgress.baseLanguages || [],
    }
    : {
      reviewMode: null,
      targetLanguages: [],
      currentLevel: null,
      baseLanguages: [],
    };

  const initialStepId = onboardingProgress?.step
    ? onboardingSteps[Math.min(onboardingProgress.step - 1, onboardingSteps.length - 1)]?.id ?? 'target-language'
    : 'target-language';

  if (
    userSettings === undefined ||
    onboardingProgress === undefined ||
    userSettings?.hasCompletedOnboarding
  ) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <OnboardingProvider
      steps={onboardingSteps}
      initialContext={{ flowData: initialFlowData }}
      initialStepId={initialStepId}
    >
      <OnboardingUI
        isSubmitting={isSubmitting}
        setIsSubmitting={setIsSubmitting}
        saveProgress={saveProgress}
        completeOnboarding={completeOnboarding}
        syncQuotas={syncQuotas}
        router={router}
        t={t}
      />
    </OnboardingProvider>
  );
}

interface OnboardingUIProps {
  isSubmitting: boolean;
  setIsSubmitting: (v: boolean) => void;
  saveProgress: (args: {
    step: number;
    reviewMode?: 'audio' | 'full';
    targetLanguages?: string[];
    currentLevel?: 'beginner' | 'elementary' | 'intermediate' | 'upper_intermediate' | 'advanced' | 'proficient';
    baseLanguages?: string[];
  }) => Promise<unknown>;
  completeOnboarding: () => Promise<unknown>;
  syncQuotas: () => Promise<null>;
  router: ReturnType<typeof useRouter>;
  t: ReturnType<typeof useTranslations>;
}

function OnboardingUI({
  isSubmitting,
  setIsSubmitting,
  saveProgress,
  completeOnboarding,
  syncQuotas,
  router,
  t,
}: OnboardingUIProps) {
  const { state, next, previous, renderStep } = useOnboarding();
  const flowData = (state?.context?.flowData ?? {}) as OnboardingData;

  const currentStepIndex = state?.currentStepNumber ?? 1;
  const totalSteps = state?.totalSteps ?? onboardingSteps.length;
  const isFinishStep = currentStepIndex === totalSteps;
  const progress = (currentStepIndex / totalSteps) * 100;

  useEffect(() => {
    if (isFinishStep) {
      syncQuotas().catch((err: unknown) => {
        console.error('Failed to sync quotas on finish step:', err);
      });
    }
  }, [isFinishStep, syncQuotas]);

  const canContinue = () => {
    switch (currentStepIndex) {
    case 1: return (flowData.targetLanguages ?? []).length > 0;
    case 2: return (flowData.baseLanguages ?? []).length > 0;
    case 3: return flowData.currentLevel !== null && flowData.currentLevel !== undefined;
    case 4: return flowData.reviewMode !== null && flowData.reviewMode !== undefined;
    case 5: return true;
    default: return false;
    }
  };

  const flowDataRef = useRef(flowData);
  flowDataRef.current = flowData;

  const saveCurrentProgress = useCallback(async (nextStep: number) => {
    const fd = flowDataRef.current;
    try {
      await saveProgress({
        step: nextStep,
        reviewMode: fd.reviewMode || undefined,
        targetLanguages: (fd.targetLanguages ?? []).length > 0 ? fd.targetLanguages : undefined,
        currentLevel: fd.currentLevel || undefined,
        baseLanguages: (fd.baseLanguages ?? []).length > 0 ? fd.baseLanguages : undefined,
      });
    } catch (error) {
      console.error('Error saving progress:', error);
    }
  }, [saveProgress]);

  const handleComplete = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await syncQuotas();
    } catch (err) {
      console.error('Failed to sync quotas before completing:', err);
    }
    try {
      await completeOnboarding();
      router.push('/app');
    } catch (error) {
      console.error('Error completing onboarding:', error);
      toast.error('Failed to complete onboarding', {
        description: 'Please try again.',
      });
      setIsSubmitting(false);
    }
  }, [completeOnboarding, syncQuotas, router, setIsSubmitting]);

  const handleContinue = async () => {
    if (isFinishStep) {
      await handleComplete();
      return;
    }
    const nextStepNum = currentStepIndex + 1;
    next();
    await saveCurrentProgress(nextStepNum);
  };

  const handleBack = async () => {
    if (currentStepIndex > 1) {
      const prevStepNum = currentStepIndex - 1;
      previous();
      await saveCurrentProgress(prevStepNum);
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {!isFinishStep && (
        <div className="bg-background border-b shrink-0">
          <div className="container mx-auto px-4 py-4">
            <Progress value={progress} className="h-2" />
            <p className="text-muted-sm mt-2 text-center">
              Step {currentStepIndex} of {totalSteps}
            </p>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-hidden">
        <div className="container mx-auto px-4 max-w-4xl h-full flex flex-col overflow-hidden">
          {isFinishStep ? (
            <LoadingStep onComplete={handleComplete} />
          ) : (
            renderStep()
          )}
        </div>
      </main>

      {!isFinishStep && (
        <div className="border-t bg-background shrink-0">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              {currentStepIndex > 1 ? (
                <Button
                  variant="ghost"
                  onClick={handleBack}
                  disabled={isSubmitting}
                  className="gap-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('back')}
                </Button>
              ) : (
                <div />
              )}
              <motion.div
                key={canContinue() ? 'enabled' : 'disabled'}
                initial={{ scale: 0.95, opacity: 0.7 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                <Button
                  onClick={handleContinue}
                  disabled={!canContinue() || isSubmitting}
                  className="min-w-[120px]"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Loading...
                    </>
                  ) : (
                    t('continue')
                  )}
                </Button>
              </motion.div>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-muted/20 blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/2 w-[800px] h-[800px] rounded-full bg-muted/20 blur-3xl" />
      </div>
    </div>
  );
}
