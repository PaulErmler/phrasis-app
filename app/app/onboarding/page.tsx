'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Authenticated, AuthLoading, useMutation, useQuery, useAction, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { WelcomeStep } from './onboarding_steps/WelcomeStep';
import { LearningStyleStep } from './onboarding_steps/LearningStyleStep';
import { ReviewModeStep } from './onboarding_steps/ReviewModeStep';
import { TargetLanguagesStep } from './onboarding_steps/TargetLanguagesStep';
import { CurrentLevelStep } from './onboarding_steps/CurrentLevelStep';
import { BaseLanguagesStep } from './onboarding_steps/BaseLanguagesStep';
import { LoadingStep } from './onboarding_steps/LoadingStep';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import { OnboardingData } from './types';

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
  const locale = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userSettings = useQuery(api.features.courses.getUserSettings);
  const onboardingProgress = useQuery(
    api.features.courses.getOnboardingProgress,
  );
  const saveProgress = useMutation(api.features.courses.saveOnboardingProgress);
  const completeOnboarding = useMutation(
    api.features.courses.completeOnboarding,
  );
  const syncQuotas = useAction(api.usage.actions.syncQuotas);
  const { isAuthenticated } = useConvexAuth();
  const syncedRef = useRef(false);
  const syncPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!isAuthenticated || syncedRef.current) return;
    syncedRef.current = true;
    syncPromiseRef.current = syncQuotas()
      .catch((err) => {
        console.error('Failed to sync quotas during onboarding:', err);
      })
      .then(() => undefined);
  }, [syncQuotas, isAuthenticated]);

  const initialData: OnboardingData = onboardingProgress
    ? {
      learningStyle: onboardingProgress.learningStyle || null,
      reviewMode: onboardingProgress.reviewMode || null,
      targetLanguages: onboardingProgress.targetLanguages || [],
      currentLevel: onboardingProgress.currentLevel || null,
      baseLanguages: onboardingProgress.baseLanguages || [],
    }
    : {
      learningStyle: null,
      reviewMode: null,
      targetLanguages: [],
      currentLevel: null,
      baseLanguages: [],
    };

  const [data, setData] = useState<OnboardingData>(initialData);
  const [step, setStep] = useState(onboardingProgress?.step || 1);

  const totalSteps = 7;
  const progress = (step / totalSteps) * 100;

  useEffect(() => {
    if (userSettings?.hasCompletedOnboarding) {
      router.push('/app');
    }
  }, [userSettings, router]);

  const canContinue = () => {
    switch (step) {
    case 1:
      return true;
    case 2:
      return data.learningStyle !== null;
    case 3:
      return data.reviewMode !== null;
    case 4:
      return data.targetLanguages.length > 0;
    case 5:
      return data.currentLevel !== null;
    case 6:
      return data.baseLanguages.length > 0;
    case 7:
      return true;
    default:
      return false;
    }
  };

  const handleComplete = useCallback(async () => {
    setIsSubmitting(true);
    try {
      if (syncPromiseRef.current) await syncPromiseRef.current;
      await completeOnboarding();
      router.push('/app');
    } catch (error) {
      console.error('Error completing onboarding:', error);
      toast.error('Failed to complete onboarding', {
        description: 'Please try again.',
      });
      setIsSubmitting(false);
    }
  }, [completeOnboarding, router]);

  const saveProgressData = useCallback(async (nextStep: number) => {
    try {
      await saveProgress({
        step: nextStep,
        learningStyle: data.learningStyle || undefined,
        reviewMode: data.reviewMode || undefined,
        targetLanguages:
          data.targetLanguages.length > 0 ? data.targetLanguages : undefined,
        currentLevel: data.currentLevel || undefined,
        baseLanguages:
          data.baseLanguages.length > 0 ? data.baseLanguages : undefined,
      });
    } catch (error) {
      console.error('Error saving progress:', error);
    }
  }, [saveProgress, data]);

  const handleContinue = async () => {
    const nextStep = step + 1;
    if (step < totalSteps) {
      setStep(nextStep);
      await saveProgressData(nextStep);
    } else {
      await handleComplete();
    }
  };

  const handleBack = async () => {
    if (step > 1) {
      const prevStep = step - 1;
      setStep(prevStep);
      await saveProgressData(prevStep);
    }
  };

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
    <div className="h-screen flex flex-col overflow-hidden ">
      {step < totalSteps && (
        <div className="bg-background border-b shrink-0">
          <div className="container mx-auto px-4 py-4">
            <Progress value={progress} className="h-2" />
            <p className="text-muted-sm mt-2 text-center">
              Step {step} of {totalSteps}
            </p>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-hidden">
        <div className="container mx-auto px-4 max-w-4xl h-full flex flex-col overflow-hidden">
          {step === 1 && <WelcomeStep />}

          {step === 2 && (
            <LearningStyleStep
              selectedStyle={data.learningStyle}
              onSelectStyle={(style) =>
                setData({ ...data, learningStyle: style })
              }
            />
          )}

          {step === 3 && (
            <ReviewModeStep
              selectedMode={data.reviewMode}
              onSelectMode={(mode) =>
                setData({ ...data, reviewMode: mode })
              }
            />
          )}

          {step === 4 && (
            <TargetLanguagesStep
              selectedLanguages={data.targetLanguages}
              onToggleLanguage={(code) =>
                setData({ ...data, targetLanguages: [code] })
              }
            />
          )}

          {step === 5 && (
            <CurrentLevelStep
              selectedLevel={data.currentLevel}
              targetLanguageName={
                data.targetLanguages[0]
                  ? getLocalizedLanguageNameByCode(
                    data.targetLanguages[0],
                    locale,
                  )
                  : undefined
              }
              onSelectLevel={(level) =>
                setData({ ...data, currentLevel: level })
              }
            />
          )}

          {step === 6 && (
            <BaseLanguagesStep
              selectedLanguages={data.baseLanguages}
              excludeLanguages={data.targetLanguages}
              onToggleLanguage={(code) =>
                setData({ ...data, baseLanguages: [code] })
              }
            />
          )}

          {step === 7 && <LoadingStep onComplete={handleComplete} />}
        </div>
      </main>

      {step < totalSteps && (
        <div className="border-t bg-background shrink-0">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              {step > 1 && step < 7 ? (
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
                ) : step === 1 ? (
                  t('getStarted')
                ) : step === totalSteps ? (
                  t('finish')
                ) : (
                  t('continue')
                )}
              </Button>
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
