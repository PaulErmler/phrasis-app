'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { CardShell } from './CardShell';
import { DEFAULT_PLAYBACK_SPEED } from '@/lib/constants/audioPlayback';
import { computeAccuracy } from './DiffDisplay';
import {
  TargetLanguageInput,
  type LanguageInputState,
  type TargetAudioMode,
} from './TargetLanguageInput';
import { useButtonPlayback } from '@/hooks/use-button-playback';
import type { ButtonPlaybackActive } from '@/hooks/use-button-playback';
import { useActiveCue, type MergedPlayback } from '@/hooks/use-active-cue';
import type { ClockBinding } from '@/hooks/use-karaoke-index';
import type { CardTranslation, CardAudioRecording } from './types';
import type { Id } from '@/convex/_generated/dataModel';
import type { PinnableCardAction } from '@/lib/cardActions';

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
  // progress through the shared button-playback channel so <HighlightedText>
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
      total += computeAccuracy(tr.text, userText, tr.language);
      count++;
    }
    onAccuracyChangeRef.current?.(count > 0 ? Math.round(total / count) : null);
  }, [allSubmitted, inputs, targetTranslations]);

  const onAudioPlayRef = useRef(onAudioPlay);
  onAudioPlayRef.current = onAudioPlay;

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

  // Receives the typed text at submit time — keystrokes live in each
  // TargetLanguageInput's local state, so this map (and this component)
  // only updates on submit/revert instead of per keypress.
  const handleSubmit = useCallback((language: string, text: string) => {
    setInputs((prev) => {
      const current = prev.get(language);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(language, { submitted: true, userText: text });
      return next;
    });
    setSubmissionOrder((prev) => [...prev, language]);
  }, []);

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

              return (
                <TargetLanguageInput
                  // cardId in the key resets each row's local input state on
                  // card advance without sync effects.
                  key={`${cardId}-${translation.language}`}
                  translation={translation}
                  audioUrl={audio?.url ?? null}
                  wordTimings={audio?.wordTimings ?? null}
                  state={state}
                  targetAudioMode={targetAudioMode}
                  autoPlayedRef={autoPlayedRef}
                  onSubmit={handleSubmit}
                  onRevert={revertLanguage}
                  onAudioPlay={onAudioPlay}
                  submitLabel={t('submitAnswer')}
                  placeholder={t('typeTranslation')}
                  revertLabel={t('revertSubmission')}
                  revertTooltip={t('revertSubmissionTooltip')}
                  showLanguageLabel={showLanguageLabel}
                  locale={locale}
                  inputRefsByLanguage={inputRefsByLanguage}
                  firstInputRef={firstInputRef}
                  autoFocus={index === 0}
                  isFirstTarget={index === 0}
                  allRevealed={allRevealed}
                  showRomanization={showRomanization}
                  highlightEnabled={highlightEnabled}
                  activeClip={activeClip}
                  clockBinding={clockBinding}
                  onButtonTimeUpdate={buttonPlayback.onTimeUpdate}
                  onButtonStop={buttonPlayback.onStop}
                  speed={effectiveSpeed}
                  speedOverride={override}
                  generalSpeed={generalSpeed}
                  onSpeedCycle={onSpeedCycle}
                />
              );
            })}
          </div>
        )}
      </CardShell>
    </div>
  );
}
