'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { AudioButton } from './AudioButton';
import { CardShell } from './CardShell';
import { CardSpeedBadge } from './CardSpeedBadge';
import { ClickableWords } from './ClickableWords';
import { AnnotationLines } from './AnnotationLines';
import { DEFAULT_PLAYBACK_SPEED } from '@/lib/constants/audioPlayback';
import { useCardPlayback, displayReviewCount } from './useCardPlayback';
import type { CardPresentation } from './cardPresentation';
import {
  COACHMARK_ANCHORS,
  TUTORIAL_ANCHORS,
} from '@/lib/tutorials/anchors';

interface LearningCardContentProps {
  /**
   * Shared card presentation: identity/content, flags, annotation toggles,
   * action callbacks + quota state, and the merged-audio bundle. See
   * `cardPresentation.ts`.
   */
  presentation: CardPresentation;
  /** Denser paddings + smaller sentence text for list contexts (library). */
  compact?: boolean;
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
  /** Karaoke word highlighting toggle (defaults true; pass false to force off). */
  highlightEnabled?: boolean;
  /** Course-level per-language general speed (used by both CardShell base rows and target rows here). */
  languagePlaybackSpeeds?: Record<string, number>;
  /** Badge behavior. `ephemeral` hides the null/default slot and greys 1.0. */
  speedBadgeVariant?: 'persistent' | 'ephemeral';
}

export function LearningCardContent({
  presentation,
  compact = false,
  hideTargetLanguages = false,
  autoRevealLanguages = false,
  hideBaseLanguages = false,
  autoRevealBaseLanguages = false,
  revealedLanguages,
  revealAllSignal = 0,
  onAllTargetsRevealedChange,
  bare = false,
  highlightEnabled = true,
  languagePlaybackSpeeds,
  speedBadgeVariant,
}: LearningCardContentProps) {
  const {
    preReviewCount,
    schedulingPhase,
    fsrsState,
    translations,
    audioRecordings,
    onAudioPlay,
    showRomanization = true,
    showIpa = false,
    showFurigana = true,
    mergedPlayback,
    audioSpeedOverrides,
    onSpeedCycle,
    resetSignal,
    replayTargetSignal,
  } = presentation;
  const { buttonPlayback, activeClip, clockBinding } =
    useCardPlayback(mergedPlayback);

  const [manuallyRevealed, setManuallyRevealed] = useState<Set<string>>(new Set());

  // Last processed reveal signal. Initialized to the mount value so a stale
  // nonce from before this mount isn't treated as a fresh "reveal all"
  // request; after that, any change is one (the nonce is monotonic, the
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

  // Restart-card signal: drop manual reveals so the card re-blurs (the
  // parent resets the audio-driven reveals separately). Mount value is
  // ignored, same stale-nonce contract as revealAllSignal above.
  const lastResetSignalRef = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === undefined || resetSignal === lastResetSignalRef.current) {
      return;
    }
    lastResetSignalRef.current = resetSignal;
    setManuallyRevealed(new Set());
  }, [resetSignal]);

  return (
    <div data-tutorial={TUTORIAL_ANCHORS.cardContent} className="flex flex-col flex-1 min-h-0">
      <CardShell
        presentation={presentation}
        compact={compact}
        reviewCount={displayReviewCount(preReviewCount, schedulingPhase, fsrsState)}
        bare={bare}
        highlightEnabled={highlightEnabled}
        activeClip={activeClip}
        clockBinding={clockBinding}
        onButtonTimeUpdate={buttonPlayback.onTimeUpdate}
        onButtonStop={buttonPlayback.onStop}
        languagePlaybackSpeeds={languagePlaybackSpeeds}
        speedBadgeVariant={speedBadgeVariant}
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
                  {...(index === 0
                    ? { 'data-tutorial': TUTORIAL_ANCHORS.targetTextAudio }
                    : {})}
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
                      furigana={showFurigana ? translation.furigana : undefined}
                      interactive={!isBlurred}
                      className={`${compact ? 'text-base leading-relaxed' : 'body-large'} ${isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}`}
                      // Onboarding's word-tap tutorial targets the longest
                      // target-language word via this data attribute.
                      coachmarkAnchorForLongestWord={
                        index === 0 ? COACHMARK_ANCHORS.wordTap : undefined
                      }
                    />
                    <AnnotationLines
                      romanization={translation.romanization}
                      ipa={translation.ipa}
                      showRomanization={showRomanization}
                      showIpa={showIpa}
                      className={isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}
                    />
                  </div>
                  <div className="flex items-center">
                    <AudioButton
                      url={audio?.url ?? null}
                      language={translation.language}
                      onPlay={onAudioPlay}
                      onTimeUpdate={buttonPlayback.onTimeUpdate}
                      onStop={buttonPlayback.onStop}
                      speed={effectiveSpeed}
                      playSignal={index === 0 ? replayTargetSignal : undefined}
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
