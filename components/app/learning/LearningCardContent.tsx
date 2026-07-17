'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { AudioButton } from './AudioButton';
import { CardShell } from './CardShell';
import { CardSpeedBadge } from './CardSpeedBadge';
import { ClickableWords } from './ClickableWords';
import { useButtonPlayback } from '@/hooks/use-button-playback';
import type { ButtonPlaybackActive } from '@/hooks/use-button-playback';
import { useActiveCue, type MergedPlayback } from '@/hooks/use-active-cue';
import type { ClockBinding } from '@/hooks/use-karaoke-index';
import { DEFAULT_PLAYBACK_SPEED } from '@/lib/constants/audioPlayback';
import type { CardTranslation, CardAudioRecording } from './types';
import type { PinnableCardAction } from '@/lib/cardActions';

interface LearningCardContentProps {
  preReviewCount: number;
  /** When in FSRS phase, total reviews = preReviewCount + fsrsState.reps */
  schedulingPhase?: 'preReview' | 'review';
  fsrsState?: { reps: number } | null;
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
  isFavorite: boolean;
  isMastered?: boolean;
  isHidden?: boolean;
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
  hideTargetLanguages?: boolean;
  autoRevealLanguages?: boolean;
  hideBaseLanguages?: boolean;
  autoRevealBaseLanguages?: boolean;
  revealedLanguages?: ReadonlySet<string>;
  /** When this value changes (e.g. incremented by parent), all target lines are manually revealed. */
  revealAllSignal?: number;
  /** Reports whether every target translation is visible (not blurred). */
  onAllTargetsRevealedChange?: (allRevealed: boolean) => void;
  bare?: boolean;
  showRomanization?: boolean;
  /** Karaoke word highlighting toggle (defaults true; pass false to force off). */
  highlightEnabled?: boolean;
  /**
   * Merged-audio playback state from useAudioPlayer. When present and playing,
   * takes priority over per-language AudioButton playback for highlight timing.
   * Per-frame time lives in `clock`, not React state — see useActiveCue.
   */
  mergedPlayback?: MergedPlayback;
  /** Course-level per-language general speed (used by both CardShell base rows and target rows here). */
  languagePlaybackSpeeds?: Record<string, number>;
  /** Per-card per-language override stored on the card. Absent = no override. */
  audioSpeedOverrides?: Record<string, number>;
  /** Cycle handler for a language's speed badge; null clears the override. */
  onSpeedCycle?: (language: string, next: number | null) => void;
  /** Badge behavior — `ephemeral` hides the null/default slot and greys 1.0. */
  speedBadgeVariant?: 'persistent' | 'ephemeral';
  /** Client-only session flag: did the viewer click flag on this card? */
  flaggedInSession?: boolean;
  /** Merged-audio playback for the slim progress bar at the card's bottom edge. */
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  durationSec?: number;
  isPlaying?: boolean;
  isMerging?: boolean;
  onSeek?: (seconds: number) => void;
  showProgressBar?: boolean;
}

