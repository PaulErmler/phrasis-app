"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { getLanguageByCode } from "@/lib/languages";
import { OnboardingData } from "./types";

export default function OnboardingPage() {
  const router = useRouter();
  const t = useTranslations("Onboarding");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userSettings = useQuery(api.courses.getUserSettings);
  const saveProgress = useMutation(api.courses.saveOnboardingProgress);
  const completeOnboarding = useMutation(api.courses.completeOnboarding);

  const [data, setData] = useState<OnboardingData>({
    learningStyle: null,
    targetLanguages: [],
    currentLevel: null,
    baseLanguages: [],
  });

  const [step, setStep] = useState(1);

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

  // Show loading state while query is loading (undefined) or if redirecting to /app
  if (userSettings === undefined || userSettings?.hasCompletedOnboarding) {
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
        <div className="min-h-screen flex flex-col">
          {/* Fixed Progress Bar */}
          {step < totalSteps && (
            <div className="sticky top-0 z-10 bg-background border-b">
              <div className="container mx-auto px-4 py-4">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground mt-2 text-center">
                  Step {step} of {totalSteps}
                </p>
              </div>
            </div>
          )}

          {/* Scrollable Content */}
          <main className={`flex-1 overflow-y-auto ${step < totalSteps ? "pb-24" : ""}`}>
            <div className="container mx-auto px-4 py-8 max-w-4xl">
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
                      ? getLanguageByCode(data.targetLanguages[0])?.name
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

          {/* Fixed Bottom Navigation */}
          {step < totalSteps && (
            <div className="fixed bottom-0 left-0 right-0 border-t bg-background">
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