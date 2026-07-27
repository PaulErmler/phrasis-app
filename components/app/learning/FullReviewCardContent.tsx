'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, FileText, Undo2 } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { AudioButton } from './AudioButton';
import { CardShell } from './CardShell';
import { CardSpeedBadge } from './CardSpeedBadge';
import {
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_PLAYBACK_SPEED,
} from '@/lib/constants/audioPlayback';
import { DiffDisplay, computeAccuracy } from './DiffDisplay';
import { ClickableWords } from './ClickableWords';
import {
  getLanguageByCode,
  getLocalizedLanguageNameByCode,
  getTextDirection,
} from '@/lib/languages';
import { useButtonPlayback } from '@/hooks/use-button-playback';
import { useImeSafeEnter } from '@/hooks/use-ime-safe-enter';
import type { ButtonPlaybackActive } from '@/hooks/use-button-playback';
import { useActiveCue, type MergedPlayback } from '@/hooks/use-active-cue';
import type { ClockBinding } from '@/hooks/use-karaoke-index';
import type { CardTranslation, CardAudioRecording } from './types';
import type { Id } from '@/convex/_generated/dataModel';
import type { PinnableCardAction } from '@/lib/cardActions';

type TargetAudioMode = 'always' | 'afterSubmit' | 'never';

interface LanguageInputState {
  submitted: boolean;
  userText: string;
}

interface FullReviewCardContentProps {
  preReviewCount: number;
  /** When in FSRS phase, total reviews = preReviewCount + fsrsState.reps */
  schedulingPhase?: 'preReview' | 'review';
  fsrsState?: { reps: number } | null;
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
  isFavorite: boolean;
  isPendingMaster: boolean;
  isPendingHide: boolean;
  onMaster: () => void;
  onHide: () => void;
  onFavorite: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onFlag?: () => void;
  onRegenerateAudio?: () => void;
  pinnedActions?: readonly string[];
  onUpdatePinnedActions?: (actions: PinnableCardAction[]) => void;
  /** Per-action quota state forwarded to CardActionsMenu. */
  quotaState?: import('./CardActionsMenu').CardActionsMenuProps['quotaState'];
  onAudioPlay?: () => void;
  targetAudioMode: TargetAudioMode;
  /**
   * Transcribe writing style: the merged target audio is the prompt and the
   * user types what they hear (vs. translating the base text).
   */
  transcribeMode?: boolean;
  /** Blur base-language text ("Hide base languages", writing-mode setting). */
  hideBaseLanguages?: boolean;
  /** Un-blur base text once every target translation is submitted. */
  autoRevealBaseOnSubmit?: boolean;
  /** Exclude punctuation from the accuracy score ("Ignore punctuation"). */
  ignorePunctuation?: boolean;
  /**
   * Post-submit playback settings ("Translation Entered" timeline group), per
   * language. Missing entry = 1 play; speed falls back to the per-language
   * effective speed.
   */
  afterSubmitRepetitions?: Record<string, number>;
  afterSubmitRepetitionPauses?: Record<string, number>;
  afterSubmitPlaybackSpeeds?: Record<string, number>;
  /**
   * Never auto-start clip playback (e.g. while the settings sheet is open).
   * A settings change (writing style / target-audio mode) can otherwise make
   * an already-submitted input qualify for after-submit playback and blast
   * audio behind the sheet.
   */
  suppressAutoPlay?: boolean;
  allRevealed?: boolean;
  onAllSubmittedChange?: (allSubmitted: boolean) => void;
  onAccuracyChange?: (accuracy: number | null) => void;
  bare?: boolean;
  showRomanization?: boolean;
  /** Clears submission stack when the reviewed card changes */
  cardId?: Id<'cards'>;
  /** When true, Left Arrow revert is disabled (e.g. settings or edit dialog open) */
  shortcutsDisabled?: boolean;
  /** Karaoke word highlighting toggle (defaults true). */
  highlightEnabled?: boolean;
  /** Client-only session flag: did the viewer click flag on this card? */
  flaggedInSession?: boolean;
  /**
   * Merged-audio state from useAudioPlayer; used when merged playback is
   * active. Per-frame time lives in `clock`, not React state.
   */
  mergedPlayback?: MergedPlayback;
  /** Course-level per-language general speed. */
  languagePlaybackSpeeds?: Record<string, number>;
  /** Per-card per-language speed override. Absent entry = use general. */
  audioSpeedOverrides?: Record<string, number>;
  /** Cycle handler for the speed badge; null clears the override. */
  onSpeedCycle?: (language: string, next: number | null) => void;
  /** Merged-audio playback for the slim progress bar at the card's bottom edge. */
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  durationSec?: number;
  isPlaying?: boolean;
  isMerging?: boolean;
  onSeek?: (seconds: number) => void;
  showProgressBar?: boolean;
}

