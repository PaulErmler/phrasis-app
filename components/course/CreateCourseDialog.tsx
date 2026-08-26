'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, X } from 'lucide-react';
import { toast } from 'sonner';
import { LanguageSelector } from './LanguageSelector';
import { DifficultySelector, LEVEL_ICONS } from './DifficultySelector';
import { CurrentLevel } from './types';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  DAILY_TIME_PRESETS,
  DAILY_TIME_CUSTOM_MIN,
  DAILY_TIME_CUSTOM_MAX,
} from '@/lib/constants/dailyGoal';

import { reportError } from '@/lib/report-error';

interface CreateCourseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateCourseDialog({
  open,
  onOpenChange,
}: CreateCourseDialogProps) {
  const t = useTranslations('AppPage.courses.createDialog');
  const tLevels = useTranslations('Onboarding.difficulty');

  const [step, setStep] = useState(1);
  const [targetLanguage, setTargetLanguage] = useState<string>('');
  const [baseLanguage, setBaseLanguage] = useState<string>('');
  const [difficulty, setDifficulty] = useState<CurrentLevel | null>(null);
  const [dailyGoal, setDailyGoal] = useState<number | null>(null);
  const [customGoal, setCustomGoal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Course created by a partially-failed submit, stamped with the answers it
  // was created FROM. A retry reuses it instead of creating a duplicate, but
  // only while those answers still hold: without the signature, going Back
  // and switching the language would silently re-activate the original course
  // and never create the one the user just asked for.
  const createdCourseRef = useRef<{
    courseId: Id<'courses'>;
    signature: string;
  } | null>(null);

  const createCourse = useMutation(api.features.courses.createCourse);
  const archiveCourse = useMutation(api.features.courses.archiveCourse);
  const setActiveCourse = useMutation(api.features.courses.setActiveCourse);
  const updateCourseSettings = useMutation(
    api.features.courses.updateCourseSettings,
  );

  const totalSteps = 4;
  const progress = (step / totalSteps) * 100;

  const parsedCustomGoal = Number.parseInt(customGoal, 10);
  const customGoalValid =
    Number.isFinite(parsedCustomGoal) &&
    parsedCustomGoal >= DAILY_TIME_CUSTOM_MIN &&
    parsedCustomGoal <= DAILY_TIME_CUSTOM_MAX;
  const effectiveGoal = customGoalValid ? parsedCustomGoal : dailyGoal;

  /** The answers `createCourse` is called with. See `createdCourseRef`. */
  const courseSignature = () =>
    JSON.stringify([targetLanguage, baseLanguage, difficulty]);

  const resetForm = () => {
    setStep(1);
    setTargetLanguage('');
    setBaseLanguage('');
    setDifficulty(null);
    setDailyGoal(null);
    setCustomGoal('');
    setIsSubmitting(false);
    createdCourseRef.current = null;
  };

  const handleClose = (open: boolean) => {
    if (!open && !isSubmitting) {
      resetForm();
    }
    onOpenChange(open);
  };

  const canContinue = () => {
    switch (step) {
    case 1:
      return targetLanguage !== '';
    case 2:
      return baseLanguage !== '';
    case 3:
      return difficulty !== null;
    case 4:
      return effectiveGoal !== null;
    default:
      return false;
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
    if (!targetLanguage || !baseLanguage || !difficulty || effectiveGoal == null) {
      return;
    }

    setIsSubmitting(true);
    try {
      // A previous attempt may have created (and activated) the course and
      // only failed on the goal write below. A retry must reuse it, not
      // create a duplicate (or, on the single-course free tier, dead-end on
      // USAGE_LIMIT inside a dialog whose course already exists behind it).
      // Reuse only when the course still matches what the form now says; the
      // goal is deliberately not part of the signature, since changing only
      // the goal is exactly the retry the stored course is meant to serve.
      const signature = courseSignature();
      const remembered = createdCourseRef.current;
      let courseId =
        remembered && remembered.signature === signature
          ? remembered.courseId
          : null;
      if (courseId === null) {
        if (remembered) {
          // The half-created course from the previous attempt no longer
          // matches the form. Archive it to release its course slot, or
          // the retry dead-ends on USAGE_LIMIT on the single-course free
          // tier. Best-effort: on failure createCourse below surfaces the
          // quota error exactly as before.
          try {
            await archiveCourse({ courseId: remembered.courseId });
          } catch (archiveError) {
            reportError(archiveError, { op: 'archiveOrphanedCourse' });
          }
          createdCourseRef.current = null;
        }
        const result = await createCourse({
          targetLanguages: [targetLanguage],
          baseLanguages: [baseLanguage],
          currentLevel: difficulty,
        });
        courseId = result.courseId;
        createdCourseRef.current = { courseId, signature };
      }

      // Activate before the goal write: if that write fails, the user still
      // ends up on a working course (and can set the goal from the home
      // ring). Idempotent, so re-running it on a retry is harmless.
      await setActiveCourse({ courseId });

      // Persist the daily goal (createCourse doesn't take it, the goal is
      // a courseSettings field, patchable via updateCourseSettings).
      await updateCourseSettings({
        courseId,
        dailyTimeGoalMinutes: effectiveGoal,
      });

      createdCourseRef.current = null;
      handleClose(false);
      resetForm();
    } catch (error) {
      reportError(error, { op: 'createCourse' });
      toast.error(t('error'));
      setIsSubmitting(false);
    }
  };

  const handleTargetLanguageToggle = (code: string) => {
    setTargetLanguage(code);
  };

  const handleBaseLanguageToggle = (code: string) => {
    setBaseLanguage(code);
  };

  const levelOptions = [
    {
      id: 'beginner' as const,
      icon: LEVEL_ICONS.beginner,
      title: tLevels('beginner.title'),
      description: tLevels('beginner.description'),
    },
    {
      id: 'elementary' as const,
      icon: LEVEL_ICONS.elementary,
      title: tLevels('elementary.title'),
      description: tLevels('elementary.description'),
    },
    {
      id: 'intermediate' as const,
      icon: LEVEL_ICONS.intermediate,
      title: tLevels('intermediate.title'),
      description: tLevels('intermediate.description'),
    },
    {
      id: 'upper_intermediate' as const,
      icon: LEVEL_ICONS.upper_intermediate,
      title: tLevels('upper_intermediate.title'),
      description: tLevels('upper_intermediate.description'),
    },
    {
      id: 'advanced' as const,
      icon: LEVEL_ICONS.advanced,
      title: tLevels('advanced.title'),
      description: tLevels('advanced.description'),
    },
    {
      id: 'proficient' as const,
      icon: LEVEL_ICONS.proficient,
      title: tLevels('proficient.title'),
      description: tLevels('proficient.description'),
    },
  ];

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="left"
        className="w-full sm:max-w-md flex flex-col p-0 gap-0"
      >
        <SheetTitle className="sr-only">{t('title')}</SheetTitle>
        <SheetDescription className="sr-only">{t('title')}</SheetDescription>

        {/* Header */}
        <div className="sheet-header">
          <h2 className="heading-section">{t('title')}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleClose(false)}
            disabled={isSubmitting}
            className="-mr-2"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Progress Bar */}
        <div className="px-4 py-4 border-b">
          <Progress value={progress} className="h-2" />
          <p className="text-muted-sm mt-2 text-center">
            Step {step} of {totalSteps}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden px-6">
          {step === 1 && (
            <LanguageSelector
              title={t('step1.title')}
              subtitle={t('step1.subtitle')}
              selectedLanguages={targetLanguage ? [targetLanguage] : []}
              onToggleLanguage={handleTargetLanguageToggle}
            />
          )}

          {step === 2 && (
            <LanguageSelector
              title={t('step2.title')}
              subtitle={t('step2.subtitle')}
              selectedLanguages={baseLanguage ? [baseLanguage] : []}
              excludeLanguages={targetLanguage ? [targetLanguage] : []}
              onToggleLanguage={handleBaseLanguageToggle}
            />
          )}

          {step === 3 && (
            <DifficultySelector
              title={t('step3.title')}
              subtitle={t('step3.subtitle')}
              selectedLevel={difficulty}
              onSelectLevel={setDifficulty}
              levelOptions={levelOptions}
            />
          )}

          {step === 4 && (
            <div className="flex h-full flex-col gap-4 overflow-y-auto py-6">
              <div>
                <h3 className="text-lg font-semibold">{t('step4.title')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('step4.subtitle')}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {DAILY_TIME_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => {
                      setDailyGoal(minutes);
                      setCustomGoal('');
                    }}
                    data-testid={`course-dialog-goal-${minutes}`}
                    className={cn(
                      'flex min-h-14 flex-col items-center justify-center rounded-lg border transition-colors',
                      dailyGoal === minutes && !customGoalValid
                        ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    <span className="text-lg font-semibold tabular-nums">
                      {minutes}
                    </span>
                    <span className="text-muted-xs">{t('step4.minutesUnit')}</span>
                  </button>
                ))}
                <div
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border px-2 transition-colors',
                    customGoalValid &&
                      'border-primary bg-primary/10 ring-1 ring-primary',
                  )}
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={DAILY_TIME_CUSTOM_MIN}
                    max={DAILY_TIME_CUSTOM_MAX}
                    value={customGoal}
                    onChange={(e) => setCustomGoal(e.target.value)}
                    placeholder={t('step4.customPlaceholder')}
                    className="h-7 border-0 bg-transparent p-0 text-center text-lg font-semibold tabular-nums shadow-none focus-visible:ring-0"
                    data-testid="course-dialog-goal-custom"
                  />
                  <span className="text-muted-xs">{t('step4.minutesUnit')}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="sheet-footer">
          <div className="flex items-center justify-between gap-4">
            {step > 1 ? (
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={isSubmitting}
                className="gap-2"
                data-testid="course-dialog-back"
              >
                <ChevronLeft className="h-4 w-4" />
                {t('back')}
              </Button>
            ) : (
              <div />
            )}
            <Button
              onClick={handleNext}
              disabled={!canContinue() || isSubmitting}
              className="min-w-[120px]"
              data-testid={step === totalSteps ? 'course-dialog-create' : 'course-dialog-next'}
            >
              {step === totalSteps ? t('create') : t('next')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
