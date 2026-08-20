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
import type { CardOriginPill } from './cardOriginPill';
import { CardSpeedBadge } from './CardSpeedBadge';
import {
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_PLAYBACK_SPEED,
} from '@/lib/constants/audioPlayback';
import { DiffDisplay } from './DiffDisplay';
import {
  computeAccuracy,
  computeAccuracyPair,
  type AccuracyPair,
} from '@/lib/textCompare';
import { ClickableWords } from './ClickableWords';
import { useLearningChatToggle } from './LearningChatLayout';
import {
  getLanguageByCode,
  getLocalizedLanguageNameByCode,
  getTextDirection,
} from '@/lib/languages';
import { useImeSafeEnter } from '@/hooks/use-ime-safe-enter';
import type { ButtonPlaybackActive } from '@/hooks/use-button-playback';
import type { MergedPlayback } from '@/hooks/use-active-cue';
import type { ClockBinding } from '@/hooks/use-karaoke-index';
import { useCardPlayback, displayReviewCount } from './useCardPlayback';
import type {
  CardTranslation,
  CardAudioRecording,
  WritingAccuracySummary,
} from './types';
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
  /** Source-collection pill ("A1.2"); absent/null = hidden. */
  originPill?: CardOriginPill | null;
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
  onAccuracyChange?: (summary: WritingAccuracySummary | null) => void;
  bare?: boolean;
  showRomanization?: boolean;
  /** Clears submission stack when the reviewed card changes */
  cardId?: Id<'cards'>;
  /**
   * Registers a "revert one submitted translation" handler with the parent
   * for the stepwise-back shortcut (Left Arrow). The handler returns true
   * when it consumed the press (something was reverted); false lets the
   * parent fall through to undoing the last review. Unregistered (null) on
   * unmount.
   */
  onRegisterRevert?: (fn: (() => boolean) | null) => void;
  /**
   * "Show translation on new sentences": the answer is rendered above the
   * input for copy-typing ("Abschreiben"). Computed by LearningMode from the
   * course setting + the card's review count (see the firstExposure const
   * there) so onboarding and the main app share one predicate.
   */
  firstExposure?: boolean;
  /** Restart-card signal: any change clears typed/submitted translations and manual base reveals. */
  resetSignal?: number;
  /** Replay-target signal (T shortcut): any change replays the first target-language clip. */
  replayTargetSignal?: number;
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
  originPill,
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
  onRegisterRevert,
  firstExposure = false,
  resetSignal,
  replayTargetSignal,
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

  const { buttonPlayback, activeClip, clockBinding } =
    useCardPlayback(mergedPlayback);

  // Reveal-sweep / post-submit auto-play uses raw <Audio> elements; route their
  // progress through the shared button-playback channel so <ClickableWords>
  // lights up just like it does for manual AudioButton clicks.
  const buttonTimeUpdateRef = useRef(buttonPlayback.onTimeUpdate);
  buttonTimeUpdateRef.current = buttonPlayback.onTimeUpdate;
  const buttonStopRef = useRef(buttonPlayback.onStop);
  buttonStopRef.current = buttonPlayback.onStop;

  // Fingerprint of everything derived from `translations` below. The role flag is
  // part of it because `targetTranslations` filters on it: two languages could
  // swap base/target roles with their text unchanged, and the key has to move
  // for that (it also has to rebuild the inputs map, which it now does).
  const translationKey = translations
    .map((tr) => `${tr.language}\u0000${tr.isTargetLanguage ? 'T' : 'B'}\u0000${tr.text}`)
    .join('|');

  // `translations` is a fresh array on every render, so keying on the fingerprint
  // rather than the array is what lets the accuracy memo below actually memoize.
  // Depending on `translations` here is precisely the thing being avoided. The
  // disable is load-bearing, not an oversight.
  const targetTranslations = useMemo(
    () => translations.filter((tr) => tr.isTargetLanguage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [translationKey],
  );
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
  // `inputs` gets a new identity on every keystroke, so the accuracy memo below
  // re-runs while the learner types the NEXT language, with nothing changed
  // about the answers already submitted. Keyed on the actual comparison inputs,
  // so each distinct answer is diffed exactly once. Pure cache (same key always
  // yields the same value), so a StrictMode double render is harmless. Cleared
  // when the card changes, below.
  const pairCacheRef = useRef(new Map<string, AccuracyPair>());

  const [prevTranslationKey, setPrevTranslationKey] = useState(translationKey);
  if (translationKey !== prevTranslationKey) {
    setPrevTranslationKey(translationKey);
    setInputs(
      new Map(targetTranslations.map((tr) => [tr.language, { submitted: false, userText: '' }])),
    );
    setSubmissionOrder([]);
    setManuallyRevealedBase(new Set());
    autoPlayedRef.current = new Set();
    pairCacheRef.current.clear();
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

  // Accuracy across the target languages submitted SO FAR. Deliberately not
  // gated on `allSubmitted`: the auto-rating needs a running figure as each
  // language lands, and the consumer decides separately when to persist a stat.
  //
  // Note `ignorePunctuation` is absent from the deps, both variants are always
  // computed, so the summary is setting-independent and both stat series can be
  // populated in parallel. The setting only picks which one is acted on.
  const accuracySummary = useMemo<WritingAccuracySummary | null>(() => {
    if (targetTranslations.length === 0) return null;

    const pairs = targetTranslations
      .filter((tr) => inputs.get(tr.language)?.submitted)
      .map((tr) => {
        const userText = inputs.get(tr.language)?.userText ?? '';
        const cacheKey = `${tr.language}\u0000${tr.text}\u0000${userText}`;
        const cached = pairCacheRef.current.get(cacheKey);
        if (cached) return cached;
        const pair = computeAccuracyPair(tr.text, userText, tr.language);
        pairCacheRef.current.set(cacheKey, pair);
        return pair;
      });

    const base = {
      allSubmitted,
      submittedCount: pairs.length,
      targetCount: targetTranslations.length,
    };
    if (pairs.length === 0) {
      return {
        ...base,
        avgWithPunctuation: null,
        avgWithoutPunctuation: null,
        minWithPunctuation: null,
        minWithoutPunctuation: null,
      };
    }

    const mean = (ns: number[]) =>
      Math.round(ns.reduce((sum, n) => sum + n, 0) / ns.length);
    const strict = pairs.map((p) => p.withPunctuation);
    const lenient = pairs.map((p) => p.withoutPunctuation);

    return {
      ...base,
      avgWithPunctuation: mean(strict),
      avgWithoutPunctuation: mean(lenient),
      minWithPunctuation: Math.min(...strict),
      minWithoutPunctuation: Math.min(...lenient),
    };
  }, [allSubmitted, inputs, targetTranslations]);

  const onAccuracyChangeRef = useRef(onAccuracyChange);
  onAccuracyChangeRef.current = onAccuracyChange;
  // Emit only on STRUCTURAL change, not referential. `inputs` gets a new identity
  // on every keystroke, so the memo above re-produces a new (but equal) object
  // whenever the learner types into a language that isn't submitted yet.
  // Emitting that unconditionally makes the parent store it in state and
  // re-render on every character. (The old code emitted a bare number and was
  // saved by React's same-value bailout; an object needs the comparison done
  // explicitly.)
  const lastEmittedSummaryRef = useRef<WritingAccuracySummary | null>(null);
  useEffect(() => {
    const prev = lastEmittedSummaryRef.current;
    const unchanged =
      prev === accuracySummary ||
      (prev != null &&
        accuracySummary != null &&
        prev.allSubmitted === accuracySummary.allSubmitted &&
        prev.submittedCount === accuracySummary.submittedCount &&
        prev.targetCount === accuracySummary.targetCount &&
        prev.avgWithPunctuation === accuracySummary.avgWithPunctuation &&
        prev.avgWithoutPunctuation === accuracySummary.avgWithoutPunctuation &&
        prev.minWithPunctuation === accuracySummary.minWithPunctuation &&
        prev.minWithoutPunctuation === accuracySummary.minWithoutPunctuation);
    if (unchanged) return;
    lastEmittedSummaryRef.current = accuracySummary;
    onAccuracyChangeRef.current?.(accuracySummary);
  }, [accuracySummary]);

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

  // Left Arrow itself is bound centrally in LearningControls; this component
  // only contributes the "revert one submission" step of the stepwise-back
  // behavior via the registration channel.
  const onRegisterRevertRef = useRef(onRegisterRevert);
  onRegisterRevertRef.current = onRegisterRevert;
  useEffect(() => {
    const register = onRegisterRevertRef.current;
    if (!register) return;
    register(() => {
      if (submissionOrderRef.current.length === 0) return false;
      revertLastSubmitted();
      return true;
    });
    return () => register(null);
  }, [revertLastSubmitted]);

  // Restart-card signal: back to the freshly-dealt state. Initialized to the
  // mount value so a stale nonce never wipes a fresh card (same contract as
  // revealAllSignal in LearningCardContent).
  const lastResetSignalRef = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === undefined || resetSignal === lastResetSignalRef.current) {
      return;
    }
    lastResetSignalRef.current = resetSignal;
    setInputs(
      new Map(
        targetTranslations.map((tr) => [
          tr.language,
          { submitted: false, userText: '' },
        ]),
      ),
    );
    setSubmissionOrder([]);
    setManuallyRevealedBase(new Set());
    autoPlayedRef.current = new Set();
    const raf = requestAnimationFrame(() => {
      firstInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [resetSignal, targetTranslations]);

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
        reviewCount={displayReviewCount(preReviewCount, schedulingPhase, fsrsState)}
        originPill={originPill}
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
        // Writing mode's word-tap tip anchor. Audio mode tags its target row
        // instead (LearningCardContent); here the target row is the answer
        // and isn't on screen before submit, so the base sentence is the
        // clickable text the tip is actually about.
        baseCoachmarkAnchorForLongestWord="word-tap"
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
                  playSignal={index === 0 ? replayTargetSignal : undefined}
                  allRevealed={allRevealed}
                  firstExposure={firstExposure}
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
  /** Keyboard replay nonce, forwarded to this row's AudioButton (first target only). */
  playSignal?: number;
  allRevealed?: boolean;
  /**
   * Card's first-ever exposure: show the target sentence above the input so
   * the first rep is a copy-through instead of an impossible recall test.
   */
  firstExposure?: boolean;
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
  playSignal,
  allRevealed = false,
  firstExposure = false,
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
  const tChat = useTranslations('Chat');
  // Nullable. Absent outside learning mode (e.g. landing demo); the Discuss
  // button simply doesn't render then.
  const chatContext = useLearningChatToggle();
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
    // already-submitted input qualify here while the sheet is open, never
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
    // IME users (ja/zh/ko/vi) press Enter to confirm a conversion. That
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

  const handleDiscuss = useCallback(() => {
    if (!chatContext) return;
    const attempt = state.userText.trim();
    // Full attempt goes in the payload; the visible bubble label is truncated
    // so it can never trip the message length limit.
    const attemptLabel =
      attempt.length > 120 ? `${attempt.slice(0, 120)}…` : attempt;
    chatContext.openChatWithAction(
      {
        kind: 'discussAnswer',
        userAnswer: attempt,
        expected: translation.text,
        language: translation.language,
      },
      tChat('discuss.message', { attempt: attemptLabel }),
    );
  }, [chatContext, state.userText, translation.text, translation.language, tChat]);

  // "Also correct?" exists to dispute an answer the diff marked wrong, at a
  // displayed 100% there is nothing to dispute, so the button is noise.
  // `computeAccuracy` is the same rounded score the accuracy footer shows
  // (including the ignore-punctuation setting), so button and label can't
  // disagree.
  const isPerfectAnswer =
    hasUserText &&
    computeAccuracy(
      translation.text,
      state.userText,
      translation.language,
      ignorePunctuation,
    ) >= 100;

  const discussButton =
    hasUserText && chatContext && !isPerfectAnswer ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto px-2 py-1 text-xs text-primary"
        data-testid="discuss-answer-button"
        onClick={handleDiscuss}
      >
        {tChat('discuss.label')}
      </Button>
    ) : null;

  if (allRevealed && !state.submitted) {
    return (
      <div
        className="space-y-1"
        {...(isFirstTarget ? { 'data-tutorial': 'target-input-full' } : {})}
      >
        <TargetRowHeader
          languageDisplayName={languageDisplayName}
          audioUrl={audioUrl}
          language={translation.language}
          onAudioPlay={onAudioPlay}
          onButtonTimeUpdate={onButtonTimeUpdate}
          onButtonStop={onButtonStop}
          speed={speed}
          playSignal={playSignal}
          speedOverride={speedOverride}
          generalSpeed={generalSpeed}
          onSpeedCycle={onSpeedCycle}
        />
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
            <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
              <ShowCleanToggle
                showClean={showClean}
                onToggle={() => setShowClean((v) => !v)}
                showCorrectionsLabel={t('showCorrections')}
                showSentenceLabel={t('showSentence')}
              />
              {discussButton}
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
        <TargetRowHeader
          languageDisplayName={languageDisplayName}
          audioUrl={audioUrl}
          language={translation.language}
          onAudioPlay={onAudioPlay}
          onButtonTimeUpdate={onButtonTimeUpdate}
          onButtonStop={onButtonStop}
          speed={speed}
          playSignal={playSignal}
          speedOverride={speedOverride}
          generalSpeed={generalSpeed}
          onSpeedCycle={onSpeedCycle}
        />
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
          <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
            <div className="flex gap-2">
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
                <ShowCleanToggle
                  showClean={showClean}
                  onToggle={() => setShowClean((v) => !v)}
                  showCorrectionsLabel={t('showCorrections')}
                  showSentenceLabel={t('showSentence')}
                />
              )}
            </div>
            {discussButton}
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
      {firstExposure ? (
        // First exposure: the answer to copy shares the row with its audio
        // button (mirrors the audio-mode target-row layout), the header row
        // would leave the button floating alone above the sentence.
        <>
          {languageDisplayName && (
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {languageDisplayName}
            </span>
          )}
          <div
            className="flex items-start gap-2"
            data-testid="first-exposure-answer"
          >
            <div className="flex-1 min-w-0">
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
              {showRomanization && translation.romanization && (
                <p className="text-xs text-muted-foreground leading-tight">
                  {translation.romanization}
                </p>
              )}
            </div>
            <div className="flex items-center">
              <AudioButton
                url={audioUrl}
                language={translation.language}
                onPlay={onAudioPlay}
                onTimeUpdate={onButtonTimeUpdate}
                onStop={onButtonStop}
                speed={speed}
                playSignal={playSignal}
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
        </>
      ) : (
        <TargetRowHeader
          languageDisplayName={languageDisplayName}
          audioUrl={audioUrl}
          language={translation.language}
          onAudioPlay={onAudioPlay}
          onButtonTimeUpdate={onButtonTimeUpdate}
          onButtonStop={onButtonStop}
          speed={speed}
          playSignal={playSignal}
          speedOverride={speedOverride}
          generalSpeed={generalSpeed}
          onSpeedCycle={onSpeedCycle}
        />
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
          // FSI/PDI-isolate the placeholder: the input's dir follows the
          // target language, but the placeholder is UI-locale text, for RTL
          // targets the bidi algorithm would otherwise drag the trailing
          // "..." to the visual start.
          placeholder={`\u{2068}${placeholder}\u{2069}`}
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

interface TargetRowHeaderProps {
  /** Localized language name, or null when the label row is hidden. */
  languageDisplayName: string | null;
  audioUrl: string | null;
  language: string;
  onAudioPlay?: () => void;
  onButtonTimeUpdate: (language: string, localTime: number) => void;
  onButtonStop: (language: string) => void;
  /** Effective playback speed. */
  speed?: number;
  /** Keyboard replay nonce forwarded to the AudioButton (first target only). */
  playSignal?: number;
  /** Stored override value, or null when none is stored. */
  speedOverride: number | null;
  /** Course-level general speed for this language. */
  generalSpeed: number;
  /** Cycle handler; null clears the override. */
  onSpeedCycle?: (next: number | null) => void;
}

/** Label + audio-button header row shared by the three TargetLanguageInput branches. */
function TargetRowHeader({
  languageDisplayName,
  audioUrl,
  language,
  onAudioPlay,
  onButtonTimeUpdate,
  onButtonStop,
  speed,
  playSignal,
  speedOverride,
  generalSpeed,
  onSpeedCycle,
}: TargetRowHeaderProps) {
  const audio = (
    <div className="flex items-center">
      <AudioButton
        url={audioUrl}
        language={language}
        onPlay={onAudioPlay}
        onTimeUpdate={onButtonTimeUpdate}
        onStop={onButtonStop}
        speed={speed}
        playSignal={playSignal}
      />
      {onSpeedCycle && (
        <CardSpeedBadge
          override={speedOverride}
          generalSpeed={generalSpeed}
          onCycle={onSpeedCycle}
        />
      )}
    </div>
  );
  return languageDisplayName ? (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-muted-foreground uppercase">
        {languageDisplayName}
      </span>
      {audio}
    </div>
  ) : (
    <div className="flex justify-end">{audio}</div>
  );
}

/** Toggle between the corrected diff and the clean sentence for a submitted answer. */
function ShowCleanToggle({
  showClean,
  onToggle,
  showCorrectionsLabel,
  showSentenceLabel,
}: {
  showClean: boolean;
  onToggle: () => void;
  showCorrectionsLabel: string;
  showSentenceLabel: string;
}) {
  const label = showClean ? showCorrectionsLabel : showSentenceLabel;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          onClick={onToggle}
          className={`h-9 w-9 shrink-0 ${showClean ? 'ring-2 ring-primary border-primary bg-primary/5' : ''}`}
          aria-label={label}
        >
          <FileText className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
