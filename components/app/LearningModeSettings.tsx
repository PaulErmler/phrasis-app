'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useUpdateCourseSettings } from '@/hooks/use-update-course-settings';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  clampPlaybackSpeed,
} from '@/lib/constants/audioPlayback';
import { MAX_CARDS_PER_BATCH } from '@/lib/constants/learning';
import { resolveLanguageOrder } from '@/lib/utils/languageOrder';
import {
  languageNeedsIpa,
  languageNeedsRomanization,
  languageMarksSpeakerGender,
  getLocalizedLanguageNameByCode,
} from '@/lib/languages';
import { courseMarksSpeakerGender } from '@/lib/speakerGender';
import { capture, CLIENT_EVENTS } from '@/lib/posthog/events';

interface LearningModeSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseSettings: CourseSettings | null;
  baseLanguages: string[];
  targetLanguages: string[];
}

interface SettingSwitchRowProps {
  id: string;
  label: string;
  /** When omitted, the row renders the Label directly (no space-y-0.5 wrapper). */
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visually indent as a sub-setting. */
  indented?: boolean;
}

/** One Label(+description)/Switch settings row. */
function SettingSwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  indented,
}: SettingSwitchRowProps) {
  return (
    <div
      className={
        indented
          ? 'settings-row ml-4 mt-3 pl-3 border-l-2 border-border'
          : 'settings-row'
      }
    >
      {description !== undefined ? (
        <div className="space-y-0.5">
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
          <p className="text-muted-xs">{description}</p>
        </div>
      ) : (
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
      )}
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
      />
    </div>
  );
}

/**
 * One selectable listening-duration strategy: radio + title/description, with
 * an optional inline stepper for the strategy's X. The inactive rows dim and
 * their steppers are inert (clicking anywhere on the row selects it instead).
 */
