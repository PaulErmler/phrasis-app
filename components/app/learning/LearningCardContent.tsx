'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { AudioButton } from './AudioButton';
import { CardShell } from './CardShell';
import { HighlightedText } from './HighlightedText';
import { resolveActiveClip } from '@/lib/audio/activeClip';
import { useButtonPlayback } from '@/hooks/use-button-playback';
import type { LanguageCue } from '@/lib/audio/mergeAudio';
import type { CardTranslation, CardAudioRecording } from './types';

interface LearningCardContentProps {
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
  onAudioPlay?: () => void;
  hideTargetLanguages?: boolean;
  autoRevealLanguages?: boolean;
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
   */
  mergedPlayback?: {
    isPlaying: boolean;
    currentTime: number;
    languageCues: ReadonlyArray<LanguageCue>;
  };
}

export function LearningCardContent({
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
  onAudioPlay,
  hideTargetLanguages = false,
  autoRevealLanguages = false,
  revealedLanguages,
  revealAllSignal = 0,
  onAllTargetsRevealedChange,
  bare = false,
  showRomanization = true,
  highlightEnabled = true,
  mergedPlayback,
}: LearningCardContentProps) {
  const buttonPlayback = useButtonPlayback();

  // Merged audio wins when it is actively playing; otherwise fall back to
  // whichever per-language AudioButton is running (for library previews /
  // individual replays). When nothing is playing, activeClip stays null and
  // <HighlightedText> renders neutral words.
  const activeClip = useMemo(() => {
    if (mergedPlayback?.isPlaying) {
      return resolveActiveClip(
        mergedPlayback.languageCues,
        mergedPlayback.currentTime,
      );
    }
    return buttonPlayback.active;
  }, [mergedPlayback, buttonPlayback.active]);
  const displayReviewCount =
    schedulingPhase === 'review' && fsrsState != null
      ? preReviewCount + fsrsState.reps
      : preReviewCount;

  const [manuallyRevealed, setManuallyRevealed] = useState<Set<string>>(new Set());

  // Capture the signal value at mount so we don't treat a stale non-zero value
  // (left over from the previous card) as a fresh "reveal all" request.
  const mountRevealSignalRef = useRef(revealAllSignal);

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
    if (revealAllSignal === 0 || revealAllSignal === mountRevealSignalRef.current) return;
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
        isPendingMaster={isPendingMaster}
        isPendingHide={isPendingHide}
        onMaster={onMaster}
        onHide={onHide}
        onFavorite={onFavorite}
        onEdit={onEdit}
        onAudioPlay={onAudioPlay}
        bare={bare}
        showRomanization={showRomanization}
        highlightEnabled={highlightEnabled}
        activeClip={activeClip}
        onButtonTimeUpdate={buttonPlayback.onTimeUpdate}
        onButtonStop={buttonPlayback.onStop}
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
                    <HighlightedText
                      text={translation.text || '...'}
                      wordTimings={audio?.wordTimings ?? null}
                      localTime={isActive ? activeClip.localTime : 0}
                      isActive={!!isActive}
                      enabled={highlightEnabled}
                      className={`body-large ${isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}`}
                    />
                    {showRomanization && translation.romanization && (
                      <p
                        className={`text-romanization ${isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}`}
                      >
                        {translation.romanization}
                      </p>
                    )}
                  </div>
                  <AudioButton
                    url={audio?.url ?? null}
                    language={translation.language}
                    onPlay={onAudioPlay}
                    onTimeUpdate={buttonPlayback.onTimeUpdate}
                    onStop={buttonPlayback.onStop}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardShell>
    </div>
  );
}