export function FullReviewCardContent({
  preReviewCount,
  schedulingPhase,
  fsrsState,
  sourceText,
  translations,
  audioRecordings,
  isFavorite,
  isPendingMaster,
  isPendingHide,
  onMaster,
  onHide,
  onFavorite,
  onEdit,
  onDelete,
  onFlag,
  onRegenerateAudio,
  pinnedActions,
  onUpdatePinnedActions,
  quotaState,
  onAudioPlay,
  targetAudioMode,
  transcribeMode = false,
  hideBaseLanguages = false,
  autoRevealBaseOnSubmit = true,
  ignorePunctuation = false,
  afterSubmitRepetitions,
  afterSubmitRepetitionPauses,
  afterSubmitPlaybackSpeeds,
  suppressAutoPlay = false,
  allRevealed = false,
  onAllSubmittedChange,
  onAccuracyChange,
  bare = false,
  showRomanization = true,
  cardId,
  shortcutsDisabled = false,
  highlightEnabled = true,
  flaggedInSession = false,
  mergedPlayback,
  languagePlaybackSpeeds,
  audioSpeedOverrides,
  onSpeedCycle,
  audioRef,
  durationSec,
  isPlaying,
  isMerging,
  onSeek,
  showProgressBar,
}: FullReviewCardContentProps) {
  const t = useTranslations('LearningMode');
  const locale = useLocale();

  const buttonPlayback = useButtonPlayback();
  // Merged playback resolves to the active cue at cue-change frequency; the
  // per-frame word position ticks inside the highlight leaves via
  // clockBinding (useKaraokeIndex) — no 60 fps re-render of this card.
  const mergedCue = useActiveCue(mergedPlayback);
  const activeClip = useMemo<ButtonPlaybackActive | null>(() => {
    if (mergedCue) return { language: mergedCue.language, localTime: 0 };
    return buttonPlayback.active;
  }, [mergedCue, buttonPlayback.active]);
  const clockBinding = useMemo<ClockBinding | undefined>(() => {
    if (!mergedCue || !mergedPlayback) return undefined;
    return {
      clock: mergedPlayback.clock,
      cueStartSec: mergedCue.cueStartSec,
      speed: mergedCue.speed,
    };
  }, [mergedCue, mergedPlayback]);

  // Reveal-sweep / post-submit auto-play uses raw <Audio> elements; route their
  // progress through the shared button-playback channel so <ClickableWords>
  // lights up just like it does for manual AudioButton clicks.
  const buttonTimeUpdateRef = useRef(buttonPlayback.onTimeUpdate);
  buttonTimeUpdateRef.current = buttonPlayback.onTimeUpdate;
  const buttonStopRef = useRef(buttonPlayback.onStop);
  buttonStopRef.current = buttonPlayback.onStop;

  const displayReviewCount =
    schedulingPhase === 'review' && fsrsState != null
      ? preReviewCount + fsrsState.reps
      : preReviewCount;

  const targetTranslations = translations.filter((tr) => tr.isTargetLanguage);
  const showLanguageLabel = targetTranslations.length > 1;

  const [inputs, setInputs] = useState<Map<string, LanguageInputState>>(
    () => new Map(targetTranslations.map((tr) => [tr.language, { submitted: false, userText: '' }])),
  );

  const [submissionOrder, setSubmissionOrder] = useState<string[]>([]);
  // Base languages the viewer manually un-blurred by tapping (only relevant
  // with "Hide base languages" on).
  const [manuallyRevealedBase, setManuallyRevealedBase] = useState<Set<string>>(
    () => new Set(),
  );

  const autoPlayedRef = useRef<Set<string>>(new Set());
  const revealAudioRef = useRef<HTMLAudioElement | null>(null);
  const revealAbortedRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const inputRefsByLanguage = useRef<Record<string, HTMLInputElement | null>>({});
  const submissionOrderRef = useRef<string[]>([]);
  submissionOrderRef.current = submissionOrder;

  const translationKey = translations.map((tr) => tr.language + tr.text).join('|');
  const [prevTranslationKey, setPrevTranslationKey] = useState(translationKey);
  if (translationKey !== prevTranslationKey) {
    setPrevTranslationKey(translationKey);
    setInputs(
      new Map(targetTranslations.map((tr) => [tr.language, { submitted: false, userText: '' }])),
    );
    setSubmissionOrder([]);
    setManuallyRevealedBase(new Set());
    autoPlayedRef.current = new Set();
  }

  useEffect(() => {
    setSubmissionOrder([]);
  }, [cardId]);

  const allSubmitted = targetTranslations.length > 0 &&
    targetTranslations.every((tr) => inputs.get(tr.language)?.submitted);

  const onAllSubmittedChangeRef = useRef(onAllSubmittedChange);
  onAllSubmittedChangeRef.current = onAllSubmittedChange;
  useEffect(() => {
    onAllSubmittedChangeRef.current?.(allSubmitted);
  }, [allSubmitted]);

  // Compute average accuracy across all target languages when all are submitted
  const onAccuracyChangeRef = useRef(onAccuracyChange);
  onAccuracyChangeRef.current = onAccuracyChange;
  useEffect(() => {
    if (!allSubmitted) {
      onAccuracyChangeRef.current?.(null);
      return;
    }
    let total = 0;
    let count = 0;
    for (const tr of targetTranslations) {
      const userText = inputs.get(tr.language)?.userText ?? '';
      total += computeAccuracy(
        tr.text,
        userText,
        tr.language,
        ignorePunctuation,
      );
      count++;
    }
    onAccuracyChangeRef.current?.(count > 0 ? Math.round(total / count) : null);
  }, [allSubmitted, inputs, targetTranslations, ignorePunctuation]);

  const onAudioPlayRef = useRef(onAudioPlay);
  onAudioPlayRef.current = onAudioPlay;
  const suppressAutoPlayRef = useRef(suppressAutoPlay);
  suppressAutoPlayRef.current = suppressAutoPlay;

  useEffect(() => {
    if (!allRevealed) return;
    // In afterSubmit mode, target clips play only from TargetLanguageInput on submit (see docs/review_modes).
    // A reveal sweep here duplicates that audio (e.g. last submit + full sequence). never disables target auto-play.
    if (targetAudioMode === 'afterSubmit' || targetAudioMode === 'never') return;

    const unsubmittedAudio = targetTranslations
      .filter((tr) => !inputs.get(tr.language)?.submitted)
      .map((tr) => ({
        language: tr.language,
        url: audioRecordings.find((a) => a.language === tr.language)?.url ?? null,
      }))
      .filter((entry): entry is { language: string; url: string } => entry.url != null);

    if (unsubmittedAudio.length === 0) return;

    // Settings change mid-card (e.g. switching target audio to 'always'
    // behind the open sheet): never start the sweep, and mark the entries
    // played so it doesn't fire when the sheet closes either.
    if (suppressAutoPlayRef.current) {
      for (const entry of unsubmittedAudio) {
        autoPlayedRef.current.add(entry.language);
      }
      return;
    }

    revealAbortedRef.current = false;
    onAudioPlayRef.current?.();

    let idx = 0;
    let raf = 0;
    let activeLanguage: string | null = null;

    const stopTracking = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (activeLanguage) {
        buttonStopRef.current(activeLanguage);
        activeLanguage = null;
      }
    };

    const playNext = () => {
      stopTracking();
      if (revealAbortedRef.current || idx >= unsubmittedAudio.length) {
        revealAudioRef.current = null;
        return;
      }
      const entry = unsubmittedAudio[idx];
      autoPlayedRef.current.add(entry.language);
      const audio = new Audio(entry.url);
      revealAudioRef.current = audio;
      activeLanguage = entry.language;
      const tick = () => {
        buttonTimeUpdateRef.current(entry.language, audio.currentTime);
        raf = requestAnimationFrame(tick);
      };
      audio.onended = () => {
        stopTracking();
        idx++;
        playNext();
      };
      audio
        .play()
        .then(() => {
          raf = requestAnimationFrame(tick);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') console.error('Reveal auto-play failed:', err);
          stopTracking();
          idx++;
          playNext();
        });
    };
    playNext();

    return () => {
      revealAbortedRef.current = true;
      stopTracking();
      revealAudioRef.current?.pause();
      revealAudioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRevealed, translationKey, targetAudioMode]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      firstInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [translationKey]);

  const handleInputChange = useCallback((language: string, text: string) => {
    setInputs((prev) => {
      const next = new Map(prev);
      next.set(language, { submitted: false, userText: text });
      return next;
    });
  }, []);

  const applyRevertToLanguage = useCallback((language: string) => {
    setInputs((prev) => {
      const current = prev.get(language);
      if (!current?.submitted) return prev;
      const next = new Map(prev);
      next.set(language, { submitted: false, userText: '' });
      return next;
    });
    autoPlayedRef.current.delete(language);
    requestAnimationFrame(() => {
      inputRefsByLanguage.current[language]?.focus({ preventScroll: true });
    });
  }, []);

  const revertLanguage = useCallback(
    (language: string) => {
      const prev = submissionOrderRef.current;
      const i = prev.lastIndexOf(language);
      if (i < 0) return;
      const next = [...prev];
      next.splice(i, 1);
      setSubmissionOrder(next);
      applyRevertToLanguage(language);
    },
    [applyRevertToLanguage],
  );

  const revertLastSubmitted = useCallback(() => {
    const prev = submissionOrderRef.current;
    if (prev.length === 0) return;
    const language = prev[prev.length - 1];
    setSubmissionOrder(prev.slice(0, -1));
    applyRevertToLanguage(language);
  }, [applyRevertToLanguage]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shortcutsDisabled || e.key !== 'ArrowLeft') return;
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (submissionOrderRef.current.length === 0) return;
      e.preventDefault();
      revertLastSubmitted();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcutsDisabled, revertLastSubmitted]);

  // "Hide base languages" (writing mode): blur base rows until every target is
  // submitted (when auto-reveal-on-submit is on), the post-rating reveal fires,
  // or the viewer taps a row. Revealing per submitted language would hand the
  // remaining inputs the meaning for free, so the signal is all-or-nothing.
  const revealBaseAll = (autoRevealBaseOnSubmit && allSubmitted) || allRevealed;
  const revealedBaseLanguages = useMemo<ReadonlySet<string>>(
    () =>
      revealBaseAll
        ? new Set(
          translations
            .filter((tr) => tr.isBaseLanguage)
            .map((tr) => tr.language),
        )
        : new Set<string>(),
    [revealBaseAll, translations],
  );
  const handleRevealBase = useCallback((language: string) => {
    setManuallyRevealedBase((prev) => {
      if (prev.has(language)) return prev;
      const next = new Set(prev);
      next.add(language);
      return next;
    });
  }, []);

  const handleSubmit = useCallback((language: string) => {
    setInputs((prev) => {
      const current = prev.get(language);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(language, { ...current, submitted: true });
      return next;
    });
    setSubmissionOrder((prev) => [...prev, language]);
  }, []);

  const assignInputRef = useCallback(
    (language: string, index: number) => (el: HTMLInputElement | null) => {
      inputRefsByLanguage.current[language] = el;
      if (index === 0) {
        firstInputRef.current = el;
      }
    },
    [],
  );

  return (
    <div data-tutorial="card-content-full" className="flex flex-col flex-1 min-h-0">
      <CardShell
        reviewCount={displayReviewCount}
        sourceText={sourceText}
        translations={translations}
        audioRecordings={audioRecordings}
        isFavorite={isFavorite}
        isPendingMaster={isPendingMaster}
        isPendingHide={isPendingHide}
        onMaster={onMaster}
        onHide={onHide}
        onFavorite={onFavorite}
        onEdit={onEdit}
        onDelete={onDelete}
        onFlag={onFlag}
        onRegenerateAudio={onRegenerateAudio}
        pinnedActions={pinnedActions}
        onUpdatePinnedActions={onUpdatePinnedActions}
        quotaState={quotaState}
        onAudioPlay={onAudioPlay}
        bare={bare}
        showRomanization={showRomanization}
        highlightEnabled={highlightEnabled}
        flaggedInSession={flaggedInSession}
        activeClip={activeClip}
        clockBinding={clockBinding}
        onButtonTimeUpdate={buttonPlayback.onTimeUpdate}
        onButtonStop={buttonPlayback.onStop}
        languagePlaybackSpeeds={languagePlaybackSpeeds}
        audioSpeedOverrides={audioSpeedOverrides}
        onSpeedCycle={onSpeedCycle}
        audioRef={audioRef}
        durationSec={durationSec}
        isPlaying={isPlaying}
        isMerging={isMerging}
        onSeek={onSeek}
        showProgressBar={showProgressBar}
        languageCues={mergedPlayback?.languageCues}
        hideBaseLanguages={hideBaseLanguages}
        autoRevealBaseLanguages={true}
        revealedLanguages={revealedBaseLanguages}
        manuallyRevealedLanguages={manuallyRevealedBase}
        onRevealLanguage={handleRevealBase}
      >
        {({ targetTranslations: targets }) => (
          <div className="space-y-4">
            {targets.map((translation, index) => {
              const audio = audioRecordings.find(
                (a) => a.language === translation.language,
              );
              const state = inputs.get(translation.language) ?? {
                submitted: false,
                userText: '',
              };

              const override =
                audioSpeedOverrides?.[translation.language] ?? null;
              const generalSpeed =
                languagePlaybackSpeeds?.[translation.language] ??
                DEFAULT_PLAYBACK_SPEED;
              const effectiveSpeed = override ?? generalSpeed;
              // Post-submit playback ("Translation Entered" group): missing
              // entry = play once at the effective speed.
              const afterSubmitPlayback = {
                reps: afterSubmitRepetitions?.[translation.language] ?? 1,
                pauseSec:
                  afterSubmitRepetitionPauses?.[translation.language] ??
                  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
                speed:
                  afterSubmitPlaybackSpeeds?.[translation.language] ??
                  effectiveSpeed,
              };

              return (
                <TargetLanguageInput
                  key={translation.language}
                  translation={translation}
                  audioUrl={audio?.url ?? null}
                  wordTimings={audio?.wordTimings ?? null}
                  state={state}
                  targetAudioMode={targetAudioMode}
                  autoPlayedRef={autoPlayedRef}
                  onInputChange={handleInputChange}
                  onSubmit={handleSubmit}
                  onRevert={() => revertLanguage(translation.language)}
                  onAudioPlay={onAudioPlay}
                  submitLabel={t('submitAnswer')}
                  placeholder={t(
                    transcribeMode ? 'typeTranscription' : 'typeTranslation',
                  )}
                  revertLabel={t('revertSubmission')}
                  revertTooltip={t('revertSubmissionTooltip')}
                  showLanguageLabel={showLanguageLabel}
                  locale={locale}
                  inputRef={assignInputRef(translation.language, index)}
                  autoFocus={index === 0}
                  isFirstTarget={index === 0}
                  allRevealed={allRevealed}
                  showRomanization={showRomanization}
                  ignorePunctuation={ignorePunctuation}
                  highlightEnabled={highlightEnabled}
                  activeClip={activeClip}
                  clockBinding={clockBinding}
                  onButtonTimeUpdate={buttonPlayback.onTimeUpdate}
                  onButtonStop={buttonPlayback.onStop}
                  speed={effectiveSpeed}
                  afterSubmitPlayback={afterSubmitPlayback}
                  suppressAutoPlay={suppressAutoPlay}
                  speedOverride={override}
                  generalSpeed={generalSpeed}
                  onSpeedCycle={
                    onSpeedCycle
                      ? (next) => onSpeedCycle(translation.language, next)
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </CardShell>
    </div>
  );
}

interface TargetLanguageInputProps {
  translation: CardTranslation;
  audioUrl: string | null;
  wordTimings: CardAudioRecording['wordTimings'];
  state: LanguageInputState;
  targetAudioMode: TargetAudioMode;
  autoPlayedRef: React.RefObject<Set<string>>;
  onInputChange: (language: string, text: string) => void;
  onSubmit: (language: string) => void;
  onRevert: () => void;
  onAudioPlay?: () => void;
  submitLabel: string;
  placeholder: string;
  revertLabel: string;
  revertTooltip: string;
  showLanguageLabel: boolean;
  locale: string;
  inputRef?: React.RefCallback<HTMLInputElement | null>;
  autoFocus?: boolean;
  isFirstTarget?: boolean;
  allRevealed?: boolean;
  showRomanization?: boolean;
  ignorePunctuation?: boolean;
  highlightEnabled: boolean;
  activeClip: ButtonPlaybackActive | null;
  clockBinding?: ClockBinding;
  onButtonTimeUpdate: (language: string, localTime: number) => void;
  onButtonStop: (language: string) => void;
  /** Effective playback speed (override ?? general ?? 1). */
  speed: number;
  /** Reps/pause/speed for the post-submit auto-play of this language. */
  afterSubmitPlayback: { reps: number; pauseSec: number; speed: number };
  /** Never auto-start after-submit playback (settings sheet open). */
  suppressAutoPlay?: boolean;
  /** Stored override value, or null when none is stored. */
  speedOverride: number | null;
  /** Course-level general speed for this language. */
  generalSpeed: number;
  /** Cycle handler; null clears the override. */
  onSpeedCycle?: (next: number | null) => void;
}

function TargetLanguageInput({
  translation,
  audioUrl,
  wordTimings,
  state,
  targetAudioMode,
  autoPlayedRef,
  onInputChange,
  onSubmit,
  onRevert,
  onAudioPlay,
  submitLabel,
  placeholder,
  revertLabel,
  revertTooltip,
  showLanguageLabel,
  locale,
  inputRef,
  autoFocus,
  isFirstTarget = false,
  allRevealed = false,
  showRomanization = true,
  ignorePunctuation = false,
  highlightEnabled,
  activeClip,
  clockBinding,
  onButtonTimeUpdate,
  onButtonStop,
  speed,
  afterSubmitPlayback,
  suppressAutoPlay = false,
  speedOverride,
  generalSpeed,
  onSpeedCycle,
}: TargetLanguageInputProps) {
  const isActive = activeClip?.language === translation.language;
  const t = useTranslations('LearningMode');
  const { compositionProps, isComposingEvent } = useImeSafeEnter();
  const [showClean, setShowClean] = useState(false);
  const autoPlayAudioRef = useRef<HTMLAudioElement | null>(null);
  // Read via ref inside the playback effect: the object is rebuilt each
  // render, and putting it in the deps would tear down a running clip.
  const afterSubmitPlaybackRef = useRef(afterSubmitPlayback);
  afterSubmitPlaybackRef.current = afterSubmitPlayback;

  useEffect(() => {
    if (!state.submitted) {
      setShowClean(false);
    }
  }, [state.submitted]);

  useEffect(() => {
    if (
      !state.submitted ||
      targetAudioMode !== 'afterSubmit' ||
      !audioUrl ||
      autoPlayedRef.current.has(translation.language)
    ) {
      return;
    }

    // A settings change (writing style / target-audio mode) can make an
    // already-submitted input qualify here while the sheet is open — never
    // start audio behind the sheet, and don't queue it for sheet-close.
    if (suppressAutoPlay) {
      autoPlayedRef.current.add(translation.language);
      return;
    }

    autoPlayedRef.current.add(translation.language);
    onAudioPlay?.();
    const audio = new Audio(audioUrl);
    audio.preservesPitch = true;
    const audioEl = audio as HTMLAudioElement & {
      webkitPreservesPitch?: boolean;
    };
    audioEl.webkitPreservesPitch = true;
    audio.playbackRate = afterSubmitPlaybackRef.current.speed;
    autoPlayAudioRef.current = audio;

    let raf = 0;
    let playsDone = 0;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      onButtonTimeUpdate(translation.language, audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    audio.onended = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      onButtonStop(translation.language);
      playsDone++;
      // Re-read reps/pause from the ref so timeline edits made mid-playback
      // apply to the remaining repetitions.
      const { reps, pauseSec } = afterSubmitPlaybackRef.current;
      if (playsDone < reps) {
        pauseTimer = setTimeout(() => {
          pauseTimer = null;
          audio.currentTime = 0;
          audio.playbackRate = afterSubmitPlaybackRef.current.speed;
          audio
            .play()
            .then(() => {
              raf = requestAnimationFrame(tick);
            })
            .catch((err) => {
              if (err.name !== 'AbortError')
                console.error('Auto-play failed:', err);
            });
        }, pauseSec * 1000);
      }
    };
    audio
      .play()
      .then(() => {
        raf = requestAnimationFrame(tick);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('Auto-play failed:', err);
      });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (pauseTimer) clearTimeout(pauseTimer);
      audio.pause();
      audio.currentTime = 0;
      onButtonStop(translation.language);
    };
  }, [state.submitted, targetAudioMode, audioUrl, translation.language, autoPlayedRef, suppressAutoPlay, onButtonTimeUpdate, onButtonStop]);

  // Keep an already-running afterSubmit auto-play element in sync when its
  // speed changes mid-playback. Mirrors the pattern in AudioButton; without
  // this the rate set at element creation is sticky for the life of that clip.
  useEffect(() => {
    if (autoPlayAudioRef.current) {
      autoPlayAudioRef.current.playbackRate = afterSubmitPlayback.speed;
    }
  }, [afterSubmitPlayback.speed]);

  useEffect(() => {
    return () => {
      autoPlayAudioRef.current?.pause();
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME users (ja/zh/ko/vi) press Enter to confirm a conversion — that
    // keystroke is typing, not a submit. See `useImeSafeEnter`.
    if (e.key === 'Enter' && !state.submitted && !isComposingEvent(e)) {
      e.preventDefault();
      onSubmit(translation.language);
    }
  };

  const languageDisplayName = showLanguageLabel
    ? getLocalizedLanguageNameByCode(translation.language, locale)
    : null;

  // BCP-47 tag (not the internal `zh_traditional`-style code) so the OS offers
  // the right IME / keyboard layout when this field is focused.
  const inputLang = getLanguageByCode(translation.language)?.displayCode;

  const hasUserText = !!state.userText.trim();

  if (allRevealed && !state.submitted) {
    return (
      <div
        className="space-y-1"
        {...(isFirstTarget ? { 'data-tutorial': 'target-input-full' } : {})}
      >
        {languageDisplayName ? (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {languageDisplayName}
            </span>
            <div className="flex items-center">
              <AudioButton
                url={audioUrl}
                language={translation.language}
                onPlay={onAudioPlay}
                onTimeUpdate={onButtonTimeUpdate}
                onStop={onButtonStop}
                speed={speed}
              />
              {onSpeedCycle && (
                <CardSpeedBadge
                  override={speedOverride}
                  generalSpeed={generalSpeed}
                  onCycle={onSpeedCycle}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <div className="flex items-center">
              <AudioButton
                url={audioUrl}
                language={translation.language}
                onPlay={onAudioPlay}
                onTimeUpdate={onButtonTimeUpdate}
                onStop={onButtonStop}
                speed={speed}
              />
              {onSpeedCycle && (
                <CardSpeedBadge
                  override={speedOverride}
                  generalSpeed={generalSpeed}
                  onCycle={onSpeedCycle}
                />
              )}
            </div>
          </div>
        )}
        {hasUserText ? (
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <DiffDisplay
                expected={translation.text}
                actual={state.userText}
                language={translation.language}
                hideAccuracy={false}
                hideErrors={showClean}
                ignorePunctuation={ignorePunctuation}
              />
            </div>
            <div className="flex shrink-0 gap-2 pt-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowClean((v) => !v)}
                    className={`h-9 w-9 shrink-0 ${showClean ? 'ring-2 ring-primary border-primary bg-primary/5' : ''}`}
                    aria-label={showClean ? t('showCorrections') : t('showSentence')}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {showClean ? t('showCorrections') : t('showSentence')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : (
          <ClickableWords
            text={translation.text || '...'}
            language={translation.language}
            wordTimings={wordTimings}
            localTime={activeClip?.localTime ?? 0}
            clockBinding={isActive ? clockBinding : undefined}
            isActive={isActive}
            enabled={highlightEnabled}
            className="body-large text-muted-foreground"
          />
        )}
        {showRomanization && translation.romanization && (
          <p className="text-xs text-muted-foreground leading-tight">
            {translation.romanization}
          </p>
        )}
      </div>
    );
  }

  if (state.submitted) {
    return (
      <div
        className="space-y-1"
        {...(isFirstTarget ? { 'data-tutorial': 'target-input-full' } : {})}
      >
        {languageDisplayName ? (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {languageDisplayName}
            </span>
            <div className="flex items-center">
              <AudioButton
                url={audioUrl}
                language={translation.language}
                onPlay={onAudioPlay}
                onTimeUpdate={onButtonTimeUpdate}
                onStop={onButtonStop}
                speed={speed}
              />
              {onSpeedCycle && (
                <CardSpeedBadge
                  override={speedOverride}
                  generalSpeed={generalSpeed}
                  onCycle={onSpeedCycle}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <div className="flex items-center">
              <AudioButton
                url={audioUrl}
                language={translation.language}
                onPlay={onAudioPlay}
                onTimeUpdate={onButtonTimeUpdate}
                onStop={onButtonStop}
                speed={speed}
              />
              {onSpeedCycle && (
                <CardSpeedBadge
                  override={speedOverride}
                  generalSpeed={generalSpeed}
                  onCycle={onSpeedCycle}
                />
              )}
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {hasUserText ? (
              <DiffDisplay
                expected={translation.text}
                actual={state.userText}
                language={translation.language}
                hideAccuracy={false}
                hideErrors={showClean}
                ignorePunctuation={ignorePunctuation}
              />
            ) : (
              <ClickableWords
                text={translation.text || '...'}
                language={translation.language}
                wordTimings={wordTimings}
                localTime={activeClip?.localTime ?? 0}
                clockBinding={isActive ? clockBinding : undefined}
                isActive={isActive}
                enabled={highlightEnabled}
                className="body-large text-muted-foreground"
              />
            )}
          </div>
          <div className="flex shrink-0 gap-2 pt-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onRevert}
                  className="h-9 w-9 shrink-0"
                  aria-label={revertLabel}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{revertTooltip}</TooltipContent>
            </Tooltip>
            {hasUserText && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowClean((v) => !v)}
                    className={`h-9 w-9 shrink-0 ${showClean ? 'ring-2 ring-primary border-primary bg-primary/5' : ''}`}
                    aria-label={showClean ? t('showCorrections') : t('showSentence')}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {showClean ? t('showCorrections') : t('showSentence')}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        {showRomanization && translation.romanization && (
          <p className="text-xs text-muted-foreground leading-tight">
            {translation.romanization}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="space-y-1"
      {...(isFirstTarget ? { 'data-tutorial': 'target-input-full' } : {})}
    >
      {languageDisplayName ? (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase">
            {languageDisplayName}
          </span>
          <AudioButton
            url={audioUrl}
            language={translation.language}
            onPlay={onAudioPlay}
            onTimeUpdate={onButtonTimeUpdate}
            onStop={onButtonStop}
          />
        </div>
      ) : (
        <div className="flex justify-end">
          <AudioButton
            url={audioUrl}
            language={translation.language}
            onPlay={onAudioPlay}
            onTimeUpdate={onButtonTimeUpdate}
            onStop={onButtonStop}
          />
        </div>
      )}
      <div
        className="flex items-center gap-2"
        {...(isFirstTarget ? { 'data-tutorial': 'target-input-and-submit' } : {})}
      >
        <Input
          ref={inputRef ?? undefined}
          autoFocus={autoFocus}
          value={state.userText}
          onChange={(e) => onInputChange(translation.language, e.target.value)}
          onKeyDown={handleKeyDown}
          {...compositionProps}
          placeholder={placeholder}
          lang={inputLang}
          dir={getTextDirection(translation.language)}
          className="flex-1 text-left"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          {...(isFirstTarget ? { 'data-testid': 'learn-translation-input' } : {})}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => onSubmit(translation.language)}
          className="h-9 w-9 shrink-0"
          aria-label={submitLabel}
          {...(isFirstTarget ? { 'data-tutorial': 'submit-answer', 'data-testid': 'learn-submit-translation' } : {})}
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
