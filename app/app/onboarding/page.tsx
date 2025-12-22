"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SignedIn, RedirectToSignIn } from "@daveyplate/better-auth-ui";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { WelcomeStep } from "./onboarding_steps/WelcomeStep";
import { LearningStyleStep } from "./onboarding_steps/LearningStyleStep";
import { TargetLanguagesStep } from "./onboarding_steps/TargetLanguagesStep";
import { CurrentLevelStep } from "./onboarding_steps/CurrentLevelStep";
import { BaseLanguagesStep } from "./onboarding_steps/BaseLanguagesStep";
import { LoadingStep } from "./onboarding_steps/LoadingStep";
import { getLocalizedLanguageNameByCode } from "@/lib/languages";
import { OnboardingData } from "./types";

export default function OnboardingPage() {
  const router = useRouter();
  const t = useTranslations("Onboarding");
  const locale = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userSettings = useQuery(api.courses.getUserSettings);
  const onboardingProgress = useQuery(api.courses.getOnboardingProgress);
  const saveProgress = useMutation(api.courses.saveOnboardingProgress);
  const completeOnboarding = useMutation(api.courses.completeOnboarding);

  // Initialize data from onboarding progress or use defaults
  const initialData: OnboardingData = onboardingProgress ? {
    learningStyle: onboardingProgress.learningStyle || null,
    targetLanguages: onboardingProgress.targetLanguages || [],
    currentLevel: onboardingProgress.currentLevel || null,
    baseLanguages: onboardingProgress.baseLanguages || [],
  } : {
    learningStyle: null,
    targetLanguages: [],
    currentLevel: null,
    baseLanguages: [],
  };

  const [data, setData] = useState<OnboardingData>(initialData);
  const [step, setStep] = useState(onboardingProgress?.step || 1);

  const totalSteps = 6;
  const progress = (step / totalSteps) * 100;

  // Redirect to /app if onboarding is already completed
  useEffect(() => {
    if (userSettings?.hasCompletedOnboarding) {
      router.push("/app");
    }
  }, [userSettings, router]);

  const canContinue = () => {
    switch (step) {
      case 1: return true;
      case 2: return data.learningStyle !== null;
      case 3: return data.targetLanguages.length > 0;
      case 4: return data.currentLevel !== null;
      case 5: return data.baseLanguages.length > 0;
      case 6: return true;
      default: return false;
    }
  };

  const handleComplete = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await completeOnboarding();
      router.push("/app");
    } catch (error) {
      console.error("Error completing onboarding:", error);
      toast.error("Failed to complete onboarding", {
        description: "Please try again.",
      });
      setIsSubmitting(false);
    }
  }, [completeOnboarding, router]);

  const handleContinue = async () => {
    const nextStep = step + 1;
    if (step < totalSteps) {
      setStep(nextStep);
      try {
        await saveProgress({
          step: nextStep,
          learningStyle: data.learningStyle || undefined,
          targetLanguages: data.targetLanguages.length > 0 ? data.targetLanguages : undefined,
          currentLevel: data.currentLevel || undefined,
          baseLanguages: data.baseLanguages.length > 0 ? data.baseLanguages : undefined,
        });
      } catch (error) {
        console.error("Error saving progress:", error);
      }
    } else {
      await handleComplete();
    }
  };

  const handleBack = async () => {
    if (step > 1) {
      const prevStep = step - 1;
      setStep(prevStep);
      try {
        await saveProgress({
          step: prevStep,
          learningStyle: data.learningStyle || undefined,
          targetLanguages: data.targetLanguages.length > 0 ? data.targetLanguages : undefined,
          currentLevel: data.currentLevel || undefined,
          baseLanguages: data.baseLanguages.length > 0 ? data.baseLanguages : undefined,
        });
      } catch (error) {
        console.error("Error saving progress:", error);
      }
    }
  };

  // Show loading state while queries are loading (undefined) or if redirecting to /app
  if (userSettings === undefined || onboardingProgress === undefined || userSettings?.hasCompletedOnboarding) {
    return (
      <>
        <RedirectToSignIn />
        <SignedIn>
          <div className="min-h-screen flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </SignedIn>
      </>
    );
  }

  return (
    <>
      <RedirectToSignIn />
      <SignedIn>
        <div className="h-screen flex flex-col overflow-hidden">
          {/* Fixed Progress Bar */}
          {step < totalSteps && (
            <div className="bg-background border-b shrink-0">
              <div className="container mx-auto px-4 py-4">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground mt-2 text-center">
                  Step {step} of {totalSteps}
                </p>
              </div>
            </div>
          )}

          {/* Scrollable Content Area */}
          <main className="flex-1 overflow-hidden">
            <div className="container mx-auto px-4 max-w-4xl h-full flex flex-col overflow-hidden">
              {step === 1 && <WelcomeStep />}

              {step === 2 && (
                <LearningStyleStep
                  selectedStyle={data.learningStyle}
                  onSelectStyle={(style) => setData({ ...data, learningStyle: style })}
                />
              )}

              {step === 3 && (
                <TargetLanguagesStep
                  selectedLanguages={data.targetLanguages}
                  onToggleLanguage={(code) => setData({ ...data, targetLanguages: [code] })}
                />
              )}

              {step === 4 && (
                <CurrentLevelStep
                  selectedLevel={data.currentLevel}
                  targetLanguageName={
                    data.targetLanguages[0]
                      ? getLocalizedLanguageNameByCode(data.targetLanguages[0], locale)
                      : undefined
                  }
                  onSelectLevel={(level) => setData({ ...data, currentLevel: level })}
                />
              )}

              {step === 5 && (
                <BaseLanguagesStep
                  selectedLanguages={data.baseLanguages}
                  excludeLanguages={data.targetLanguages}
                  onToggleLanguage={(code) => setData({ ...data, baseLanguages: [code] })}
                />
              )}

              {step === 6 && <LoadingStep onComplete={handleComplete} />}
            </div>
          </main>

          {/* Bottom Navigation */}
          {step < totalSteps && (
            <div className="border-t bg-background shrink-0">
              <div className="container mx-auto px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  {step > 1 && step < 6 ? (
                    <Button
                      variant="ghost"
                      onClick={handleBack}
                      disabled={isSubmitting}
                      className="gap-2"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      {t("back")}
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
                      t("getStarted")
                    ) : step === totalSteps ? (
                      t("finish")
                    ) : (
                      t("continue")
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Background Pattern */}
          <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
            <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-muted/20 blur-3xl" />
            <div className="absolute -bottom-1/2 -left-1/2 w-[800px] h-[800px] rounded-full bg-muted/20 blur-3xl" />
          </div>
        </div>
      </SignedIn>
    </>
  );
}