'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useUpdateCourseSettings } from '@/hooks/use-update-course-settings';
import {
  resolveAudioSettings,
  resolveModeSetting,
  type AudioSettingsMode,
} from '@/lib/audio/mergeAudio';
import {
  MODE_COPIES,
  MODE_WRITE_CHAIN,
  type ModeCopyBaseField,
  type ModeCopySuffix,
} from '@/lib/audio/modeCopies';
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
import {
  X,
  Headphones,
  PenLine,
  Settings2,
  Languages,
  Ear,
  Radio as RadioIcon,
} from 'lucide-react';
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
  DEFAULT_REPETITIONS_BASE,
  DEFAULT_REPETITIONS_TARGET_BEFORE,
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_PLAYBACK_SPEED,
  clampPlaybackSpeed,
} from '@/lib/constants/audioPlayback';
import { MAX_CARDS_PER_BATCH } from '@/lib/constants/learning';
import {
  clampInitialReviewCount,
  MAX_INITIAL_REVIEW_COUNT,
  MIN_INITIAL_REVIEW_COUNT,
} from '@/lib/scheduling';
import { resolveLanguageOrder } from '@/lib/utils/languageOrder';
import { resolveShowFurigana } from '@/lib/furigana';
import {
  getLocalizedLanguageNameByCode,
  languageNeedsFurigana,
  languageNeedsIpa,
  languageNeedsRomanization,
} from '@/lib/languages';

import { reportError } from '@/lib/report-error';

interface LearningModeSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseSettings: CourseSettings | null;
  baseLanguages: string[];
  targetLanguages: string[];
}

/**
 * The fields `updateCourseSettings` accepts, minus the routing arg. Derived
 * from the mutation (and therefore from `coursePatchableSettingsValidator`)
 * so `setField`/`setFields` reject unknown field names at compile time.
 */
type CourseSettingsPatch = Omit<
  Parameters<ReturnType<typeof useUpdateCourseSettings>>[0],
  'courseId'
>;