export function LearningCardContent({
  preReviewCount,
  schedulingPhase,
  fsrsState,
  sourceText,
  translations,
  audioRecordings,
  isFavorite,
  isMastered = false,
  isHidden = false,
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
  hideTargetLanguages = false,
  autoRevealLanguages = false,
  hideBaseLanguages = false,
  autoRevealBaseLanguages = false,
  revealedLanguages,
  revealAllSignal = 0,
  onAllTargetsRevealedChange,
  bare = false,
  showRomanization = true,
  highlightEnabled = true,
  mergedPlayback,
  languagePlaybackSpeeds,
  audioSpeedOverrides,
  onSpeedCycle,
  speedBadgeVariant,
  flaggedInSession = false,
  audioRef,
  durationSec,
  isPlaying,
  isMerging,
  onSeek,
  showProgressBar,
}: LearningCardContentProps) {
  const buttonPlayback = useButtonPlayback();

  // Merged audio wins when it is actively playing; otherwise fall back to
  // whichever per-language AudioButton is running (for library previews /
  // individual replays). When nothing is playing, activeClip stays null and
  // <HighlightedText> renders neutral words.
  //
  // The merged path updates only on cue changes; per-frame word positions are
  // derived inside the highlight leaves from `clockBinding` (useKaraokeIndex),
  // so playback no longer re-renders this card 60×/second.
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
  const displayReviewCount =
    schedulingPhase === 'review' && fsrsState != null
      ? preReviewCount + fsrsState.reps
      : preReviewCount;

  const [manuallyRevealed, setManuallyRevealed] = useState<Set<string>>(new Set());

  // Last processed reveal signal. Initialized to the mount value so a stale
  // nonce from before this mount isn't treated as a fresh "reveal all"
  // request; after that, any change is one (the nonce is monotonic — the
  // parent never resets it, so no value can collide with an older one).
  const lastRevealSignalRef = useRef(revealAllSignal);

  const translationKey = translations.map((tr) => tr.language + tr.text).join('|');
  const [prevTranslationKey, setPrevTranslationKey] = useState(translationKey);
  if (translationKey !== prevTranslationKey) {
    setPrevTranslationKey(translationKey);
    setManuallyRevealed(new Set());
  }

  const handleReveal = (language: string) => {
    setManuallyRevealed((prev) => {
      const next = new Set(prev);
      next.add(language);
      return next;
    });
  };

  const targetLanguages = useMemo(
    () => translations.filter((tr) => tr.isTargetLanguage).map((tr) => tr.language),
    [translations],
  );

  const allTargetsRevealed = useMemo(() => {
    if (!hideTargetLanguages) return true;
    return targetLanguages.every((lang) => {
      const isAudioRevealed =
        autoRevealLanguages && (revealedLanguages?.has(lang) ?? false);
      return isAudioRevealed || manuallyRevealed.has(lang);
    });
  }, [
    hideTargetLanguages,
    targetLanguages,
    autoRevealLanguages,
    revealedLanguages,
    manuallyRevealed,
  ]);

  useEffect(() => {
    onAllTargetsRevealedChange?.(allTargetsRevealed);
  }, [allTargetsRevealed, onAllTargetsRevealedChange]);

  useEffect(() => {
    if (revealAllSignal === lastRevealSignalRef.current) return;
    lastRevealSignalRef.current = revealAllSignal;
    setManuallyRevealed((prev) => {
      const next = new Set(prev);
      for (const lang of targetLanguages) {
        next.add(lang);
      }
      return next;
    });
  }, [revealAllSignal, targetLanguages]);

  return (
    <div data-tutorial="card-content" className="flex flex-col flex-1 min-h-0">
      <CardShell
        reviewCount={displayReviewCount}
        sourceText={sourceText}
        translations={translations}
        audioRecordings={audioRecordings}
        isFavorite={isFavorite}
        isMastered={isMastered}
        isHidden={isHidden}
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
        activeClip={activeClip}
        clockBinding={clockBinding}
        onButtonTimeUpdate={buttonPlayback.onTimeUpdate}
        onButtonStop={buttonPlayback.onStop}
        languagePlaybackSpeeds={languagePlaybackSpeeds}
        audioSpeedOverrides={audioSpeedOverrides}
        onSpeedCycle={onSpeedCycle}
        speedBadgeVariant={speedBadgeVariant}
        flaggedInSession={flaggedInSession}
        audioRef={audioRef}
        durationSec={durationSec}
        isPlaying={isPlaying}
        isMerging={isMerging}
        onSeek={onSeek}
        showProgressBar={showProgressBar}
        languageCues={mergedPlayback?.languageCues}
        hideBaseLanguages={hideBaseLanguages}
        autoRevealBaseLanguages={autoRevealBaseLanguages}
        revealedLanguages={revealedLanguages}
        manuallyRevealedLanguages={manuallyRevealed}
        onRevealLanguage={handleReveal}
      >
        {({ targetTranslations }) => (
          <div className="space-y-2">
            {targetTranslations.map((translation, index) => {
              const audio = audioRecordings.find(
                (a) => a.language === translation.language,
              );
              const isAudioRevealed = autoRevealLanguages && (revealedLanguages?.has(translation.language) ?? false);
              const isBlurred = hideTargetLanguages && !isAudioRevealed && !manuallyRevealed.has(translation.language);
              const isActive = activeClip?.language === translation.language;
              const override = audioSpeedOverrides?.[translation.language];
              const isEphemeral = speedBadgeVariant === 'ephemeral';
              const generalSpeed = isEphemeral
                ? DEFAULT_PLAYBACK_SPEED
                : (languagePlaybackSpeeds?.[translation.language] ??
                  DEFAULT_PLAYBACK_SPEED);
              const effectiveSpeed = override ?? generalSpeed;
              return (
                <div
                  key={translation.language}
                  className="flex items-start gap-2"
                  {...(index === 0 ? { 'data-tutorial': 'target-text-audio' } : {})}
                >
                  <div
                    className="flex-1"
                    onClick={isBlurred ? () => handleReveal(translation.language) : undefined}
                  >
                    <ClickableWords
                      text={translation.text || '...'}
                      language={translation.language}
                      wordTimings={audio?.wordTimings ?? null}
                      localTime={activeClip?.localTime ?? 0}
                      clockBinding={isActive ? clockBinding : undefined}
                      isActive={!!isActive}
                      enabled={highlightEnabled}
                      interactive={!isBlurred}
                      className={`body-large ${isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}`}
                      // Onboarding's word-tap tutorial targets the longest
                      // target-language word via this data attribute.
                      coachmarkAnchorForLongestWord={index === 0 ? 'word-tap' : undefined}
                    />
                    {showRomanization && translation.romanization && (
                      <p
                        className={`text-romanization ${isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}`}
                      >
                        {translation.romanization}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center">
                    <AudioButton
                      url={audio?.url ?? null}
                      language={translation.language}
                      onPlay={onAudioPlay}
                      onTimeUpdate={buttonPlayback.onTimeUpdate}
                      onStop={buttonPlayback.onStop}
                      speed={effectiveSpeed}
                    />
                    {onSpeedCycle && (
                      <CardSpeedBadge
                        override={override ?? null}
                        generalSpeed={generalSpeed}
                        onCycle={(next) =>
                          onSpeedCycle(translation.language, next)
                        }
                        variant={speedBadgeVariant}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardShell>
    </div>
  );
}