function ListeningStrategyRow({
  value,
  active,
  title,
  description,
  stepper,
}: {
  value: string;
  active: boolean;
  title: string;
  description: string;
  stepper?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border p-2.5 transition-colors cursor-pointer',
        active ? 'border-primary/40 bg-primary/5' : 'opacity-60 hover:opacity-90',
      )}
      data-testid={`listening-strategy-${value}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <RadioGroupItem value={value} className="shrink-0" />
        <div className="space-y-0.5 min-w-0">
          <span className="text-sm font-medium leading-none block">{title}</span>
          <p className="text-muted-xs">{description}</p>
        </div>
      </div>
      {stepper != null && (
        <div className={cn('shrink-0', !active && 'pointer-events-none')}>
          {stepper}
        </div>
      )}
    </label>
  );
}

interface TimelineLanguageListProps {
  languages: string[];
  keyPrefix: string;
  type: 'base' | 'target';
  reps: Record<string, number>;
  repPauses: Record<string, number>;
  speeds: Record<string, number>;
  defaultReps: number;
  onPlaysChange: (language: string, value: number) => void;
  onRepPauseChange: (language: string, value: number) => void;
  onSpeedChange: (language: string, value: number) => void;
  repPauseLabel: string;
  speedLabel: string;
  pauseLabel: string;
  /** Between-language pause connector value + handler. */
  pauseSeconds: number;
  onPauseChange: (value: number) => void;
  onMoveUp: (idx: number) => void;
  onMoveDown: (idx: number) => void;
}

/**
 * One timeline group: a card per language with a pause connector between
 * consecutive languages. Returns a fragment so it adds no DOM node.
 */
function TimelineLanguageList({
  languages,
  keyPrefix,
  type,
  reps,
  repPauses,
  speeds,
  defaultReps,
  onPlaysChange,
  onRepPauseChange,
  onSpeedChange,
  repPauseLabel,
  speedLabel,
  pauseLabel,
  pauseSeconds,
  onPauseChange,
  onMoveUp,
  onMoveDown,
}: TimelineLanguageListProps) {
  return (
    <>
      {languages.map((code, idx) => {
        const plays = reps[code] ?? defaultReps;
        const repPause = repPauses[code] ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;
        const nextCode = languages[idx + 1];
        const nextPlays = nextCode ? (reps[nextCode] ?? defaultReps) : 0;

        return (
          <div
            key={`${keyPrefix}${code}`}
            className="w-full flex flex-col items-center"
          >
            <TimelineLanguageCard
              code={code}
              type={type}
              plays={plays}
              repPause={repPause}
              speed={speeds[code] ?? DEFAULT_PLAYBACK_SPEED}
              onPlaysChange={(v) => onPlaysChange(code, v)}
              onRepPauseChange={(v) => onRepPauseChange(code, v)}
              onSpeedChange={(v) => onSpeedChange(code, v)}
              repPauseLabel={repPauseLabel}
              speedLabel={speedLabel}
              showReorderButtons={languages.length > 1}
              canMoveUp={idx > 0}
              canMoveDown={idx < languages.length - 1}
              onMoveUp={() => onMoveUp(idx)}
              onMoveDown={() => onMoveDown(idx)}
            />

            {/* Pause connector between consecutive languages */}
            {idx < languages.length - 1 && (
              <StepperPauseConnector
                label={pauseLabel}
                seconds={pauseSeconds}
                onChange={onPauseChange}
                lineOnly={plays === 0 || nextPlays === 0}
              />
            )}
          </div>
        );
      })}
    </>
  );
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
  const updateSettings = useUpdateCourseSettings();
  const locale = useLocale();
  const ensureUpcomingAllModes = useMutation(
    api.features.decks.ensureUpcomingCardsContentAllModes,
  );

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
  const courseSupportsIpa = [...baseProp, ...targetProp].some(languageNeedsIpa);
  // Speaker-gender preference: offered only when a course language actually
  // marks speaker gender (config-driven; also carries the feature kill
  // switch). Same hide-don't-clear reasoning as romanization above.
  const courseSupportsSpeakerGender = courseMarksSpeakerGender(
    baseProp,
    targetProp,
  );
  const speakerGenderLanguageNames = [
    ...new Set(
      [...baseProp, ...targetProp]
        .filter(languageMarksSpeakerGender)
        .map((code) => getLocalizedLanguageNameByCode(code, locale)),
    ),
  ];

  // ---- existing setting handlers ----

  const handleSpeakerGenderChange = async (value: string) => {
    if (value !== 'male' && value !== 'female' && value !== 'mixed') return;
    await updateSettings({
      courseId: courseSettings.courseId,
      speakerGenderPreference: value,
    });
    capture(CLIENT_EVENTS.SPEAKER_GENDER_CHANGED, { preference: value });
    // Regenerate the upcoming-card window right away so the next reviews
    // already match the new voice/grammar; everything else fills lazily as
    // cards are prepared (both variants stay cached, so switching back is
    // free). Fire-and-forget: a failure just means the ensure pass on the
    // next learn-view mount does the same work.
    void ensureUpcomingAllModes({}).catch(() => {});
  };

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

  const handleShowCardOriginChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      showCardOrigin: checked,
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

  const handleShowIpaChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      showIpa: checked,
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
    const clamped = clampPlaybackSpeed(value);
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
    const clamped = clampPlaybackSpeed(value);
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
    const clamped = clampPlaybackSpeed(value);
    const current = courseSettings.transcribeAfterPlaybackSpeeds ?? {};
    await updateSettings({
      courseId: courseSettings.courseId,
      transcribeAfterPlaybackSpeeds: { ...current, [language]: clamped },
    });
  };

  // Listening-duration strategy: when does a card graduate from Practice
  // Listening to Practice Speaking? Writing the strategy also normalizes a
  // legacy ∞ rep window (stored 0) to 1 when switching onto 'onlyNew', since
  // "continuously" is its own strategy now and 0 would contradict it.
  const handleListeningStrategyChange = async (value: string) => {
    const strategy = value as 'onlyNew' | 'untilGood' | 'continuous';
    await updateSettings({
      courseId: courseSettings.courseId,
      targetBeforeListeningStrategy: strategy,
      ...(strategy === 'onlyNew' && !(onlyNewStored && onlyNewStored > 0)
        ? { targetBeforeOnlyNewReps: 1 }
        : {}),
    });
  };

  // "Only new" rep window: integer 1-10 (∞ lives on the 'continuous' strategy).
  const handleTargetBeforeOnlyNewChange = async (value: number) => {
    const clamped = Math.min(10, Math.max(1, Math.floor(value)));
    await updateSettings({
      courseId: courseSettings.courseId,
      targetBeforeOnlyNewReps: clamped,
    });
  };

  // "Until rated Good" threshold: integer 1-10.
  const handleTargetBeforeUntilGoodChange = async (value: number) => {
    const clamped = Math.min(10, Math.max(1, Math.floor(value)));
    await updateSettings({
      courseId: courseSettings.courseId,
      targetBeforeUntilGoodReps: clamped,
    });
  };

  // ---- "Show translation on new sentences" (writing mode) ----

  const handleShowTranslationOnNewChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      showTranslationOnNew: checked,
    });
  };

  // Same stored window semantics as targetBeforeOnlyNewReps: 0 = ∞, 1-10.
  const handleShowTranslationOnlyNewChange = async (value: number) => {
    const clamped = value <= 0 ? 0 : Math.min(10, Math.max(1, Math.floor(value)));
    await updateSettings({
      courseId: courseSettings.courseId,
      showTranslationOnlyNewReps: clamped,
    });
  };

  // ---- review mode handlers ----

  const handleReviewModeChange = async (mode: 'audio' | 'full') => {
    await updateSettings({
      courseId: courseSettings.courseId,
      reviewMode: mode,
    });
  };

  // Split scheduling: each mode keeps its own per-card review schedule.
  // Enabling triggers a server-side seed of the writing track (copy of the
  // current schedule); disabling just freezes it, nothing is deleted.
  const handleSeparateModeTrackingChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      separateModeTracking: checked,
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

  // Writing-mode "Hide base languages". Independent of the audio-mode pair;
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
  // the writing modes (once is enough when the learner is typing), mirrors
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
  // Listening-duration strategy. Docs from before the strategy field encode
  // "continuously" as onlyNewReps 0/undefined. Mirror resolveAudioSettings'
  // legacy inference so the radio selection always matches actual playback.
  const onlyNewStored = courseSettings.targetBeforeOnlyNewReps;
  const listeningStrategy =
    courseSettings.targetBeforeListeningStrategy ??
    (onlyNewStored && onlyNewStored > 0 ? 'onlyNew' : 'continuous');
  // Per-strategy X values. "Only new" no longer owns an ∞ position (that is
  // the 'continuous' strategy now), so its stepper floors at 1.
  const onlyNewUiValue =
    onlyNewStored && onlyNewStored > 0 ? Math.min(10, onlyNewStored) : 1;
  const untilGoodUiValue = Math.min(
    10,
    Math.max(1, courseSettings.targetBeforeUntilGoodReps ?? 1),
  );
  // The after-base target section shows in audio mode only when "Practice
  // Speaking" is on; full mode keeps its existing "always" gating (the
  // before/after toggles don't apply there, see useLearningAudio). Transcribe
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
            {/* Split scheduling: on = each mode keeps its own per-card
                spaced-repetition schedule; off = both modes share one
                schedule (the historical behavior). */}
            <SettingSwitchRow
              id="separateModeTracking"
              label={t('separateModeTracking')}
              description={t('separateModeTrackingDescription')}
              checked={courseSettings.separateModeTracking === true}
              onCheckedChange={handleSeparateModeTrackingChange}
            />
          </div>

          {/* Writing style. Sub-switcher shown when Writing is selected:
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

          {/* Initial reviews. Audio mode only */}
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
          <SettingSwitchRow
            id="autoAdd"
            label={t('autoAddCards')}
            description={t('autoAddCardsDescription')}
            checked={courseSettings.autoAddCards !== false}
            onCheckedChange={handleAutoAddChange}
          />

          {/* Auto-advance. Audio mode only */}
          {reviewMode === 'audio' && (
            <SettingSwitchRow
              id="autoAdvance"
              label={t('autoAdvance')}
              description={t('autoAdvanceDescription')}
              checked={autoAdvance}
              onCheckedChange={handleAutoAdvanceChange}
            />
          )}

          {/* Instant proceed on rating, both modes */}
          <SettingSwitchRow
            id="instantProceed"
            label={t('instantProceed')}
            description={t('instantProceedDescription')}
            checked={instantProceed}
            onCheckedChange={handleInstantProceedChange}
          />

          {/* Show every-N-cards celebration screen */}
          <SettingSwitchRow
            id="progressDisplayEnabled"
            label={t('progressDisplayEnabled')}
            description={t('progressDisplayEnabledDescription')}
            checked={courseSettings.progressDisplayEnabled !== false}
            onCheckedChange={handleProgressDisplayEnabledChange}
          />

          {/* Writing-mode scoring: how the accuracy percentage is computed, and
              what it then does with the rating. Both are writing-only, but this
              section is shared with audio mode, hence the guard. */}
          {reviewMode === 'full' && (
            <>
              {/* "Show translation on new sentences". The copy-through assist:
                  the answer is displayed above the input on a card's first N
                  reviews. Defaults on / N = 1; the stepper's ∞ position (0)
                  keeps the translation visible on every review. */}
              <div className="space-y-0">
                <SettingSwitchRow
                  id="showTranslationOnNew"
                  label={t('showTranslationOnNew')}
                  description={t('showTranslationOnNewDescription')}
                  checked={courseSettings.showTranslationOnNew ?? true}
                  onCheckedChange={handleShowTranslationOnNewChange}
                />

                {(courseSettings.showTranslationOnNew ?? true) && (
                  <div className="settings-row ml-4 mt-3 pl-3 border-l-2 border-border">
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="showTranslationOnlyNewReps"
                        className="text-sm font-medium"
                      >
                        {t('onlyNew')}
                      </Label>
                      <p className="text-muted-xs">
                        {t('showTranslationOnlyNewDescription')}
                      </p>
                    </div>
                    <StepperControl
                      value={courseSettings.showTranslationOnlyNewReps ?? 1}
                      min={0}
                      max={10}
                      onChange={handleShowTranslationOnlyNewChange}
                      formatValue={(v) => (v <= 0 ? '∞' : String(v))}
                    />
                  </div>
                )}
              </div>

              <SettingSwitchRow
                id="ignorePunctuation"
                label={t('ignorePunctuation')}
                description={t('ignorePunctuationDescription')}
                checked={courseSettings.ignorePunctuation ?? false}
                onCheckedChange={handleIgnorePunctuationChange}
              />

              <div className="space-y-0">
                <SettingSwitchRow
                  id="autoRateFromAccuracy"
                  label={t('autoRateFromAccuracy')}
                  description={t('autoRateFromAccuracyDescription')}
                  checked={courseSettings.autoRateFromAccuracy ?? true}
                  onCheckedChange={handleAutoRateFromAccuracyChange}
                />

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
          <SettingSwitchRow
            id="highlightWords"
            label={t('highlightWords')}
            description={t('highlightWordsDescription')}
            checked={highlightWords}
            onCheckedChange={handleHighlightWordsChange}
          />

          {/* Auto-play audio */}
          <SettingSwitchRow
            id="autoPlayAudio"
            label={t('autoPlay')}
            description={t(
              isTranscribe
                ? 'autoPlayDescriptionTranscribe'
                : 'autoPlayDescription',
            )}
            checked={autoPlay}
            onCheckedChange={handleAutoPlayChange}
          />

          {/* Practice Listening / Speaking. Target before/after base (audio mode only).
              At least one must stay enabled; toggling the last-on one auto-enables
              the other. */}
          {reviewMode === 'audio' && (
            <>
              <SettingSwitchRow
                id="playTargetAfterBase"
                label={t('practiceSpeaking')}
                description={t('practiceSpeakingDescription')}
                checked={playTargetAfter}
                onCheckedChange={handlePlayTargetAfterBaseChange}
              />

              <SettingSwitchRow
                id="playTargetBeforeBase"
                label={t('practiceListening')}
                description={t('practiceListeningDescription')}
                checked={playTargetBefore}
                onCheckedChange={handlePlayTargetBeforeBaseChange}
              />

              {/* Listening duration, when a card graduates from Practice
                  Listening to Practice Speaking. Only shows (and only takes
                  effect) when BOTH are on: 'continuous' is the no-graduation
                  strategy, the old "Only new = ∞" position. */}
              {playTargetBefore && playTargetAfter && (
                <div className="ml-4 mt-3 pl-3 border-l-2 border-border space-y-2">
                  <RadioGroup
                    value={listeningStrategy}
                    onValueChange={handleListeningStrategyChange}
                    className="space-y-2"
                  >
                    <ListeningStrategyRow
                      value="onlyNew"
                      active={listeningStrategy === 'onlyNew'}
                      title={t('strategyOnlyNew')}
                      description={t('strategyOnlyNewDescription')}
                      stepper={
                        <StepperControl
                          value={onlyNewUiValue}
                          min={1}
                          max={10}
                          onChange={handleTargetBeforeOnlyNewChange}
                        />
                      }
                    />
                    <ListeningStrategyRow
                      value="untilGood"
                      active={listeningStrategy === 'untilGood'}
                      title={t('strategyUntilGood')}
                      description={t('strategyUntilGoodDescription')}
                      stepper={
                        <StepperControl
                          value={untilGoodUiValue}
                          min={1}
                          max={10}
                          onChange={handleTargetBeforeUntilGoodChange}
                        />
                      }
                    />
                    <ListeningStrategyRow
                      value="continuous"
                      active={listeningStrategy === 'continuous'}
                      title={t('strategyContinuous')}
                      description={t('strategyContinuousDescription')}
                    />
                  </RadioGroup>
                </div>
              )}
            </>
          )}

          {/* Target language audio. Full review mode only. Hidden in
              transcribe, where the merged target audio IS the prompt and this
              setting is ignored. */}
          {reviewMode === 'full' && !isTranscribe && (
            <div className="space-y-0">
              <SettingSwitchRow
                id="targetAudioEnabled"
                label={t('fullReviewTargetAudio')}
                description={t('fullReviewTargetAudioDescription')}
                checked={fullReviewTargetAudioMode !== 'never'}
                onCheckedChange={(checked) => {
                  handleFullReviewTargetAudioModeChange(
                    checked ? 'afterSubmit' : 'never',
                  );
                }}
              />

              {fullReviewTargetAudioMode !== 'never' && (
                <div className="ml-4 mt-3 pl-3 border-l-2 border-border space-y-3">
                  <SettingSwitchRow
                    id="targetAudio_afterSubmit"
                    label={t('fullReviewTargetAudio_afterSubmit')}
                    checked={fullReviewTargetAudioMode === 'afterSubmit'}
                    onCheckedChange={(checked) => {
                      if (checked)
                        handleFullReviewTargetAudioModeChange('afterSubmit');
                    }}
                  />

                  <SettingSwitchRow
                    id="targetAudio_always"
                    label={t('fullReviewTargetAudio_always')}
                    checked={fullReviewTargetAudioMode === 'always'}
                    onCheckedChange={(checked) => {
                      if (checked)
                        handleFullReviewTargetAudioModeChange('always');
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* ================================================================
              AUDIO PLAYBACK PREVIEW
              ================================================================ */}

          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('audioPlaybackPreview')}
          </p>

          <div className="flex flex-col items-center gap-0 py-1">
            {/* Before-base target languages ("Practice Listening"), shown above
                base when the toggle is on. Reps/pauses/speed are independent of
                the after-base group. */}
            {showBeforeTarget && targetLanguages.length > 0 && (
              <>
                <TimelineLanguageList
                  languages={targetLanguages}
                  keyPrefix="before-target-"
                  type="target"
                  reps={beforeReps}
                  repPauses={beforeRepPauses}
                  speeds={beforeSpeeds}
                  defaultReps={DEFAULT_REPETITIONS_TARGET_BEFORE}
                  onPlaysChange={handleTargetBeforeRepetitionChange}
                  onRepPauseChange={handleTargetBeforeRepetitionPauseChange}
                  onSpeedChange={handleTargetBeforeSpeedChange}
                  repPauseLabel={t('pauseBetweenRepetitions')}
                  speedLabel={t('playbackSpeed')}
                  pauseLabel={t('pause')}
                  pauseSeconds={pauseT2T}
                  onPauseChange={handlePauseTargetToTargetChange}
                  onMoveUp={moveTargetUp}
                  onMoveDown={moveTargetDown}
                />

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
            {showBaseTimeline && (
              <TimelineLanguageList
                languages={baseLanguages}
                keyPrefix="base-"
                type="base"
                reps={reps}
                repPauses={repPauses}
                speeds={speeds}
                defaultReps={DEFAULT_REPETITIONS_BASE}
                onPlaysChange={handleRepetitionChange}
                onRepPauseChange={handleRepetitionPauseChange}
                onSpeedChange={handleLanguageSpeedChange}
                repPauseLabel={t('pauseBetweenRepetitions')}
                speedLabel={t('playbackSpeed')}
                pauseLabel={t('pause')}
                pauseSeconds={pauseB2B}
                onPauseChange={handlePauseBaseToBaseChange}
                onMoveUp={moveBaseUp}
                onMoveDown={moveBaseDown}
              />
            )}

            {/* After-base target languages ("Practice Speaking"), shown when
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
                <TimelineLanguageList
                  languages={targetLanguages}
                  keyPrefix="target-"
                  type="target"
                  reps={reps}
                  repPauses={repPauses}
                  speeds={speeds}
                  defaultReps={defaultTargetReps}
                  onPlaysChange={handleRepetitionChange}
                  onRepPauseChange={handleRepetitionPauseChange}
                  onSpeedChange={handleLanguageSpeedChange}
                  repPauseLabel={t('pauseBetweenRepetitions')}
                  speedLabel={t('playbackSpeed')}
                  pauseLabel={t('pause')}
                  pauseSeconds={pauseT2T}
                  onPauseChange={handlePauseTargetToTargetChange}
                  onMoveUp={moveTargetUp}
                  onMoveDown={moveTargetDown}
                />
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

          {/* Hide target languages + sub-setting. Audio mode only */}
          {reviewMode === 'audio' && (
            <div className="space-y-0">
              <SettingSwitchRow
                id="hideTargetLanguages"
                label={t('hideTargetLanguages')}
                description={t('hideTargetLanguagesDescription')}
                checked={courseSettings.hideTargetLanguages ?? true}
                onCheckedChange={handleHideTargetLanguagesChange}
              />

              {/* Auto-reveal. Visually indented as a sub-setting */}
              {(courseSettings.hideTargetLanguages ?? true) && (
                <SettingSwitchRow
                  id="autoRevealLanguages"
                  label={t('autoRevealLanguages')}
                  description={t('autoRevealLanguagesDescription')}
                  checked={courseSettings.autoRevealLanguages ?? true}
                  onCheckedChange={handleAutoRevealLanguagesChange}
                  indented
                />
              )}
            </div>
          )}

          {/* Hide base languages + sub-setting. Audio mode only */}
          {reviewMode === 'audio' && (
            <div className="space-y-0">
              <SettingSwitchRow
                id="hideBaseLanguages"
                label={t('hideBaseLanguages')}
                description={t('hideBaseLanguagesDescription')}
                checked={courseSettings.hideBaseLanguages === true}
                onCheckedChange={handleHideBaseLanguagesChange}
              />

              {/* Auto-reveal. Visually indented as a sub-setting */}
              {courseSettings.hideBaseLanguages === true && (
                <SettingSwitchRow
                  id="autoRevealBaseLanguages"
                  label={t('autoRevealBaseLanguages')}
                  description={t('autoRevealBaseLanguagesDescription')}
                  checked={courseSettings.autoRevealBaseLanguages ?? true}
                  onCheckedChange={handleAutoRevealBaseLanguagesChange}
                  indented
                />
              )}
            </div>
          )}

          {/* Hide base languages + reveal-on-submit sub-setting. Writing mode
              only (independent of the audio-mode pair above) */}
          {reviewMode === 'full' && (
            <div className="space-y-0">
              <SettingSwitchRow
                id="hideBaseLanguagesFull"
                label={t('hideBaseLanguages')}
                description={t('hideBaseLanguagesDescription')}
                checked={courseSettings.hideBaseLanguagesFull ?? isTranscribe}
                onCheckedChange={handleHideBaseLanguagesFullChange}
              />

              {/* Auto-reveal on submit. Visually indented as a sub-setting */}
              {(courseSettings.hideBaseLanguagesFull ?? isTranscribe) && (
                <SettingSwitchRow
                  id="autoRevealBaseOnSubmit"
                  label={t('autoRevealBaseOnSubmit')}
                  description={t('autoRevealBaseOnSubmitDescription')}
                  checked={courseSettings.autoRevealBaseOnSubmit ?? true}
                  onCheckedChange={handleAutoRevealBaseOnSubmitChange}
                  indented
                />
              )}
            </div>
          )}

          {/* Show romanization, only when a language on this course actually
              has a Latin transliteration to show. Hiding the control leaves the
              stored value untouched: course languages are editable from this
              same sheet, so clearing it would silently reset the preference
              every time a language was removed and re-added. A stale `true` is
              inert anyway. Every consumer is gated on the translation
              carrying a `romanization`, which the server only ever populates
              for romanized languages. */}
          {courseSupportsRomanization && (
            <SettingSwitchRow
              id="showRomanization"
              label={t('showRomanization')}
              description={t('showRomanizationDescription')}
              checked={courseSettings.showRomanization ?? true}
              onCheckedChange={handleShowRomanizationChange}
            />
          )}

          {/* Show IPA. Same hide-don't-clear reasoning as romanization above.
              Nearly every language has an espeak voice, so in practice this
              row shows for all courses except pure ja/fil ones. Defaults OFF,
              IPA is a specialist aid and shouldn't appear unasked. */}
          {courseSupportsIpa && (
            <SettingSwitchRow
              id="showIpa"
              label={t('showIpa')}
              description={t('showIpaDescription')}
              checked={courseSettings.showIpa ?? false}
              onCheckedChange={handleShowIpaChange}
            />
          )}

          {/* Speaker-gender preference. Only when a course language marks
              speaker gender (see speakerGenderMarking in lib/languages.ts);
              Mixed = the per-sentence 50/50 default. Sentences the user
              added themselves keep their detected speaker (never rewritten),
              which the scope note spells out. */}
          {courseSupportsSpeakerGender && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">
                    {t('speakerGender')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('speakerGenderDescription')}
                  </p>
                </div>
                <RadioGroup
                  value={courseSettings.speakerGenderPreference ?? 'mixed'}
                  onValueChange={handleSpeakerGenderChange}
                  className="space-y-2"
                >
                  {(
                    [
                      ['mixed', 'speakerGenderMixed', 'speakerGenderMixedDescription'],
                      ['female', 'speakerGenderFemale', 'speakerGenderFemaleDescription'],
                      ['male', 'speakerGenderMale', 'speakerGenderMaleDescription'],
                    ] as const
                  ).map(([value, labelKey, descriptionKey]) => (
                    <div key={value} className="flex items-start gap-3">
                      <RadioGroupItem
                        value={value}
                        id={`speakerGender-${value}`}
                        className="mt-0.5"
                      />
                      <div className="space-y-0.5">
                        <Label
                          htmlFor={`speakerGender-${value}`}
                          className="text-sm font-medium"
                        >
                          {t(labelKey)}
                        </Label>
                        <p className="text-muted-xs">{t(descriptionKey)}</p>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
                <p className="text-muted-xs">
                  {t('speakerGenderScopeNote', {
                    languages: speakerGenderLanguageNames.join(', '),
                  })}
                </p>
              </div>
            </>
          )}

          {/* Show progress bar */}
          <SettingSwitchRow
            id="showProgressBar"
            label={t('showProgressBar')}
            description={t('showProgressBarDescription')}
            checked={courseSettings.showProgressBar ?? true}
            onCheckedChange={handleShowProgressBarChange}
          />

          {/* Show card origin (source-collection pill on the card header) */}
          <SettingSwitchRow
            id="showCardOrigin"
            label={t('showCardOrigin')}
            description={t('showCardOriginDescription')}
            checked={courseSettings.showCardOrigin ?? false}
            onCheckedChange={handleShowCardOriginChange}
          />

        </div>

        {/* Rendered INSIDE SheetContent so its portal events bubble through
            this Sheet's React tree, otherwise Radix sees focus moving into
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