interface SettingSwitchRowProps {
  id: string;
  label: string;
  /** When omitted, the row renders the Label directly (no space-y-0.5 wrapper). */
  description?: string;
  /**
   * Display names of the course languages this setting applies to, shown as
   * chips under the description. Used by the language-specific section, where
   * a setting stays a single course-wide switch but the user needs to see
   * which of their languages it affects.
   */
  languages?: string[];
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
  languages,
  checked,
  onCheckedChange,
  indented,
}: SettingSwitchRowProps) {
  const languageChips =
    languages !== undefined && languages.length > 0 ? (
      <div className="flex flex-wrap gap-1 pt-1">
        {languages.map((name) => (
          <span
            key={name}
            className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            {name}
          </span>
        ))}
      </div>
    ) : null;
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
          {languageChips}
        </div>
      ) : (
        <div>
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
          {languageChips}
        </div>
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
        active
          ? 'border-primary/40 bg-primary/5'
          : 'opacity-60 hover:opacity-90',
      )}
      data-testid={`listening-strategy-${value}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <RadioGroupItem value={value} className="shrink-0" />
        <div className="space-y-0.5 min-w-0">
          <span className="text-sm font-medium leading-none block">
            {title}
          </span>
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
  /** Caption above every card in the group (e.g. "Listening Practice"). */
  cardLabel?: string;
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
  cardLabel,
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
              label={cardLabel}
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
  // Existing generic settings-save failure string, reused by `setFields`
  // below rather than adding a near-duplicate key to the catalog.
  const tSaveError = useTranslations('AppPage.courses.manage');
  const locale = useLocale();
  const [courseSettingsOpen, setCourseSettingsOpen] = useState(false);
  // The scope the running session is actually playing, read from the same
  // signal as `resolveSettingsMode` on the audio side. Opening the sheet
  // mid-Radio-session therefore lands on the copy the user is hearing: the
  // steppers, the preview timeline and the audio all agree, and a nudge can't
  // write to the copy nothing is playing.
  const liveScope: 'review' | 'radio' =
    courseSettings?.schedulingMode === 'radio' ? 'radio' : 'review';
  // Which copy of the playback settings the sheet is editing while the Radio
  // split is on. Purely local: it selects the fields the controls write, and
  // never touches `schedulingMode`, so opening settings can't change what the
  // user is about to do. Null = follow the session; the pill sets it, and
  // closing the sheet clears it so the next open follows the session again.
  const [scopeOverride, setScopeOverride] = useState<'review' | 'radio' | null>(
    null,
  );
  const audioScope = scopeOverride ?? liveScope;
  const updateSettings = useUpdateCourseSettings();

  useEffect(() => {
    if (!open) setScopeOverride(null);
  }, [open]);

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
  // course's actual language lists, so the gates can't be affected by a future
  // change to how ordering is resolved. Each list drives one row of the
  // language-specific section: the row renders only when at least one course
  // language supports the setting, and the list itself is shown as chips so
  // the user can see which of their languages the switch affects.
  const courseLanguages = [...new Set([...baseProp, ...targetProp])];
  const romanizationLanguages = courseLanguages.filter(
    languageNeedsRomanization,
  );
  const ipaLanguages = courseLanguages.filter(languageNeedsIpa);
  const furiganaLanguages = courseLanguages.filter(languageNeedsFurigana);
  const toLanguageNames = (codes: string[]) =>
    codes.map((code) => getLocalizedLanguageNameByCode(code, locale));

  // ---- shared write path ----

  // Every control writes through here: one place owns the mutation call, so a
  // failed update (whose optimistic patch has already rolled back, visibly
  // snapping the control) surfaces as a toast instead of an unhandled
  // rejection. Reuses the generic settings-save error string.
  const setFields = async (fields: CourseSettingsPatch) => {
    try {
      await updateSettings({ courseId: courseSettings.courseId, ...fields });
    } catch (error) {
      reportError(error, { op: 'updateCourseSettings' });
      toast.error(tSaveError('saveFailed'));
    }
  };
  // Single-field convenience over `setFields`. The generic ties the value to
  // the named field's type; the cast only bridges TS's widening of computed
  // single-key literals (microsoft/TypeScript#13948).
  const setField = <K extends keyof CourseSettingsPatch>(
    field: K,
    value: CourseSettingsPatch[K],
  ) => setFields({ [field]: value } as Pick<CourseSettingsPatch, K>);

  // ---- setting handlers with extra logic ----
  // Plain one-field writes have no named handler; their controls call
  // `setField` straight from the JSX. Everything below keeps a handler
  // because it guards/clamps, writes coupled fields, or picks the field
  // variant for the current review mode.

  const handleBatchSizeChange = (value: number) => {
    if (value < 1 || value > MAX_CARDS_PER_BATCH) return;
    void setField('cardsToAddBatchSize', value);
  };

  // Clamped, not rejected — `clampInitialReviewCount` is the contract on every
  // write path. Dropping the write instead would strand a stored value above
  // the max: `StepperControl` disables its minus at `value >= max`, so the
  // control would freeze with no way back into range.
  const handleInitialReviewsChange = (value: number) => {
    void setField('initialReviewCount', clampInitialReviewCount(value));
  };

  // ---- audio playback setting handlers ----
  // Each mode writes its own copy of a playback field, so the modes stay
  // independent. Record handlers spread the *effective* map (mode-resolved,
  // see the resolved-values section below), so a mode's first edit snapshots
  // the inherited values for every language instead of dropping them.

  // The field name the current mode writes for `field`. See MODE_COPIES.
  const modeFieldName = <K extends ModeCopyBaseField>(
    field: K,
  ): K | `${K}${ModeCopySuffix}` => {
    const copies: readonly ModeCopySuffix[] = MODE_COPIES[field];
    for (const copy of MODE_WRITE_CHAIN[settingsMode]) {
      if (copies.includes(copy)) return `${field}${copy}`;
    }
    return field;
  };

  // Single-field write against the current mode's copy. A computed key
  // widens to a string index, so this call cannot check the field name
  // itself; the guard is the `satisfies` clause on MODE_COPIES, which checks
  // every listed suffix against the schema, so each name `modeFieldName`
  // can produce is a real CourseSettings column.
  const setModeField = <K extends ModeCopyBaseField>(
    field: K,
    value: CourseSettings[K],
  ) => setFields({ [modeFieldName(field)]: value });

  const handleAutoPlayChange = (checked: boolean) =>
    setModeField('autoPlayAudio', checked);

  const handleHighlightWordsChange = (checked: boolean) =>
    setModeField('highlightWords', checked);

  const handleHideTargetLanguagesChange = (checked: boolean) =>
    setFields({
      hideTargetLanguages: checked,
      ...(!checked && { autoRevealLanguages: false }),
    });

  const handleHideBaseLanguagesChange = (checked: boolean) =>
    setFields({
      hideBaseLanguages: checked,
      ...(!checked && { autoRevealBaseLanguages: false }),
    });

  const handleRepetitionChange = (language: string, value: number) => {
    if (value < 0 || value > 10) return;
    const next = { ...reps, [language]: value };
    if (listeningWouldBeAlone(next, playTargetBefore, playTargetAfter)) {
      rejectListeningOnly();
      return;
    }
    void setModeField('languageRepetitions', next);
  };

  const handleRepetitionPauseChange = (language: string, value: number) => {
    if (value < 0 || value > 30) return;
    const next = { ...repPauses, [language]: value };
    void setModeField('languageRepetitionPauses', next);
  };

  const handleLanguageSpeedChange = (language: string, value: number) => {
    void setModeField('languagePlaybackSpeeds', {
      ...speeds,
      [language]: clampPlaybackSpeed(value),
    });
  };

  const handlePauseBaseToBaseChange = (value: number) => {
    if (value < 0 || value > 30) return;
    void setModeField('pauseBaseToBase', value);
  };

  const handlePauseBaseToTargetChange = (value: number) => {
    if (value < 0 || value > 30) return;
    void setModeField('pauseBaseToTarget', value);
  };

  const handlePauseTargetToTargetChange = (value: number) => {
    if (value < 0 || value > 30) return;
    void setModeField('pauseTargetToTarget', value);
  };

  const handlePauseBeforeAutoAdvanceChange = (value: number) => {
    if (value < 0 || value > 10) return;
    void setModeField('pauseBeforeAutoAdvance', value);
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
  // Reads and writes the CURRENT mode's copies (mode-resolved `beforeReps` etc.
  // in, `modeFieldName` out), so enabling Listening under the Radio scope seeds
  // Radio's before-group from Radio's target settings and leaves Review's alone.
  const beforeSeedIfEmpty = () =>
    Object.keys(beforeReps).length === 0 &&
    Object.keys(beforeRepPauses).length === 0 &&
    Object.keys(beforeSpeeds).length === 0
      ? {
          [modeFieldName('targetBeforeRepetitions')]: { ...reps },
          [modeFieldName('targetBeforeRepetitionPauses')]: { ...repPauses },
          [modeFieldName('targetBeforePlaybackSpeeds')]: { ...speeds },
        }
      : {};

  const handlePlayTargetBeforeBaseChange = (checked: boolean) => {
    // Turning Listening OFF needs no guard: it only removes the listening
    // group (and auto-enables Speaking when that was off too), so nothing
    // outside listening practice gets quieter.
    if (checked && listeningWouldBeAlone(reps, true, playTargetAfter)) {
      rejectListeningOnly();
      return;
    }
    return setFields({
      [modeFieldName('playTargetBeforeBase')]: checked,
      // Cannot disable both: if turning this off while "after" is already off,
      // auto-enable "after".
      ...(!checked && !playTargetAfter
        ? { [modeFieldName('playTargetAfterBase')]: true }
        : {}),
      // Mirror current target settings on first enable.
      ...(checked ? beforeSeedIfEmpty() : {}),
    });
  };

  const handlePlayTargetAfterBaseChange = (checked: boolean) => {
    // Turning Speaking off always leaves Listening on: either it already was,
    // or the write below auto-enables it because both cannot be off. Guard
    // against the state the write produces, not the current one, or an
    // all-0x base with Listening off would slip through and come back as
    // listening-only.
    if (!checked && listeningWouldBeAlone(reps, true, false)) {
      rejectListeningOnly();
      return;
    }
    return setFields({
      [modeFieldName('playTargetAfterBase')]: checked,
      // Cannot disable both: auto-enable "before" (and seed it) when turning
      // this off while "before" is already off.
      ...(!checked && !playTargetBefore
        ? {
            [modeFieldName('playTargetBeforeBase')]: true,
            ...beforeSeedIfEmpty(),
          }
        : {}),
    });
  };

  const handleTargetBeforeRepetitionChange = (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 10) return;
    void setModeField('targetBeforeRepetitions', {
      ...beforeReps,
      [language]: value,
    });
  };

  const handleTargetBeforeRepetitionPauseChange = (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 30) return;
    void setModeField('targetBeforeRepetitionPauses', {
      ...beforeRepPauses,
      [language]: value,
    });
  };

  const handleTargetBeforeSpeedChange = (language: string, value: number) => {
    void setModeField('targetBeforePlaybackSpeeds', {
      ...beforeSpeeds,
      [language]: clampPlaybackSpeed(value),
    });
  };

  const handlePauseTargetToBaseChange = (value: number) => {
    if (value < 0 || value > 30) return;
    void setModeField('pauseTargetToBase', value);
  };

  // ---- transcribe post-submit replay group ("Translation Entered") ----

  const handleTranscribeAfterRepetitionChange = (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 10) return;
    void setField('transcribeAfterRepetitions', {
      ...(courseSettings.transcribeAfterRepetitions ?? {}),
      [language]: value,
    });
  };

  const handleTranscribeAfterRepetitionPauseChange = (
    language: string,
    value: number,
  ) => {
    if (value < 0 || value > 30) return;
    void setField('transcribeAfterRepetitionPauses', {
      ...(courseSettings.transcribeAfterRepetitionPauses ?? {}),
      [language]: value,
    });
  };

  const handleTranscribeAfterSpeedChange = (
    language: string,
    value: number,
  ) => {
    void setField('transcribeAfterPlaybackSpeeds', {
      ...(courseSettings.transcribeAfterPlaybackSpeeds ?? {}),
      [language]: clampPlaybackSpeed(value),
    });
  };

  // Listening-duration strategy: when does a card graduate from Practice
  // Listening to Practice Speaking? Writing the strategy also normalizes a
  // legacy ∞ rep window (stored 0) to 1 when switching onto 'onlyNew', since
  // "continuously" is its own strategy now and 0 would contradict it.
  const handleListeningStrategyChange = (value: string) => {
    const strategy = value as 'onlyNew' | 'untilGood' | 'continuous';
    void setFields({
      [modeFieldName('targetBeforeListeningStrategy')]: strategy,
      ...(strategy === 'onlyNew' && !(onlyNewStored && onlyNewStored > 0)
        ? { [modeFieldName('targetBeforeOnlyNewReps')]: 1 }
        : {}),
    });
  };

  // "Only new" rep window: integer 1-10 (∞ lives on the 'continuous' strategy).
  const handleTargetBeforeOnlyNewChange = (value: number) =>
    setModeField(
      'targetBeforeOnlyNewReps',
      Math.min(10, Math.max(1, Math.floor(value))),
    );

  // "Until rated Good" threshold: integer 1-10.
  const handleTargetBeforeUntilGoodChange = (value: number) =>
    setModeField(
      'targetBeforeUntilGoodReps',
      Math.min(10, Math.max(1, Math.floor(value))),
    );

  // "Show translation on new sentences" (writing mode). Same stored window
  // semantics as targetBeforeOnlyNewReps: 0 = ∞, 1-10.
  const handleShowTranslationOnlyNewChange = (value: number) =>
    setField(
      'showTranslationOnlyNewReps',
      value <= 0 ? 0 : Math.min(10, Math.max(1, Math.floor(value))),
    );

  // Writing-mode "Hide base languages". Independent of the audio-mode pair;
  // its sub-setting reveals on submit (not on audio playback).
  const handleHideBaseLanguagesFullChange = (checked: boolean) =>
    setFields({
      hideBaseLanguagesFull: checked,
      ...(!checked && { autoRevealBaseOnSubmit: false }),
    });

  // ---- resolved values (with defaults) ----

  const reviewMode = courseSettings.reviewMode ?? 'audio';
  const isFull = reviewMode === 'full';
  const fullReviewTargetAudioMode =
    courseSettings.fullReviewTargetAudioMode ?? 'afterSubmit';
  const writingInputMode = courseSettings.writingInputMode ?? 'translate';
  const isTranscribe = isFull && writingInputMode === 'transcribe';
  // Radio is the hands-free face of Shadowing, so its split only exists in
  // audio mode. `audioScope` is ignored (and the pill hidden) while the split
  // is off, which is what makes turning it off fall straight back to the
  // shared review values.
  const splitRadio = courseSettings.separateRadioSettings === true;
  const isRadioScope = !isFull && splitRadio && audioScope === 'radio';
  const settingsMode: AudioSettingsMode = isTranscribe
    ? 'transcribe'
    : isFull
      ? 'full'
      : isRadioScope
        ? 'radio'
        : 'audio';
  // Each mode edits its own copy of the playback settings; the effective value
  // resolves `*Transcribe ?? *Full ?? unsuffixed` for the writing modes and
  // `*Radio ?? unsuffixed` for radio, so an untweaked mode shows (and seeds its
  // first write from) the mode it inherits from.
  // Resolved through the SAME code path as actual playback
  // (useLearningAudio → resolveAudioSettings), so the preview timeline and
  // the merged audio can never disagree. Includes the playback defaults,
  // the legacy listening-strategy inference, and defaultTargetReps (2x in
  // audio mode, 1x in the writing modes).
  const {
    reps,
    repPauses,
    speeds,
    pauseB2B,
    pauseB2T,
    pauseT2T,
    defaultTargetReps,
    playTargetBefore,
    playTargetAfter,
    beforeReps,
    beforeRepPauses,
    beforeSpeeds,
    pauseT2B,
    autoAdvance,
    pauseBeforeAdvance,
    listeningStrategy,
  } = resolveAudioSettings(courseSettings, undefined, settingsMode);
  const autoPlay =
    resolveModeSetting(courseSettings, 'autoPlayAudio', settingsMode) ??
    DEFAULT_AUTO_PLAY;
  const highlightWords =
    resolveModeSetting(courseSettings, 'highlightWords', settingsMode) === true;
  // Transcribe post-submit replay group (independent of the pre-submit prompt).
  const transcribeAfterReps = courseSettings.transcribeAfterRepetitions ?? {};
  const transcribeAfterRepPauses =
    courseSettings.transcribeAfterRepetitionPauses ?? {};
  const transcribeAfterSpeeds =
    courseSettings.transcribeAfterPlaybackSpeeds ?? {};
  // Raw "Only new" window, read by handleListeningStrategyChange's legacy-∞
  // normalization and the stepper below (the resolved settings map it to
  // Infinity, which is not what the 1-10 stepper displays).
  const onlyNewStored = resolveModeSetting(
    courseSettings,
    'targetBeforeOnlyNewReps',
    settingsMode,
  );
  // Per-strategy X values. "Only new" no longer owns an ∞ position (that is
  // the 'continuous' strategy now), so its stepper floors at 1.
  const onlyNewUiValue =
    onlyNewStored && onlyNewStored > 0 ? Math.min(10, onlyNewStored) : 1;
  const untilGoodUiValue = Math.min(
    10,
    Math.max(
      1,
      resolveModeSetting(
        courseSettings,
        'targetBeforeUntilGoodReps',
        settingsMode,
      ) ?? 1,
    ),
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

  // "Practice Listening" can never be the only thing that plays. Its group
  // drops out of a card once the listening strategy graduates it, and a card
  // whose base and after-base groups are all at 0x would then play nothing at
  // all. Every write that could reach that state (a rep stepped to 0, the
  // Listening toggle turned on over an all-0x timeline, the Speaking toggle
  // turned off with base at 0x) is refused with a toast instead. Audio mode
  // only: the writing modes ignore the before/after toggles.
  const listeningWouldBeAlone = (
    nextReps: Record<string, number>,
    nextPlayTargetBefore: boolean,
    nextPlayTargetAfter: boolean,
  ) => {
    if (reviewMode !== 'audio' || !nextPlayTargetBefore) return false;
    let audible = 0;
    for (const code of baseLanguages) {
      audible += nextReps[code] ?? DEFAULT_REPETITIONS_BASE;
    }
    if (nextPlayTargetAfter) {
      for (const code of targetLanguages) {
        audible += nextReps[code] ?? defaultTargetReps;
      }
    }
    return audible === 0;
  };
  const rejectListeningOnly = () => {
    toast.error(t('listeningOnlyBlocked'));
  };
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
    void setField('baseLanguageOrder', swap(baseLanguages, idx, idx - 1));
  };
  const moveBaseDown = (idx: number) => {
    void setField('baseLanguageOrder', swap(baseLanguages, idx, idx + 1));
  };
  const moveTargetUp = (idx: number) => {
    void setField('targetLanguageOrder', swap(targetLanguages, idx, idx - 1));
  };
  const moveTargetDown = (idx: number) => {
    void setField('targetLanguageOrder', swap(targetLanguages, idx, idx + 1));
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
            onChange={(mode) => setField('reviewMode', mode)}
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
              onCheckedChange={(checked) =>
                setField('separateModeTracking', checked)
              }
            />
            {/* Split playback settings: on = Radio edits its own `*Radio`
                copies; off = Radio reads the shared review values. The copies
                are left in place when it goes off (freeze-and-keep, like
                separateModeTracking), so re-enabling resumes where the user
                left off. Shadowing only: Radio is the hands-free face of
                audio mode, and free play while typing is Free Study, which
                keeps the writing settings. */}
            {!isFull && (
              <SettingSwitchRow
                id="separateRadioSettings"
                label={t('separateRadioSettings')}
                description={t('separateRadioSettingsDescription')}
                checked={splitRadio}
                onCheckedChange={(checked) => {
                  // Leaving the scope on 'radio' with the split off would
                  // strand the sheet editing a copy nothing reads. Clearing
                  // the override also hands the scope back to the session.
                  if (!checked) setScopeOverride(null);
                  void setField('separateRadioSettings', checked);
                }}
              />
            )}
          </div>

          {/* Audio scope. The Shadowing counterpart of the Writing style
              sub-switcher below: same slot, same markup. Selects which copy of
              the playback settings the sheet edits, and writes nothing itself.
              `schedulingMode` is untouched, so opening settings never changes
              which mode the user is about to run. */}
          {!isFull && splitRadio && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {t('audioSettingsFor')}
              </p>
              <div className="flex w-full rounded-lg border bg-muted/50 p-1">
                <button
                  type="button"
                  onClick={() => setScopeOverride('review')}
                  data-testid="settings-scope-review"
                  className={cn(
                    'flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap',
                    !isRadioScope
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Headphones className="h-4 w-4" />
                  {t('audioScopeReview')}
                </button>
                <button
                  type="button"
                  onClick={() => setScopeOverride('radio')}
                  data-testid="settings-scope-radio"
                  className={cn(
                    'flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap',
                    isRadioScope
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <RadioIcon className="h-4 w-4" />
                  {t('audioScopeRadio')}
                </button>
              </div>
              <p className="text-muted-xs">
                {t(
                  isRadioScope
                    ? 'audioScopeRadioDescription'
                    : 'audioScopeReviewDescription',
                )}
              </p>
            </div>
          )}

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
                  onClick={() => setField('writingInputMode', 'translate')}
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
                  onClick={() => setField('writingInputMode', 'transcribe')}
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

          {/* Initial reviews. Audio mode only, and not under the Radio scope:
              free play has no FSRS scheduling. */}
          {reviewMode === 'audio' && !isRadioScope && (
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
                  min={MIN_INITIAL_REVIEW_COUNT}
                  max={MAX_INITIAL_REVIEW_COUNT}
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
            onCheckedChange={(checked) => setField('autoAddCards', checked)}
          />

          {/* Auto-advance. Audio mode only. Radio forces it on, so the switch
              would be a lie under the Radio scope. */}
          {reviewMode === 'audio' && !isRadioScope && (
            <SettingSwitchRow
              id="autoAdvance"
              label={t('autoAdvance')}
              description={t('autoAdvanceDescription')}
              checked={autoAdvance}
              onCheckedChange={(checked) => setField('autoAdvance', checked)}
            />
          )}

          {/* Instant proceed on rating, both modes. Radio never rates, so the
              switch does nothing there — but it's the Shadowing copy either
              way and the Radio split doesn't fork it, so it stays visible
              under both scopes rather than becoming unreachable mid-Radio
              (the pill follows the live session, see `liveScope`). Contrast
              auto-advance and auto-play above, which Radio FORCES on: showing
              those under the Radio scope would show a switch that lies. */}
          <SettingSwitchRow
            id="instantProceed"
            label={t('instantProceed')}
            description={t('instantProceedDescription')}
            checked={instantProceed}
            onCheckedChange={(checked) =>
              setField(
                isFull ? 'instantProceedFull' : 'instantProceedAudio',
                checked,
              )
            }
          />

          {/* Show every-N-cards celebration screen. One global field with no
              per-mode copy at all, so the Radio scope has nothing to say about
              it — hiding it there would strand a global setting behind a pill. */}
          <SettingSwitchRow
            id="progressDisplayEnabled"
            label={t('progressDisplayEnabled')}
            description={t('progressDisplayEnabledDescription')}
            checked={courseSettings.progressDisplayEnabled !== false}
            onCheckedChange={(checked) =>
              setField('progressDisplayEnabled', checked)
            }
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
                  onCheckedChange={(checked) =>
                    setField('showTranslationOnNew', checked)
                  }
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
                onCheckedChange={(checked) =>
                  setField('ignorePunctuation', checked)
                }
              />

              <SettingSwitchRow
                id="aiWritingFeedback"
                label={t('aiWritingFeedback')}
                description={t(
                  isTranscribe
                    ? 'aiWritingFeedbackDescriptionTranscribe'
                    : 'aiWritingFeedbackDescription',
                )}
                checked={courseSettings.aiWritingFeedback ?? true}
                onCheckedChange={(checked) =>
                  setField('aiWritingFeedback', checked)
                }
              />

              <div className="space-y-0">
                <SettingSwitchRow
                  id="autoRateFromAccuracy"
                  label={t('autoRateFromAccuracy')}
                  description={t('autoRateFromAccuracyDescription')}
                  checked={courseSettings.autoRateFromAccuracy ?? true}
                  onCheckedChange={(checked) =>
                    setField('autoRateFromAccuracy', checked)
                  }
                />

                {(courseSettings.autoRateFromAccuracy ?? true) && (
                  <div className="ml-4 mt-3 pl-3 border-l-2 border-border">
                    <AutoRateThresholdControl
                      thresholds={courseSettings.autoRateThresholds}
                      onCommit={(next) => setField('autoRateThresholds', next)}
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

          {/* Auto-play audio. Radio forces it on (useLearningAudio), so the
              switch is hidden rather than shown lying. */}
          {!isRadioScope && (
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
          )}

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
                    {/* Shown under the Radio scope too. Radio plays never
                        rate a card, so they can't advance the count — but the
                        count a card already carries still graduates it there
                        (applyOnlyNewListening reads the stored
                        goodReviewCount), so hiding the row would leave an
                        inherited 'untilGood' silently in charge. */}
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
                onCheckedChange={(checked) =>
                  setField(
                    'fullReviewTargetAudioMode',
                    checked ? 'afterSubmit' : 'never',
                  )
                }
              />

              {fullReviewTargetAudioMode !== 'never' && (
                <div className="ml-4 mt-3 pl-3 border-l-2 border-border space-y-3">
                  <SettingSwitchRow
                    id="targetAudio_afterSubmit"
                    label={t('fullReviewTargetAudio_afterSubmit')}
                    checked={fullReviewTargetAudioMode === 'afterSubmit'}
                    onCheckedChange={(checked) => {
                      if (checked)
                        void setField(
                          'fullReviewTargetAudioMode',
                          'afterSubmit',
                        );
                    }}
                  />

                  <SettingSwitchRow
                    id="targetAudio_always"
                    label={t('fullReviewTargetAudio_always')}
                    checked={fullReviewTargetAudioMode === 'always'}
                    onCheckedChange={(checked) => {
                      if (checked)
                        void setField('fullReviewTargetAudioMode', 'always');
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
                  cardLabel={t('listeningPracticeLabel')}
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
                {showBaseTimeline &&
                  baseLanguages.length > 0 &&
                  targetLanguages.length > 0 && (
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

            {/* Pause before auto-advance. Audio mode only, and only when
                auto-advance actually happens: the user's switch under the
                Review scope, unconditionally under Radio (which forces it). */}
            {reviewMode === 'audio' &&
              (autoAdvance || isRadioScope) &&
              (baseLanguages.length > 0 || targetLanguages.length > 0) && (
                <StepperPauseConnector
                  label={t('pauseBeforeAutoAdvance')}
                  seconds={pauseBeforeAdvance}
                  onChange={handlePauseBeforeAutoAdvanceChange}
                  accent
                />
              )}

            {/* End-of-sequence indicator. Same gate as the pause stepper
                above: Radio forces auto-advance, so the "no auto-advance" end
                marker would contradict the stepper right above it. */}
            <div className="mt-2 flex items-center gap-2 text-muted-xs">
              {reviewMode === 'audio' && (autoAdvance || isRadioScope) ? (
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
                  onCheckedChange={(checked) =>
                    setField('autoRevealLanguages', checked)
                  }
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
                  onCheckedChange={(checked) =>
                    setField('autoRevealBaseLanguages', checked)
                  }
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
                  onCheckedChange={(checked) =>
                    setField('autoRevealBaseOnSubmit', checked)
                  }
                  indented
                />
              )}
            </div>
          )}

          {/* Show progress bar */}
          <SettingSwitchRow
            id="showProgressBar"
            label={t('showProgressBar')}
            description={t('showProgressBarDescription')}
            checked={courseSettings.showProgressBar ?? true}
            onCheckedChange={(checked) => setField('showProgressBar', checked)}
          />

          {/* Show card origin (source-collection pill on the card header) */}
          <SettingSwitchRow
            id="showCardOrigin"
            label={t('showCardOrigin')}
            description={t('showCardOriginDescription')}
            checked={courseSettings.showCardOrigin ?? false}
            onCheckedChange={(checked) => setField('showCardOrigin', checked)}
          />

          {/* ================================================================
              LANGUAGE-SPECIFIC SETTINGS
              ================================================================
              One row per script/pronunciation aid, rendered only when at
              least one course language supports it; the supporting languages
              are shown as chips on the row (each setting stays a single
              course-wide switch — see SettingSwitchRowProps.languages).
              Absent entirely when no course language has any.

              Hide-don't-clear: a hidden row leaves the stored value
              untouched. Course languages are editable from this same sheet,
              so clearing would silently reset the preference every time a
              language was removed and re-added. A stale `true` is inert
              anyway — every consumer is gated on the translation actually
              carrying the annotation, which the server only populates for
              supported languages.

              IPA defaults OFF: it is a specialist aid and shouldn't appear
              unasked. Romanization and furigana default ON — they are the
              expected reading help for their scripts. */}
          {romanizationLanguages.length > 0 ||
          ipaLanguages.length > 0 ||
          furiganaLanguages.length > 0 ? (
            <>
              <Separator />
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {t('languageSettings')}
              </p>
              {romanizationLanguages.length > 0 && (
                <SettingSwitchRow
                  id="showRomanization"
                  label={t('showRomanization')}
                  description={t('showRomanizationDescription')}
                  languages={toLanguageNames(romanizationLanguages)}
                  checked={courseSettings.showRomanization ?? true}
                  onCheckedChange={(checked) =>
                    setField('showRomanization', checked)
                  }
                />
              )}
              {ipaLanguages.length > 0 && (
                <SettingSwitchRow
                  id="showIpa"
                  label={t('showIpa')}
                  description={t('showIpaDescription')}
                  languages={toLanguageNames(ipaLanguages)}
                  checked={courseSettings.showIpa ?? false}
                  onCheckedChange={(checked) => setField('showIpa', checked)}
                />
              )}
              {furiganaLanguages.length > 0 && (
                <SettingSwitchRow
                  id="showFurigana"
                  label={t('showFurigana')}
                  description={t('showFuriganaDescription')}
                  languages={toLanguageNames(furiganaLanguages)}
                  checked={resolveShowFurigana(courseSettings)}
                  onCheckedChange={(checked) =>
                    setField('showFurigana', checked)
                  }
                />
              )}
            </>
          ) : null}
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
