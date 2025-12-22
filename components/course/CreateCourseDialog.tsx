"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, X } from "lucide-react";
import { toast } from "sonner";
import { LanguageSelector } from "./LanguageSelector";
import { DifficultySelector, LEVEL_ICONS } from "./DifficultySelector";
import { CurrentLevel } from "./types";
import { getLanguageByCode } from "@/lib/languages";

interface CreateCourseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateCourseDialog({ open, onOpenChange }: CreateCourseDialogProps) {
  const t = useTranslations("AppPage.courses.createDialog");
  const tLevels = useTranslations("Onboarding.step4");
  
  const [step, setStep] = useState(1);
  const [targetLanguage, setTargetLanguage] = useState<string>("");
  const [baseLanguage, setBaseLanguage] = useState<string>("");
  const [difficulty, setDifficulty] = useState<CurrentLevel | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createCourse = useMutation(api.courses.createCourse);
  const setActiveCourse = useMutation(api.courses.setActiveCourse);

  const totalSteps = 3;
  const progress = (step / totalSteps) * 100;

  const resetForm = () => {
    setStep(1);
    setTargetLanguage("");
    setBaseLanguage("");
    setDifficulty(null);
    setIsSubmitting(false);
  };

  const handleClose = (open: boolean) => {
    if (!open && !isSubmitting) {
      resetForm();
    }
    onOpenChange(open);
  };

  const canContinue = () => {
    switch (step) {
      case 1: return targetLanguage !== "";
      case 2: return baseLanguage !== "";
      case 3: return difficulty !== null;
      default: return false;
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      handleCreate();
    }
  };

  const handleCreate = async () => {
    if (!targetLanguage || !baseLanguage || !difficulty) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createCourse({
        targetLanguages: [targetLanguage],
        baseLanguages: [baseLanguage],
        currentLevel: difficulty,
      });

      // Set the newly created course as active
      await setActiveCourse({ courseId: result.courseId });

      toast.success(t("success"));
      handleClose(false);
      resetForm();
    } catch (error) {
      console.error("Error creating course:", error);
      toast.error(t("error"));
      setIsSubmitting(false);
    }
  };

  const handleTargetLanguageToggle = (code: string) => {
    setTargetLanguage(code);
  };

  const handleBaseLanguageToggle = (code: string) => {
    setBaseLanguage(code);
  };

  const targetLanguageName = targetLanguage 
    ? getLanguageByCode(targetLanguage)?.name 
    : undefined;

  const levelOptions = [
    {
      id: "beginner" as const,
      icon: LEVEL_ICONS.beginner,
      title: tLevels("beginner.title"),
      description: tLevels("beginner.description", { language: targetLanguageName || "the language" }),
    },
    {
      id: "elementary" as const,
      icon: LEVEL_ICONS.elementary,
      title: tLevels("elementary.title"),
      description: tLevels("elementary.description"),
    },
    {
      id: "intermediate" as const,
      icon: LEVEL_ICONS.intermediate,
      title: tLevels("intermediate.title"),
      description: tLevels("intermediate.description"),
    },
    {
      id: "upper_intermediate" as const,
      icon: LEVEL_ICONS.upper_intermediate,
      title: tLevels("upper_intermediate.title"),
      description: tLevels("upper_intermediate.description"),
    },
    {
      id: "advanced" as const,
      icon: LEVEL_ICONS.advanced,
      title: tLevels("advanced.title"),
      description: tLevels("advanced.description"),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-screen h-screen max-w-none flex flex-col p-0 rounded-none">
        <DialogHeader className="px-6 pt-6 pb-4 relative">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("title")}
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-6 top-6"
            onClick={() => handleClose(false)}
            disabled={isSubmitting}
          >
            <X className="h-5 w-5" />
          </Button>
        </DialogHeader>

        {/* Progress Bar */}
        <div className="px-6 pb-4">
          <Progress value={progress} className="h-2" />
          <p className="text-sm text-muted-foreground mt-2 text-center">
            Step {step} of {totalSteps}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {step === 1 && (
            <LanguageSelector
              title={t("step1.title")}
              subtitle={t("step1.subtitle")}
              selectedLanguages={targetLanguage ? [targetLanguage] : []}
              onToggleLanguage={handleTargetLanguageToggle}
              multiSelect={false}
            />
          )}

          {step === 2 && (
            <LanguageSelector
              title={t("step2.title")}
              subtitle={t("step2.subtitle")}
              selectedLanguages={baseLanguage ? [baseLanguage] : []}
              excludeLanguages={targetLanguage ? [targetLanguage] : []}
              onToggleLanguage={handleBaseLanguageToggle}
              multiSelect={false}
            />
          )}

          {step === 3 && (
            <DifficultySelector
              title={t("step3.title")}
              subtitle={t("step3.subtitle")}
              selectedLevel={difficulty}
              onSelectLevel={setDifficulty}
              levelOptions={levelOptions}
            />
          )}
        </div>

        {/* Footer Navigation */}
        <div className="border-t bg-background px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            {step > 1 ? (
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
              onClick={handleNext}
              disabled={!canContinue() || isSubmitting}
              className="min-w-[120px]"
            >
              {step === totalSteps ? (
                t("create")
              ) : (
                t("next")
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

