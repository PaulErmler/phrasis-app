'use client';

import { useState } from 'react';
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
import { X, Headphones, PenLine, Settings2, Languages, Ear } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DEFAULT_BATCH_SIZE,
  type CourseSettings,
} from '@/components/app/learning/types';
import { StepperControl } from '@/components/app/learning/StepperControl';
import { TimelineLanguageCard } from '@/components/app/learning/TimelineLanguageCard';
import {
  StepperPauseConnector,
  TimelineEventConnector,
} from '@/components/app/learning/StepperPauseConnector';
import { ReviewModeSwitcher } from '@/components/app/learning/ReviewModeSwitcher';
import { AutoRateThresholdControl } from '@/components/app/learning/AutoRateBandSlider';
import { CourseLanguageSettings } from '@/components/course/CourseLanguageSettings';
import {
  DEFAULT_AUTO_PLAY,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_REPETITIONS_BASE,
  DEFAULT_REPETITIONS_TARGET,
  DEFAULT_REPETITIONS_TARGET_BEFORE,
  DEFAULT_REPETITIONS_TARGET_WRITING,
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_TARGET_TO_BASE,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_PLAY_TARGET_BEFORE_BASE,
  DEFAULT_PLAY_TARGET_AFTER_BASE,
  PLAYBACK_SPEED_MIN,
  PLAYBACK_SPEED_MAX,
} from '@/lib/constants/audioPlayback';
import { MAX_CARDS_PER_BATCH } from '@/lib/constants/learning';
import { resolveLanguageOrder } from '@/lib/utils/languageOrder';
import { languageNeedsRomanization } from '@/lib/languages';

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
  const [courseSettingsOpen, setCourseSettingsOpen] = useState(false);
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
  // Computed from the raw props rather than the resolved order: these are the
  // course's actual language lists, so the gate can't be affected by a future
  // change to how ordering is resolved.
  const courseSupportsRomanization = [...baseProp, ...targetProp].some(
    languageNeedsRomanization,
  );

  // ---- existing setting handlers ----

  const handleBatchSizeChange = async (value: number) => {
    if (value < 1 || value > MAX_CARDS_PER_BATCH) return;
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
  // In writing ("full") mode these write the `*Full` counterpart fields so the
  // two modes stay independent. Record handlers spread the *effective* map
  // (mode-resolved, see the resolved-values section below), so the first
  // writing-mode edit snapshots the audio values for every language instead of
  // dropping them.

  const handleAutoPlayChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      ...(isTranscribe
        ? { autoPlayAudioTranscribe: checked }
        : isFull
          ? { autoPlayAudioFull: checked }
          : { autoPlayAudio: checked }),
    });
  };

  const handleHighlightWordsChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      ...(isTranscribe
        ? { highlightWordsTranscribe: checked }
        : isFull
          ? { highlightWordsFull: checked }
          : { highlightWords: checked }),
    });
  };

  const handleAutoAdvanceChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoAdvance: checked,
    });
  };

  const handleShowProgressBarChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      showProgressBar: checked,
    });
  };

  const handleProgressDisplayEnabledChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      progressDisplayEnabled: checked,
    });
  };

  const handleHideTargetLanguagesChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      hideTargetLanguages: checked,
      ...(!checked && { autoRevealLanguages: false }),
    });
  };

  const handleAutoRevealLanguagesChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoRevealLanguages: checked,
    });
  };

  const handleHideBaseLanguagesChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      hideBaseLanguages: checked,
      ...(!checked && { autoRevealBaseLanguages: false }),
    });
  };

  const handleAutoRevealBaseLanguagesChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoRevealBaseLanguages: checked,
    });
  };

  const handleShowRomanizationChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      showRomanization: checked,
    });
  };

  const handleRepetitionChange = async (language: string, value: number) => {
    if (value < 0 || value > 10) return;
    const next = { ...reps, [language]: value };
    await updateSettings({
      courseId: courseSettings.courseId,
      ...(isTranscribe
        ? { languageRepetitionsTranscribe: next }
        : isFull
          ? { languageRepetitionsFull: next }
          : { languageRepetitions: next }),
    });
  };

  const handleRepetitionPauseChange = async (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 30) return;
    const next = { ...repPauses, [language]: value };
    await updateSettings({
      courseId: courseSettings.courseId,
      ...(isTranscribe
        ? { languageRepetitionPausesTranscribe: next }
        : isFull
          ? { languageRepetitionPausesFull: next }
          : { languageRepetitionPauses: next }),
    });
  };

  const handleLanguageSpeedChange = async (language: string, value: number) => {
    const clamped = Math.max(
      PLAYBACK_SPEED_MIN,
      Math.min(PLAYBACK_SPEED_MAX, Math.round(value * 10) / 10),
    );
    const next = { ...speeds, [language]: clamped };
    await updateSettings({
      courseId: courseSettings.courseId,
      ...(isTranscribe
        ? { languagePlaybackSpeedsTranscribe: next }
        : isFull
          ? { languagePlaybackSpeedsFull: next }
          : { languagePlaybackSpeeds: next }),
    });
  };

  const handlePauseBaseToBaseChange = async (value: number) => {
    if (value < 0 || value > 30) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      ...(isFull ? { pauseBaseToBaseFull: value } : { pauseBaseToBase: value }),
    });
  };

  const handlePauseBaseToTargetChange = async (value: number) => {
    if (value < 0 || value > 30) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      ...(isFull
        ? { pauseBaseToTargetFull: value }
        : { pauseBaseToTarget: value }),
    });
  };

  const handlePauseTargetToTargetChange = async (value: number) => {
    if (value < 0 || value > 30) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      ...(isTranscribe
        ? { pauseTargetToTargetTranscribe: value }
        : isFull
          ? { pauseTargetToTargetFull: value }
          : { pauseTargetToTarget: value }),
    });
  };

  const handlePauseBeforeAutoAdvanceChange = async (value: number) => {
    if (value < 0 || value > 10) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      ...(isFull
        ? { pauseBeforeAutoAdvanceFull: value }
        : { pauseBeforeAutoAdvance: value }),
    });
  };

  // ---- target before/after base ("Practice Listening" / "Practice Speaking") ----

  // When enabling the before-base target group for the first time, seed its
  // reps/pauses/speeds from the current (after-base) target settings so it
  // starts as a mirror, then edits independently. Returns {} once the before
  // settings already exist (so we never clobber the user's tweaks).
  // The guard checks ALL THREE before-maps, not just repetitions: each
  // per-control handler writes only one of them (speed-only / pause-only / rep-
  // only), and on a default course the rep map seeds empty, so checking reps
  // alone would never latch and would re-seed away a lone speed/pause tweak.
  const beforeSeedIfEmpty = () =>
    Object.keys(courseSettings.targetBeforeRepetitions ?? {}).length === 0 &&
    Object.keys(courseSettings.targetBeforeRepetitionPauses ?? {}).length ===
      0 &&
    Object.keys(courseSettings.targetBeforePlaybackSpeeds ?? {}).length === 0
      ? {
        targetBeforeRepetitions: {
          ...(courseSettings.languageRepetitions ?? {}),
        },
        targetBeforeRepetitionPauses: {
          ...(courseSettings.languageRepetitionPauses ?? {}),
        },
        targetBeforePlaybackSpeeds: {
          ...(courseSettings.languagePlaybackSpeeds ?? {}),
        },
      }
      : {};

  const handlePlayTargetBeforeBaseChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      playTargetBeforeBase: checked,
      // Cannot disable both: if turning this off while "after" is already off,
      // auto-enable "after".
      ...(!checked && !playTargetAfter ? { playTargetAfterBase: true } : {}),
      // Mirror current target settings on first enable.
      ...(checked ? beforeSeedIfEmpty() : {}),
    });
  };

  const handlePlayTargetAfterBaseChange = async (checked: boolean) => {
    const enablingBefore = !checked && !playTargetBefore;
    await updateSettings({
      courseId: courseSettings.courseId,
      playTargetAfterBase: checked,
      // Cannot disable both: auto-enable "before" (and seed it) when turning
      // this off while "before" is already off.
      ...(enablingBefore
        ? { playTargetBeforeBase: true, ...beforeSeedIfEmpty() }
        : {}),
    });
  };

  const handleTargetBeforeRepetitionChange = async (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 10) return;
    const current = courseSettings.targetBeforeRepetitions ?? {};
    await updateSettings({
      courseId: courseSettings.courseId,
      targetBeforeRepetitions: { ...current, [language]: value },
    });
  };

  const handleTargetBeforeRepetitionPauseChange = async (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 30) return;
    const current = courseSettings.targetBeforeRepetitionPauses ?? {};
    await updateSettings({
      courseId: courseSettings.courseId,
      targetBeforeRepetitionPauses: { ...current, [language]: value },
    });
  };

  const handleTargetBeforeSpeedChange = async (
    language: string,
    value: number,
  ) => {
    const clamped = Math.max(
      PLAYBACK_SPEED_MIN,
      Math.min(PLAYBACK_SPEED_MAX, Math.round(value * 10) / 10),
    );
    const current = courseSettings.targetBeforePlaybackSpeeds ?? {};
    await updateSettings({
      courseId: courseSettings.courseId,
      targetBeforePlaybackSpeeds: { ...current, [language]: clamped },
    });
  };

  const handlePauseTargetToBaseChange = async (value: number) => {
    if (value < 0 || value > 30) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      pauseTargetToBase: value,
    });
  };

  // ---- transcribe post-submit replay group ("Translation Entered") ----

  const handleTranscribeAfterRepetitionChange = async (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 10) return;
    const current = courseSettings.transcribeAfterRepetitions ?? {};
    await updateSettings({
      courseId: courseSettings.courseId,
      transcribeAfterRepetitions: { ...current, [language]: value },
    });
  };

  const handleTranscribeAfterRepetitionPauseChange = async (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 30) return;
    const current = courseSettings.transcribeAfterRepetitionPauses ?? {};
    await updateSettings({
      courseId: courseSettings.courseId,
      transcribeAfterRepetitionPauses: { ...current, [language]: value },
    });
  };

  const handleTranscribeAfterSpeedChange = async (
    language: string,
    value: number,
  ) => {
    const clamped = Math.max(
      PLAYBACK_SPEED_MIN,
      Math.min(PLAYBACK_SPEED_MAX, Math.round(value * 10) / 10),
    );
    const current = courseSettings.transcribeAfterPlaybackSpeeds ?? {};
    await updateSettings({
      courseId: courseSettings.courseId,
      transcribeAfterPlaybackSpeeds: { ...current, [language]: clamped },
    });
  };

  // "Only new": limit Practice Listening to a card's initial N reviews. Stored
  // as 0 (= ∞ / always) or 1-10; the stepper's ∞ position maps to 0.
  const handleTargetBeforeOnlyNewChange = async (value: number) => {
    const clamped = value <= 0 ? 0 : Math.min(10, Math.max(1, Math.floor(value)));
    await updateSettings({
      courseId: courseSettings.courseId,
      targetBeforeOnlyNewReps: clamped,
    });
  };

  // ---- review mode handlers ----

  const handleReviewModeChange = async (mode: 'audio' | 'full') => {
    await updateSettings({
      courseId: courseSettings.courseId,
      reviewMode: mode,
    });
  };

  const handleFullReviewTargetAudioModeChange = async (
    mode: 'always' | 'afterSubmit' | 'never',
  ) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      fullReviewTargetAudioMode: mode,
    });
  };

  const handleWritingInputModeChange = async (
    mode: 'translate' | 'transcribe',
  ) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      writingInputMode: mode,
    });
  };

  // Writing-mode "Hide base languages" — independent of the audio-mode pair;
  // its sub-setting reveals on submit (not on audio playback).
  const handleHideBaseLanguagesFullChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      hideBaseLanguagesFull: checked,
      ...(!checked && { autoRevealBaseOnSubmit: false }),
    });
  };

  const handleAutoRevealBaseOnSubmitChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoRevealBaseOnSubmit: checked,
    });
  };

  const handleIgnorePunctuationChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      ignorePunctuation: checked,
    });
  };

  const handleAutoRateFromAccuracyChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoRateFromAccuracy: checked,
    });
  };

  const handleAutoRateThresholdsCommit = async (next: {
    hard: number;
    good: number;
  }) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoRateThresholds: next,
    });
  };

  const handleInstantProceedChange = async (checked: boolean) => {
    if (reviewMode === 'full') {
      await updateSettings({
        courseId: courseSettings.courseId,
        instantProceedFull: checked,
      });
    } else {
      await updateSettings({
        courseId: courseSettings.courseId,
        instantProceedAudio: checked,
      });
    }
  };

  // ---- resolved values (with defaults) ----

  const reviewMode = courseSettings.reviewMode ?? 'audio';
  const isFull = reviewMode === 'full';
  const fullReviewTargetAudioMode =
    courseSettings.fullReviewTargetAudioMode ?? 'afterSubmit';
  const writingInputMode = courseSettings.writingInputMode ?? 'translate';
  const isTranscribe = isFull && writingInputMode === 'transcribe';
  // Each mode edits its own copy of the playback settings; the effective
  // value resolves `*Transcribe ?? *Full ?? unsuffixed` so an untweaked mode
  // shows (and seeds its first write from) the previous mode in the chain.
  // Audio mode keeps reading the unsuffixed fields.
  const pick = <T,>(
    transcribe: T | undefined,
    full: T | undefined,
    audio: T | undefined,
  ): T | undefined =>
      isTranscribe ? (transcribe ?? full ?? audio) : isFull ? (full ?? audio) : audio;
  const reps =
    pick(
      courseSettings.languageRepetitionsTranscribe,
      courseSettings.languageRepetitionsFull,
      courseSettings.languageRepetitions,
    ) ?? {};
  const repPauses =
    pick(
      courseSettings.languageRepetitionPausesTranscribe,
      courseSettings.languageRepetitionPausesFull,
      courseSettings.languageRepetitionPauses,
    ) ?? {};
  const speeds =
    pick(
      courseSettings.languagePlaybackSpeedsTranscribe,
      courseSettings.languagePlaybackSpeedsFull,
      courseSettings.languagePlaybackSpeeds,
    ) ?? {};
  const pauseB2B =
    pick(
      undefined,
      courseSettings.pauseBaseToBaseFull,
      courseSettings.pauseBaseToBase,
    ) ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
  const pauseB2T =
    pick(
      undefined,
      courseSettings.pauseBaseToTargetFull,
      courseSettings.pauseBaseToTarget,
    ) ?? DEFAULT_PAUSE_BASE_TO_TARGET;
  const pauseT2T =
    pick(
      courseSettings.pauseTargetToTargetTranscribe,
      courseSettings.pauseTargetToTargetFull,
      courseSettings.pauseTargetToTarget,
    ) ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
  const autoPlay =
    pick(
      courseSettings.autoPlayAudioTranscribe,
      courseSettings.autoPlayAudioFull,
      courseSettings.autoPlayAudio,
    ) ?? DEFAULT_AUTO_PLAY;
  const highlightWords =
    pick(
      courseSettings.highlightWordsTranscribe,
      courseSettings.highlightWordsFull,
      courseSettings.highlightWords,
    ) === true;
  // Target cards with no stored reps default to 2x in audio mode but 1x in
  // the writing modes (once is enough when the learner is typing) — mirrors
  // resolveAudioSettings.defaultTargetReps.
  const defaultTargetReps = isFull
    ? DEFAULT_REPETITIONS_TARGET_WRITING
    : DEFAULT_REPETITIONS_TARGET;
  const playTargetBefore =
    courseSettings.playTargetBeforeBase ?? DEFAULT_PLAY_TARGET_BEFORE_BASE;
  const playTargetAfter =
    courseSettings.playTargetAfterBase ?? DEFAULT_PLAY_TARGET_AFTER_BASE;
  const beforeReps = courseSettings.targetBeforeRepetitions ?? {};
  const beforeRepPauses = courseSettings.targetBeforeRepetitionPauses ?? {};
  const beforeSpeeds = courseSettings.targetBeforePlaybackSpeeds ?? {};
  // Transcribe post-submit replay group (independent of the pre-submit prompt).
  const transcribeAfterReps = courseSettings.transcribeAfterRepetitions ?? {};
  const transcribeAfterRepPauses =
    courseSettings.transcribeAfterRepetitionPauses ?? {};
  const transcribeAfterSpeeds =
    courseSettings.transcribeAfterPlaybackSpeeds ?? {};
  const pauseT2B = courseSettings.pauseTargetToBase ?? DEFAULT_PAUSE_TARGET_TO_BASE;
  // "Only new" stepper: stored 0/undefined = ∞ (always), shown at the BOTTOM
  // position (UI value 0) so "+" steps ∞ → 1 and "−" steps 1 → ∞. 1-10 map to
  // themselves. The stored value already uses 0 for ∞, so no remapping needed.
  const onlyNewStored = courseSettings.targetBeforeOnlyNewReps;
  const onlyNewUiValue =
    onlyNewStored && onlyNewStored > 0 ? Math.min(10, onlyNewStored) : 0;
  // The after-base target section shows in audio mode only when "Practice
  // Speaking" is on; full mode keeps its existing "always" gating (the
  // before/after toggles don't apply there — see useLearningAudio). Transcribe
  // always shows the targets: the merged target audio is the prompt.
  const showAfterTarget =
    reviewMode === 'audio'
      ? playTargetAfter
      : isTranscribe || fullReviewTargetAudioMode === 'always';
  const showBeforeTarget = reviewMode === 'audio' && playTargetBefore;
  // Transcribe never plays base audio, so its timeline has no base cards.
  const showBaseTimeline = !isTranscribe;
  // Post-submit target playback group ("Translation Entered"): in Translate
  // it's the per-language clip that plays after submitting text
  // (fullReviewTargetAudioMode 'afterSubmit', bound to the writing-set
  // records); in Transcribe it's the replay gated by auto-play (bound to the
  // independent transcribeAfter* records).
  const showAfterSubmitGroup =
    isFull &&
    (isTranscribe ? autoPlay : fullReviewTargetAudioMode === 'afterSubmit');
  const autoAdvance = courseSettings.autoAdvance ?? DEFAULT_AUTO_ADVANCE;
  const instantProceed =
    reviewMode === 'full'
      ? (courseSettings.instantProceedFull ?? true)
      : (courseSettings.instantProceedAudio ?? false);

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

  const courseData = {
    _id: courseSettings.courseId,
    baseLanguages: baseProp,
    targetLanguages: targetProp,
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[380px] p-0 [&>button:last-child]:hidden"
        data-testid="learning-settings-sheet"
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

        <div className="px-6 py-4 space-y-4 overflow-y-auto max-h-[calc(100dvh-3.5rem)]">
          {/* ================================================================
              REVIEW MODE SWITCHER
              ================================================================ */}

          <ReviewModeSwitcher
            value={reviewMode}
            onChange={handleReviewModeChange}
          />

          <div className="space-y-2.5 rounded-md border bg-muted/30 p-3">
            <div className="flex items-start gap-2.5">
              <Headphones className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium">{t('reviewModeAudio')}</p>
                <p className="text-muted-xs">
                  {t('reviewModeAudioDescription')}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <PenLine className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium">{t('reviewModeFull')}</p>
                <p className="text-muted-xs">
                  {t('reviewModeFullDescription')}
                </p>
              </div>
            </div>
          </div>

          {/* Writing style — sub-switcher shown when Writing is selected:
              Translate (base audio plays, type the translation) vs Transcribe
              (target audio plays alone, type what you hear). */}
          {isFull && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {t('writingInputMode')}
              </p>
              <div className="flex w-full rounded-lg border bg-muted/50 p-1">
                <button
                  type="button"
                  onClick={() => handleWritingInputModeChange('translate')}
                  data-testid="settings-writing-translate"
                  className={cn(
                    'flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap',
                    writingInputMode === 'translate'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Languages className="h-4 w-4" />
                  {t('writingInputModeTranslate')}
                </button>
                <button
                  type="button"
                  onClick={() => handleWritingInputModeChange('transcribe')}
                  data-testid="settings-writing-transcribe"
                  className={cn(
                    'flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap',
                    writingInputMode === 'transcribe'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Ear className="h-4 w-4" />
                  {t('writingInputModeTranscribe')}
                </button>
              </div>
              <p className="text-muted-xs">
                {t(
                  isTranscribe
                    ? 'writingInputModeTranscribeDescription'
                    : 'writingInputModeTranslateDescription',
                )}
              </p>
            </div>
          )}

          <Separator />

          {/* ================================================================
              REVIEW SETTINGS (common)
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
                max={MAX_CARDS_PER_BATCH}
                onChange={handleBatchSizeChange}
              />
            </div>
          </div>

          {/* Initial reviews — audio mode only */}
          {reviewMode === 'audio' && (
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
          )}

          {/* Auto-add cards */}
          <div className="settings-row">
            <div className="space-y-0.5">
              <Label htmlFor="autoAdd" className="text-sm font-medium">
                {t('autoAddCards')}
              </Label>
              <p className="text-muted-xs">{t('autoAddCardsDescription')}</p>
            </div>
            <Switch
              id="autoAdd"
              checked={courseSettings.autoAddCards !== false}
              onCheckedChange={handleAutoAddChange}
              className="mt-0.5"
            />
          </div>

          {/* Auto-advance — audio mode only */}
          {reviewMode === 'audio' && (
            <div className="settings-row">
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
          )}

          {/* Instant proceed on rating — both modes */}
          <div className="settings-row">
            <div className="space-y-0.5">
              <Label htmlFor="instantProceed" className="text-sm font-medium">
                {t('instantProceed')}
              </Label>
              <p className="text-muted-xs">{t('instantProceedDescription')}</p>
            </div>
            <Switch
              id="instantProceed"
              checked={instantProceed}
              onCheckedChange={handleInstantProceedChange}
              className="mt-0.5"
            />
          </div>

          {/* Show every-N-cards celebration screen */}
          <div className="settings-row">
            <div className="space-y-0.5">
              <Label
                htmlFor="progressDisplayEnabled"
                className="text-sm font-medium"
              >
                {t('progressDisplayEnabled')}
              </Label>
              <p className="text-muted-xs">
                {t('progressDisplayEnabledDescription')}
              </p>
            </div>
            <Switch
              id="progressDisplayEnabled"
              checked={courseSettings.progressDisplayEnabled !== false}
              onCheckedChange={handleProgressDisplayEnabledChange}
              className="mt-0.5"
            />
          </div>

          {/* Writing-mode scoring: how the accuracy percentage is computed, and
              what it then does with the rating. Both are writing-only, but this
              section is shared with audio mode — hence the guard. */}
          {reviewMode === 'full' && (
            <>
              <div className="settings-row">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="ignorePunctuation"
                    className="text-sm font-medium"
                  >
                    {t('ignorePunctuation')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('ignorePunctuationDescription')}
                  </p>
                </div>
                <Switch
                  id="ignorePunctuation"
                  checked={courseSettings.ignorePunctuation ?? false}
                  onCheckedChange={handleIgnorePunctuationChange}
                  className="mt-0.5"
                />
              </div>

              <div className="space-y-0">
                <div className="settings-row">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="autoRateFromAccuracy"
                      className="text-sm font-medium"
                    >
                      {t('autoRateFromAccuracy')}
                    </Label>
                    <p className="text-muted-xs">
                      {t('autoRateFromAccuracyDescription')}
                    </p>
                  </div>
                  <Switch
                    id="autoRateFromAccuracy"
                    checked={courseSettings.autoRateFromAccuracy ?? true}
                    onCheckedChange={handleAutoRateFromAccuracyChange}
                    className="mt-0.5"
                  />
                </div>

                {(courseSettings.autoRateFromAccuracy ?? true) && (
                  <div className="ml-4 mt-3 pl-3 border-l-2 border-border">
                    <AutoRateThresholdControl
                      thresholds={courseSettings.autoRateThresholds}
                      onCommit={handleAutoRateThresholdsCommit}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          <Separator />

          {/* ================================================================
              AUDIO PLAYBACK Settings
              ================================================================ */}

          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('audioPlayback')}
          </p>

          {/* Highlight words */}
          <div className="settings-row">
            <div className="space-y-0.5">
              <Label htmlFor="highlightWords" className="text-sm font-medium">
                {t('highlightWords')}
              </Label>
              <p className="text-muted-xs">{t('highlightWordsDescription')}</p>
            </div>
            <Switch
              id="highlightWords"
              checked={highlightWords}
              onCheckedChange={handleHighlightWordsChange}
              className="mt-0.5"
            />
          </div>

          {/* Auto-play audio */}
          <div className="settings-row">
            <div className="space-y-0.5">
              <Label htmlFor="autoPlayAudio" className="text-sm font-medium">
                {t('autoPlay')}
              </Label>
              <p className="text-muted-xs">
                {t(
                  isTranscribe
                    ? 'autoPlayDescriptionTranscribe'
                    : 'autoPlayDescription',
                )}
              </p>
            </div>
            <Switch
              id="autoPlayAudio"
              checked={autoPlay}
              onCheckedChange={handleAutoPlayChange}
              className="mt-0.5"
            />
          </div>

          {/* Practice Listening / Speaking — target before/after base (audio mode only).
              At least one must stay enabled; toggling the last-on one auto-enables
              the other. */}
          {reviewMode === 'audio' && (
            <>
              <div className="settings-row">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="playTargetAfterBase"
                    className="text-sm font-medium"
                  >
                    {t('practiceSpeaking')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('practiceSpeakingDescription')}
                  </p>
                </div>
                <Switch
                  id="playTargetAfterBase"
                  checked={playTargetAfter}
                  onCheckedChange={handlePlayTargetAfterBaseChange}
                  className="mt-0.5"
                />
              </div>

              <div className="settings-row">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="playTargetBeforeBase"
                    className="text-sm font-medium"
                  >
                    {t('practiceListening')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('practiceListeningDescription')}
                  </p>
                </div>
                <Switch
                  id="playTargetBeforeBase"
                  checked={playTargetBefore}
                  onCheckedChange={handlePlayTargetBeforeBaseChange}
                  className="mt-0.5"
                />
              </div>

              {/* "Only new" — graduates a card from Practice Listening to
                  Practice Speaking after its initial N reviews, so it only shows
                  (and only takes effect) when BOTH are on. ∞ (default) keeps
                  Practice Listening on every review. */}
              {playTargetBefore && playTargetAfter && (
                <div className="settings-row ml-4 mt-3 pl-3 border-l-2 border-border">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="targetBeforeOnlyNewReps"
                      className="text-sm font-medium"
                    >
                      {t('onlyNew')}
                    </Label>
                    <p className="text-muted-xs">{t('onlyNewDescription')}</p>
                  </div>
                  <StepperControl
                    value={onlyNewUiValue}
                    min={0}
                    max={10}
                    onChange={handleTargetBeforeOnlyNewChange}
                    formatValue={(v) => (v <= 0 ? '∞' : String(v))}
                  />
                </div>
              )}
            </>
          )}

          {/* Target language audio — full review mode only. Hidden in
              transcribe, where the merged target audio IS the prompt and this
              setting is ignored. */}
          {reviewMode === 'full' && !isTranscribe && (
            <div className="space-y-0">
              <div className="settings-row">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="targetAudioEnabled"
                    className="text-sm font-medium"
                  >
                    {t('fullReviewTargetAudio')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('fullReviewTargetAudioDescription')}
                  </p>
                </div>
                <Switch
                  id="targetAudioEnabled"
                  checked={fullReviewTargetAudioMode !== 'never'}
                  onCheckedChange={(checked) => {
                    handleFullReviewTargetAudioModeChange(
                      checked ? 'afterSubmit' : 'never',
                    );
                  }}
                  className="mt-0.5"
                />
              </div>

              {fullReviewTargetAudioMode !== 'never' && (
                <div className="ml-4 mt-3 pl-3 border-l-2 border-border space-y-3">
                  <div className="settings-row">
                    <Label
                      htmlFor="targetAudio_afterSubmit"
                      className="text-sm font-medium"
                    >
                      {t('fullReviewTargetAudio_afterSubmit')}
                    </Label>
                    <Switch
                      id="targetAudio_afterSubmit"
                      checked={fullReviewTargetAudioMode === 'afterSubmit'}
                      onCheckedChange={(checked) => {
                        if (checked)
                          handleFullReviewTargetAudioModeChange('afterSubmit');
                      }}
                      className="mt-0.5"
                    />
                  </div>

                  <div className="settings-row">
                    <Label
                      htmlFor="targetAudio_always"
                      className="text-sm font-medium"
                    >
                      {t('fullReviewTargetAudio_always')}
                    </Label>
                    <Switch
                      id="targetAudio_always"
                      checked={fullReviewTargetAudioMode === 'always'}
                      onCheckedChange={(checked) => {
                        if (checked)
                          handleFullReviewTargetAudioModeChange('always');
                      }}
                      className="mt-0.5"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col items-center gap-0 py-1">
            {/* Before-base target languages ("Practice Listening") — shown above
                base when the toggle is on. Reps/pauses/speed are independent of
                the after-base group. */}
            {showBeforeTarget && targetLanguages.length > 0 && (
              <>
                {targetLanguages.map((code, idx) => {
                  const plays = beforeReps[code] ?? DEFAULT_REPETITIONS_TARGET_BEFORE;
                  const repPause =
                    beforeRepPauses[code] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;
                  const nextCode = targetLanguages[idx + 1];
                  const nextPlays = nextCode
                    ? (beforeReps[nextCode] ?? DEFAULT_REPETITIONS_TARGET_BEFORE)
                    : 0;

                  return (
                    <div
                      key={`before-target-${code}`}
                      className="w-full flex flex-col items-center"
                    >
                      <TimelineLanguageCard
                        code={code}
                        type="target"
                        plays={plays}
                        repPause={repPause}
                        speed={beforeSpeeds[code] ?? DEFAULT_PLAYBACK_SPEED}
                        onPlaysChange={(v) =>
                          handleTargetBeforeRepetitionChange(code, v)
                        }
                        onRepPauseChange={(v) =>
                          handleTargetBeforeRepetitionPauseChange(code, v)
                        }
                        onSpeedChange={(v) =>
                          handleTargetBeforeSpeedChange(code, v)
                        }
                        repPauseLabel={t('pauseBetweenRepetitions')}
                        speedLabel={t('playbackSpeed')}
                        showReorderButtons={targetLanguages.length > 1}
                        canMoveUp={idx > 0}
                        canMoveDown={idx < targetLanguages.length - 1}
                        onMoveUp={() => moveTargetUp(idx)}
                        onMoveDown={() => moveTargetDown(idx)}
                      />

                      {/* Target → Target Pause connector (before-base group) */}
                      {idx < targetLanguages.length - 1 && (
                        <StepperPauseConnector
                          label={t('pause')}
                          seconds={pauseT2T}
                          onChange={handlePauseTargetToTargetChange}
                          lineOnly={plays === 0 || nextPlays === 0}
                        />
                      )}
                    </div>
                  );
                })}

                {/* Before-target → Base Pause connector */}
                {baseLanguages.length > 0 && (
                  <StepperPauseConnector
                    label={t('pause')}
                    seconds={pauseT2B}
                    onChange={handlePauseTargetToBaseChange}
                    accent
                  />
                )}
              </>
            )}

            {/* Base languages */}
            {showBaseTimeline && baseLanguages.map((code, idx) => {
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
                    speed={speeds[code] ?? DEFAULT_PLAYBACK_SPEED}
                    onPlaysChange={(v) => handleRepetitionChange(code, v)}
                    onRepPauseChange={(v) =>
                      handleRepetitionPauseChange(code, v)
                    }
                    onSpeedChange={(v) => handleLanguageSpeedChange(code, v)}
                    repPauseLabel={t('pauseBetweenRepetitions')}
                    speedLabel={t('playbackSpeed')}
                    showReorderButtons={baseLanguages.length > 1}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < baseLanguages.length - 1}
                    onMoveUp={() => moveBaseUp(idx)}
                    onMoveDown={() => moveBaseDown(idx)}
                  />

                  {/* Base → Base Pause connector */}
                  {idx < baseLanguages.length - 1 && (
                    <StepperPauseConnector
                      label={t('pause')}
                      seconds={pauseB2B}
                      onChange={handlePauseBaseToBaseChange}
                      lineOnly={plays === 0 || nextPlays === 0}
                    />
                  )}
                </div>
              );
            })}

            {/* After-base target languages ("Practice Speaking") — shown when
                they're part of the main audio sequence */}
            {showAfterTarget && (
              <>
                {/* Base → Target Pause connector */}
                {showBaseTimeline && baseLanguages.length > 0 && targetLanguages.length > 0 && (
                  <StepperPauseConnector
                    label={t('pause')}
                    seconds={pauseB2T}
                    onChange={handlePauseBaseToTargetChange}
                    accent
                  />
                )}

                {/* Target languages */}
                {targetLanguages.map((code, idx) => {
                  const plays = reps[code] ?? defaultTargetReps;
                  const repPause =
                    repPauses[code] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;
                  const nextCode = targetLanguages[idx + 1];
                  const nextPlays = nextCode
                    ? (reps[nextCode] ?? defaultTargetReps)
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
                        speed={speeds[code] ?? DEFAULT_PLAYBACK_SPEED}
                        onPlaysChange={(v) => handleRepetitionChange(code, v)}
                        onRepPauseChange={(v) =>
                          handleRepetitionPauseChange(code, v)
                        }
                        onSpeedChange={(v) => handleLanguageSpeedChange(code, v)}
                        repPauseLabel={t('pauseBetweenRepetitions')}
                        speedLabel={t('playbackSpeed')}
                        showReorderButtons={targetLanguages.length > 1}
                        canMoveUp={idx > 0}
                        canMoveDown={idx < targetLanguages.length - 1}
                        onMoveUp={() => moveTargetUp(idx)}
                        onMoveDown={() => moveTargetDown(idx)}
                      />

                      {/* Target → Target Pause connector */}
                      {idx < targetLanguages.length - 1 && (
                        <StepperPauseConnector
                          label={t('pause')}
                          seconds={pauseT2T}
                          onChange={handlePauseTargetToTargetChange}
                          lineOnly={plays === 0 || nextPlays === 0}
                        />
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* Post-submit target playback, separated by the "Translation
                Entered" pill. Translate: the per-language clip that plays
                after submitting text (bound to the writing-set records).
                Transcribe: the auto-play-gated replay with its own
                independent records. Each language plays on its own submit,
                so there are no between-language pause connectors here. */}
            {showAfterSubmitGroup && targetLanguages.length > 0 && (
              <>
                <TimelineEventConnector
                  label={t('translationEntered')}
                  accent
                />

                {targetLanguages.map((code, idx) => {
                  const plays = isTranscribe
                    ? (transcribeAfterReps[code] ?? 1)
                    : (reps[code] ?? 1);
                  const repPause = isTranscribe
                    ? (transcribeAfterRepPauses[code] ??
                      DEFAULT_PAUSE_BETWEEN_REPETITIONS)
                    : (repPauses[code] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS);
                  const speed = isTranscribe
                    ? (transcribeAfterSpeeds[code] ??
                      speeds[code] ??
                      DEFAULT_PLAYBACK_SPEED)
                    : (speeds[code] ?? DEFAULT_PLAYBACK_SPEED);

                  return (
                    <div
                      key={`after-submit-${code}`}
                      className="w-full flex flex-col items-center"
                    >
                      <TimelineLanguageCard
                        code={code}
                        type="target"
                        plays={plays}
                        repPause={repPause}
                        speed={speed}
                        onPlaysChange={(v) =>
                          isTranscribe
                            ? handleTranscribeAfterRepetitionChange(code, v)
                            : handleRepetitionChange(code, v)
                        }
                        onRepPauseChange={(v) =>
                          isTranscribe
                            ? handleTranscribeAfterRepetitionPauseChange(
                              code,
                              v,
                            )
                            : handleRepetitionPauseChange(code, v)
                        }
                        onSpeedChange={(v) =>
                          isTranscribe
                            ? handleTranscribeAfterSpeedChange(code, v)
                            : handleLanguageSpeedChange(code, v)
                        }
                        repPauseLabel={t('pauseBetweenRepetitions')}
                        speedLabel={t('playbackSpeed')}
                        showReorderButtons={false}
                        canMoveUp={false}
                        canMoveDown={false}
                        onMoveUp={() => {}}
                        onMoveDown={() => {}}
                      />

                      {idx < targetLanguages.length - 1 && (
                        <div className="flex flex-col items-center py-0.5">
                          <div className="w-px h-5 bg-border" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* Pause before auto-advance (only shown when auto-advance is enabled, audio mode only) */}
            {reviewMode === 'audio' &&
              autoAdvance &&
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
              {reviewMode === 'audio' && autoAdvance ? (
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

          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-xs">{t('playbackSequenceDescription')}</p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 h-7 text-xs"
              onClick={() => setCourseSettingsOpen(true)}
            >
              <Settings2 className="h-3 w-3" />
              {t('editLanguages')}
            </Button>
          </div>

          <Separator />

          {/* ================================================================
              UI SETTINGS
              ================================================================ */}

          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('uiSettings')}
          </p>

          {/* Hide target languages + sub-setting — audio mode only */}
          {reviewMode === 'audio' && (
            <div className="space-y-0">
              <div className="settings-row">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="hideTargetLanguages"
                    className="text-sm font-medium"
                  >
                    {t('hideTargetLanguages')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('hideTargetLanguagesDescription')}
                  </p>
                </div>
                <Switch
                  id="hideTargetLanguages"
                  checked={courseSettings.hideTargetLanguages ?? true}
                  onCheckedChange={handleHideTargetLanguagesChange}
                  className="mt-0.5"
                />
              </div>

              {/* Auto-reveal — visually indented as a sub-setting */}
              {(courseSettings.hideTargetLanguages ?? true) && (
                <div className="settings-row ml-4 mt-3 pl-3 border-l-2 border-border">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="autoRevealLanguages"
                      className="text-sm font-medium"
                    >
                      {t('autoRevealLanguages')}
                    </Label>
                    <p className="text-muted-xs">
                      {t('autoRevealLanguagesDescription')}
                    </p>
                  </div>
                  <Switch
                    id="autoRevealLanguages"
                    checked={courseSettings.autoRevealLanguages ?? true}
                    onCheckedChange={handleAutoRevealLanguagesChange}
                    className="mt-0.5"
                  />
                </div>
              )}
            </div>
          )}

          {/* Hide base languages + sub-setting — audio mode only */}
          {reviewMode === 'audio' && (
            <div className="space-y-0">
              <div className="settings-row">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="hideBaseLanguages"
                    className="text-sm font-medium"
                  >
                    {t('hideBaseLanguages')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('hideBaseLanguagesDescription')}
                  </p>
                </div>
                <Switch
                  id="hideBaseLanguages"
                  checked={courseSettings.hideBaseLanguages === true}
                  onCheckedChange={handleHideBaseLanguagesChange}
                  className="mt-0.5"
                />
              </div>

              {/* Auto-reveal — visually indented as a sub-setting */}
              {courseSettings.hideBaseLanguages === true && (
                <div className="settings-row ml-4 mt-3 pl-3 border-l-2 border-border">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="autoRevealBaseLanguages"
                      className="text-sm font-medium"
                    >
                      {t('autoRevealBaseLanguages')}
                    </Label>
                    <p className="text-muted-xs">
                      {t('autoRevealBaseLanguagesDescription')}
                    </p>
                  </div>
                  <Switch
                    id="autoRevealBaseLanguages"
                    checked={courseSettings.autoRevealBaseLanguages ?? true}
                    onCheckedChange={handleAutoRevealBaseLanguagesChange}
                    className="mt-0.5"
                  />
                </div>
              )}
            </div>
          )}

          {/* Hide base languages + reveal-on-submit sub-setting — writing mode
              only (independent of the audio-mode pair above) */}
          {reviewMode === 'full' && (
            <div className="space-y-0">
              <div className="settings-row">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="hideBaseLanguagesFull"
                    className="text-sm font-medium"
                  >
                    {t('hideBaseLanguages')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('hideBaseLanguagesDescription')}
                  </p>
                </div>
                <Switch
                  id="hideBaseLanguagesFull"
                  checked={courseSettings.hideBaseLanguagesFull ?? isTranscribe}
                  onCheckedChange={handleHideBaseLanguagesFullChange}
                  className="mt-0.5"
                />
              </div>

              {/* Auto-reveal on submit — visually indented as a sub-setting */}
              {(courseSettings.hideBaseLanguagesFull ?? isTranscribe) && (
                <div className="settings-row ml-4 mt-3 pl-3 border-l-2 border-border">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="autoRevealBaseOnSubmit"
                      className="text-sm font-medium"
                    >
                      {t('autoRevealBaseOnSubmit')}
                    </Label>
                    <p className="text-muted-xs">
                      {t('autoRevealBaseOnSubmitDescription')}
                    </p>
                  </div>
                  <Switch
                    id="autoRevealBaseOnSubmit"
                    checked={courseSettings.autoRevealBaseOnSubmit ?? true}
                    onCheckedChange={handleAutoRevealBaseOnSubmitChange}
                    className="mt-0.5"
                  />
                </div>
              )}
            </div>
          )}

          {/* Show romanization — only when a language on this course actually
              has a Latin transliteration to show. Hiding the control leaves the
              stored value untouched: course languages are editable from this
              same sheet, so clearing it would silently reset the preference
              every time a language was removed and re-added. A stale `true` is
              inert anyway — every consumer is gated on the translation
              carrying a `romanization`, which the server only ever populates
              for romanized languages. */}
          {courseSupportsRomanization && (
            <div className="settings-row">
              <div className="space-y-0.5">
                <Label htmlFor="showRomanization" className="text-sm font-medium">
                  {t('showRomanization')}
                </Label>
                <p className="text-muted-xs">
                  {t('showRomanizationDescription')}
                </p>
              </div>
              <Switch
                id="showRomanization"
                checked={courseSettings.showRomanization ?? true}
                onCheckedChange={handleShowRomanizationChange}
                className="mt-0.5"
              />
            </div>
          )}

          {/* Show progress bar */}
          <div className="settings-row">
            <div className="space-y-0.5">
              <Label htmlFor="showProgressBar" className="text-sm font-medium">
                {t('showProgressBar')}
              </Label>
              <p className="text-muted-xs">{t('showProgressBarDescription')}</p>
            </div>
            <Switch
              id="showProgressBar"
              checked={courseSettings.showProgressBar ?? true}
              onCheckedChange={handleShowProgressBarChange}
              className="mt-0.5"
            />
          </div>

        </div>

        {/* Rendered INSIDE SheetContent so its portal events bubble through
            this Sheet's React tree — otherwise Radix sees focus moving into
            the nested course-settings Sheet as a focus-outside and dismisses
            this Sheet behind it (the whole settings view then appears to
            close when the nested sheet is closed). */}
        <CourseLanguageSettings
          course={courseSettingsOpen ? courseData : null}
          onClose={() => setCourseSettingsOpen(false)}
          showArchiveButton={false}
        />
      </SheetContent>
    </Sheet>
  );
}
