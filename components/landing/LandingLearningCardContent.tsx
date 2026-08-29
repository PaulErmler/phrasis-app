'use client';

import { useState, useEffect } from 'react';
import { LandingAudioButton } from '@/components/landing/LandingAudioButton';
import { LandingCardShell } from '@/components/landing/LandingCardShell';
import { AnnotationLines } from '@/components/app/learning/AnnotationLines';
import type {
  CardTranslation,
  CardAudioRecording,
} from '@/components/app/learning/types';
import {
  getLandingAudioUrl,
  playLandingAudio,
  stopLandingAudio,
} from '@/lib/landing/audio';
import { getLanguageShortLabel } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';

interface LandingLearningCardContentProps {
  preReviewCount: number;
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
  hideTargetLanguages?: boolean;
  /**
   * When true with `hideTargetLanguages`, target lines unblur one-by-one on a timer.
   * Bump `audioDemoSequenceKey` to restart (e.g. replay).
   */
  audioDemoAutoUnlockSequence?: boolean;
  audioDemoSequenceKey?: number;
  autoRevealLanguages?: boolean;
  revealedLanguages?: ReadonlySet<string>;
  bare?: boolean;
  showRomanization?: boolean;
  /** IPA line toggle; landing demos leave it off. */
  showIpa?: boolean;
}

export function LandingLearningCardContent({
  preReviewCount,
  schedulingPhase,
  fsrsState,
  sourceText,
  translations,
  audioRecordings: _audioRecordings,
  isFavorite,
  isPendingMaster,
  isPendingHide,
  onMaster,
  onHide,
  onFavorite,
  hideTargetLanguages = false,
  audioDemoAutoUnlockSequence = false,
  audioDemoSequenceKey = 0,
  autoRevealLanguages = false,
  revealedLanguages,
  bare = false,
  showRomanization = true,
  showIpa = false,
}: LandingLearningCardContentProps) {
  const displayReviewCount =
    schedulingPhase === 'review' && fsrsState != null
      ? preReviewCount + fsrsState.reps
      : preReviewCount;

  const [manuallyRevealed, setManuallyRevealed] = useState<Set<string>>(
    new Set(),
  );

  const translationKey = translations
    .map((tr) => tr.language + tr.text)
    .join('|');

  useEffect(() => {
    setManuallyRevealed(new Set());
  }, [translationKey]);

  const handleReveal = (language: string) => {
    setManuallyRevealed((prev) => {
      const next = new Set(prev);
      next.add(language);
      return next;
    });
  };

  const targetLanguageCodes = translations
    .filter((tr) => tr.isTargetLanguage)
    .map((tr) => tr.language);
  const targetLanguagesKey = targetLanguageCodes.join(',');

  useEffect(() => {
    if (!hideTargetLanguages || !audioDemoAutoUnlockSequence) return;

    setManuallyRevealed(new Set());
    // Long pause between the base ("Good morning…") and the first target
    // ("Buenos días…") so visitors have a beat to mentally translate before
    // the answer arrives.
    const delaysMs = 5000;
    const staggerMs = 640;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // Audio mode is reached via a tab/replay click (user gesture), so unmuted
    // autoplay is allowed from this point on. Play base immediately, then
    // each target as it unblurs. A missing manifest entry just no-ops.
    const baseTr = translations.find((tr) => tr.isBaseLanguage);
    const baseUrl = baseTr
      ? getLandingAudioUrl(baseTr.text, baseTr.language)
      : null;
    if (baseUrl) playLandingAudio(baseUrl);

    let at = delaysMs;
    for (const lang of targetLanguageCodes) {
      const code = lang;
      const tr = translations.find((x) => x.language === code);
      const url = tr ? getLandingAudioUrl(tr.text, tr.language) : null;
      timeouts.push(
        setTimeout(() => {
          setManuallyRevealed((prev) => {
            const next = new Set(prev);
            next.add(code);
            return next;
          });
          if (url) playLandingAudio(url);
        }, at),
      );
      at += staggerMs;
    }
    return () => {
      timeouts.forEach(clearTimeout);
      stopLandingAudio();
    };
  }, [
    hideTargetLanguages,
    audioDemoAutoUnlockSequence,
    audioDemoSequenceKey,
    targetLanguagesKey,
    translations,
  ]);

  return (
    <div
      data-tutorial={TUTORIAL_ANCHORS.cardContent}
      className="flex flex-col flex-1 min-h-0"
    >
      <LandingCardShell
        reviewCount={displayReviewCount}
        sourceText={sourceText}
        translations={translations}
        audioRecordings={_audioRecordings}
        isFavorite={isFavorite}
        isPendingMaster={isPendingMaster}
        isPendingHide={isPendingHide}
        onMaster={onMaster}
        onHide={onHide}
        onFavorite={onFavorite}
        bare={bare}
        showRomanization={showRomanization}
        showIpa={showIpa}
      >
        {({ targetTranslations }) => (
          <div className="space-y-2">
            {targetTranslations.map((translation, index) => {
              const isAudioRevealed =
                autoRevealLanguages &&
                (revealedLanguages?.has(translation.language) ?? false);
              const isBlurred =
                hideTargetLanguages &&
                !isAudioRevealed &&
                !manuallyRevealed.has(translation.language);
              const textClickToReveal =
                isBlurred && !audioDemoAutoUnlockSequence;
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
                    onClick={
                      textClickToReveal
                        ? () => handleReveal(translation.language)
                        : undefined
                    }
                  >
                    <p
                      className={cn(
                        'body-large',
                        isBlurred
                          ? cn(
                              'blur-md opacity-90 select-none',
                              audioDemoAutoUnlockSequence
                                ? 'cursor-default'
                                : 'cursor-pointer',
                            )
                          : 'blur-0 cursor-auto opacity-100 transition-[filter,opacity] duration-700 ease-out',
                      )}
                    >
                      {translation.text || '...'}
                    </p>
                    <AnnotationLines
                      romanization={translation.romanization}
                      ipa={translation.ipa}
                      showRomanization={showRomanization}
                      showIpa={showIpa}
                      className={cn(
                        isBlurred
                          ? cn(
                              'blur-md opacity-90 select-none',
                              audioDemoAutoUnlockSequence
                                ? 'cursor-default'
                                : 'cursor-pointer',
                            )
                          : 'blur-0 cursor-auto opacity-100 transition-[filter,opacity] duration-700 ease-out',
                      )}
                    />
                  </div>
                  <LandingAudioButton
                    url={getLandingAudioUrl(
                      translation.text,
                      translation.language,
                    )}
                    language={getLanguageShortLabel(translation.language)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </LandingCardShell>
    </div>
  );
}
