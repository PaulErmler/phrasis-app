'use client';

import { useTranslations } from 'next-intl';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { CircleCheck, EyeOff, X } from 'lucide-react';
import {
  DEFAULT_BATCH_SIZE,
  type CourseSettings,
} from '@/components/app/learning/types';
import { StepperControl } from '@/components/app/learning/StepperControl';
import { TimelineLanguageCard } from '@/components/app/learning/TimelineLanguageCard';
import { StepperPauseConnector } from '@/components/app/learning/StepperPauseConnector';
import {
  DEFAULT_AUTO_PLAY,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_REPETITIONS_BASE,
  DEFAULT_REPETITIONS_TARGET,
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
} from '@/lib/constants/audioPlayback';
import { resolveLanguageOrder } from '@/lib/utils/languageOrder';

interface LearningModeSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseSettings: CourseSettings | null;
  baseLanguages: string[];
  targetLanguages: string[];
}

export function LearningModeSettings({
  open,
  onOpenChange,
  courseSettings,
  baseLanguages: baseProp,
  targetLanguages: targetProp,
}: LearningModeSettingsProps) {
  const t = useTranslations('LearningMode.settingsPanel');
  const updateSettings = useMutation(
    api.features.courses.updateCourseSettings,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getActiveCourseSettings,
      {},
    );
    if (current !== undefined && current !== null) {
      const { courseId, ...updates } = args;
      localStore.setQuery(
        api.features.courses.getActiveCourseSettings,
        {},
        { ...current, ...updates },
      );
    }
  });

  if (!courseSettings) return null;
  const baseLanguages = resolveLanguageOrder(
    courseSettings.baseLanguageOrder,
    baseProp,
  );
  const targetLanguages = resolveLanguageOrder(
    courseSettings.targetLanguageOrder,
    targetProp,
  );

  // ---- existing setting handlers ----

  const handleBatchSizeChange = async (value: number) => {
    if (value < 1 || value > 50) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      cardsToAddBatchSize: value,
    });
  };

  const handleAutoAddChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoAddCards: checked,
    });
  };

  const handleInitialReviewsChange = async (value: number) => {
    if (value < 1 || value > 20) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      initialReviewCount: value,
    });
  };

  // ---- audio playback setting handlers ----

  const handleAutoPlayChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoPlayAudio: checked,
    });
  };

  const handleAutoAdvanceChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoAdvance: checked,
    });
  };

  const handleRepetitionChange = async (language: string, value: number) => {
    if (value < 0 || value > 10) return;
    const current = courseSettings.languageRepetitions ?? {};
    await updateSettings({
      courseId: courseSettings.courseId,
      languageRepetitions: { ...current, [language]: value },
    });
  };

  const handleRepetitionPauseChange = async (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 30) return;
    const current = courseSettings.languageRepetitionPauses ?? {};
    await updateSettings({
      courseId: courseSettings.courseId,
      languageRepetitionPauses: { ...current, [language]: value },
    });
  };

  const handlePauseBaseToBaseChange = async (value: number) => {
    if (value < 0 || value > 30) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      pauseBaseToBase: value,
    });
  };

  const handlePauseBaseToTargetChange = async (value: number) => {
    if (value < 0 || value > 30) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      pauseBaseToTarget: value,
    });
  };

  const handlePauseTargetToTargetChange = async (value: number) => {
    if (value < 0 || value > 30) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      pauseTargetToTarget: value,
    });
  };

  const handlePauseBeforeAutoAdvanceChange = async (value: number) => {
    if (value < 0 || value > 10) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      pauseBeforeAutoAdvance: value,
    });
  };

  // ---- resolved values (with defaults) ----

  const reps = courseSettings.languageRepetitions ?? {};
  const repPauses = courseSettings.languageRepetitionPauses ?? {};
  const pauseB2B =
    courseSettings.pauseBaseToBase ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
  const pauseB2T =
    courseSettings.pauseBaseToTarget ?? DEFAULT_PAUSE_BASE_TO_TARGET;
  const pauseT2T =
    courseSettings.pauseTargetToTarget ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
  const autoAdvance = courseSettings.autoAdvance ?? DEFAULT_AUTO_ADVANCE;

  // ---- reorder helpers (persist to backend) ----

  const swap = (arr: string[], i: number, j: number) => {
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  const moveBaseUp = (idx: number) => {
    const next = swap(baseLanguages, idx, idx - 1);
    void updateSettings({
      courseId: courseSettings.courseId,
      baseLanguageOrder: next,
    });
  };
  const moveBaseDown = (idx: number) => {
    const next = swap(baseLanguages, idx, idx + 1);
    void updateSettings({
      courseId: courseSettings.courseId,
      baseLanguageOrder: next,
    });
  };
  const moveTargetUp = (idx: number) => {
    const next = swap(targetLanguages, idx, idx - 1);
    void updateSettings({
      courseId: courseSettings.courseId,
      targetLanguageOrder: next,
    });
  };
  const moveTargetDown = (idx: number) => {
    const next = swap(targetLanguages, idx, idx + 1);
    void updateSettings({
      courseId: courseSettings.courseId,
      targetLanguageOrder: next,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[380px] p-0 [&>button:last-child]:hidden"
      >
        <SheetDescription className="sr-only">{t('title')}</SheetDescription>

        {/* Header matching LearningMode header style */}
        <div className="sticky-header">
          <div className="px-4 h-14 flex items-center relative">
            <SheetTitle className="heading-section absolute inset-0 flex items-center justify-center pointer-events-none">
              {t('title')}
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="ml-auto z-10 -mr-2"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto max-h-[calc(100vh-3.5rem)]">
          {/* Icon Legend */}
          <div className="rounded-md border bg-muted/40 px-3 py-2.5 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('iconLegend')}
            </p>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <CircleCheck className="h-3.5 w-3.5 text-success shrink-0" />
                <span>{t('iconMaster')}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <EyeOff className="h-3.5 w-3.5 text-warning shrink-0" />
                <span>{t('iconHide')}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* ================================================================
              REVIEW SETTINGS
              ================================================================ */}

          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('reviewSettings')}
          </p>

          {/* Cards per batch */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">
                  {t('cardsPerBatch')}
                </Label>
                <p className="text-muted-xs">{t('cardsPerBatchDescription')}</p>
              </div>
              <StepperControl
                value={courseSettings.cardsToAddBatchSize ?? DEFAULT_BATCH_SIZE}
                min={1}
                max={50}
                onChange={handleBatchSizeChange}
              />
            </div>
          </div>

          {/* Initial reviews */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">
                  {t('initialReviews')}
                </Label>
                <p className="text-muted-xs">
                  {t('initialReviewsDescription')}
                </p>
              </div>
              <StepperControl
                value={courseSettings.initialReviewCount}
                min={1}
                max={20}
                onChange={handleInitialReviewsChange}
              />
            </div>
          </div>

          {/* Auto-add cards */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="autoAdd" className="text-sm font-medium">
                {t('autoAddCards')}
              </Label>
              <p className="text-muted-xs">{t('autoAddCardsDescription')}</p>
            </div>
            <Switch
              id="autoAdd"
              checked={courseSettings.autoAddCards ?? false}
              onCheckedChange={handleAutoAddChange}
              className="mt-0.5"
            />
          </div>

          {/* Auto-advance */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="autoAdvance" className="text-sm font-medium">
                {t('autoAdvance')}
              </Label>
              <p className="text-muted-xs">{t('autoAdvanceDescription')}</p>
            </div>
            <Switch
              id="autoAdvance"
              checked={autoAdvance}
              onCheckedChange={handleAutoAdvanceChange}
              className="mt-0.5"
            />
          </div>

          <Separator />

          {/* ================================================================
              AUDIO PLAYBACK Settings
              ================================================================ */}

          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('audioPlayback')}
          </p>

          {/* Auto-play audio */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="autoPlayAudio" className="text-sm font-medium">
                {t('autoPlay')}
              </Label>
              <p className="text-muted-xs">{t('autoPlayDescription')}</p>
            </div>
            <Switch
              id="autoPlayAudio"
              checked={courseSettings.autoPlayAudio ?? DEFAULT_AUTO_PLAY}
              onCheckedChange={handleAutoPlayChange}
              className="mt-0.5"
            />
          </div>

          <p className="text-muted-xs pt-2">
            {t('playbackSequenceDescription')}
          </p>

          <div className="flex flex-col items-center gap-0 py-1">
            {/* Base languages */}
            {baseLanguages.map((code, idx) => {
              const plays = reps[code] ?? DEFAULT_REPETITIONS_BASE;
              const repPause =
                repPauses[code] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;
              const nextCode = baseLanguages[idx + 1];
              const nextPlays = nextCode
                ? (reps[nextCode] ?? DEFAULT_REPETITIONS_BASE)
                : 0;

              return (
                <div
                  key={`base-${code}`}
                  className="w-full flex flex-col items-center"
                >
                  <TimelineLanguageCard
                    code={code}
                    type="base"
                    plays={plays}
                    repPause={repPause}
                    onPlaysChange={(v) => handleRepetitionChange(code, v)}
                    onRepPauseChange={(v) =>
                      handleRepetitionPauseChange(code, v)
                    }
                    repPauseLabel={t('pause')}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < baseLanguages.length - 1}
                    onMoveUp={() => moveBaseUp(idx)}
                    onMoveDown={() => moveBaseDown(idx)}
                  />

                  {/* Base → Base Pause connector */}
                  {idx < baseLanguages.length - 1 && (
                    <StepperPauseConnector
                      label={t('pauseBaseToBase')}
                      seconds={pauseB2B}
                      onChange={handlePauseBaseToBaseChange}
                      lineOnly={plays === 0 || nextPlays === 0}
                    />
                  )}
                </div>
              );
            })}

            {/* Base → Target Pause connector (always editable) */}
            {baseLanguages.length > 0 && targetLanguages.length > 0 && (
              <StepperPauseConnector
                label={t('pauseBaseToTarget')}
                seconds={pauseB2T}
                onChange={handlePauseBaseToTargetChange}
                accent
              />
            )}

            {/* Target languages */}
            {targetLanguages.map((code, idx) => {
              const plays = reps[code] ?? DEFAULT_REPETITIONS_TARGET;
              const repPause =
                repPauses[code] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;
              const nextCode = targetLanguages[idx + 1];
              const nextPlays = nextCode
                ? (reps[nextCode] ?? DEFAULT_REPETITIONS_TARGET)
                : 0;

              return (
                <div
                  key={`target-${code}`}
                  className="w-full flex flex-col items-center"
                >
                  <TimelineLanguageCard
                    code={code}
                    type="target"
                    plays={plays}
                    repPause={repPause}
                    onPlaysChange={(v) => handleRepetitionChange(code, v)}
                    onRepPauseChange={(v) =>
                      handleRepetitionPauseChange(code, v)
                    }
                    repPauseLabel={t('pause')}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < targetLanguages.length - 1}
                    onMoveUp={() => moveTargetUp(idx)}
                    onMoveDown={() => moveTargetDown(idx)}
                  />

                  {/* Target → Target Pause connector */}
                  {idx < targetLanguages.length - 1 && (
                    <StepperPauseConnector
                      label={t('pauseTargetToTarget')}
                      seconds={pauseT2T}
                      onChange={handlePauseTargetToTargetChange}
                      lineOnly={plays === 0 || nextPlays === 0}
                    />
                  )}
                </div>
              );
            })}

            {/* Pause before auto-advance (only shown when auto-advance is enabled) */}
            {autoAdvance &&
              (baseLanguages.length > 0 || targetLanguages.length > 0) && (
              <StepperPauseConnector
                label={t('pauseBeforeAutoAdvance')}
                seconds={
                  courseSettings.pauseBeforeAutoAdvance ??
                    DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE
                }
                onChange={handlePauseBeforeAutoAdvanceChange}
                accent
              />
            )}

            {/* End-of-sequence indicator */}
            <div className="mt-2 flex items-center gap-2 text-muted-xs">
              {autoAdvance ? (
                <>
                  <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-primary" />
                  <span>{t('autoAdvanceIndicator')}</span>
                </>
              ) : (
                <>
                  <X className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('noAutoAdvance')}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
