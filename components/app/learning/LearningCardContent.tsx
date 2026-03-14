'use client';

import { useState } from 'react';
import { AudioButton } from './AudioButton';
import { CardShell } from './CardShell';
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
  onAudioPlay?: () => void;
  hideTargetLanguages?: boolean;
  autoRevealLanguages?: boolean;
  revealedLanguages?: ReadonlySet<string>;
  bare?: boolean;
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
  onAudioPlay,
  hideTargetLanguages = false,
  autoRevealLanguages = false,
  revealedLanguages,
  bare = false,
}: LearningCardContentProps) {
  const displayReviewCount =
    schedulingPhase === 'review' && fsrsState != null
      ? preReviewCount + fsrsState.reps
      : preReviewCount;

  const [manuallyRevealed, setManuallyRevealed] = useState<Set<string>>(new Set());

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
        onAudioPlay={onAudioPlay}
        bare={bare}
      >
        {({ targetTranslations }) => (
          <div className="space-y-2">
            {targetTranslations.map((translation, index) => {
              const audio = audioRecordings.find(
                (a) => a.language === translation.language,
              );
              const isAudioRevealed = autoRevealLanguages && (revealedLanguages?.has(translation.language) ?? false);
              const isBlurred = hideTargetLanguages && !isAudioRevealed && !manuallyRevealed.has(translation.language);
              return (
                <div
                  key={translation.language}
                  className="flex items-start gap-2"
                  {...(index === 0 ? { 'data-tutorial': 'target-text-audio' } : {})}
                >
                  <p
                    className={`flex-1 body-large ${isBlurred ? 'blur-sm select-none cursor-pointer' : 'transition-[filter] duration-300'}`}
                    onClick={isBlurred ? () => handleReveal(translation.language) : undefined}
                  >
                    {translation.text || '...'}
                  </p>
                  <AudioButton
                    url={audio?.url ?? null}
                    language={translation.language.toUpperCase()}
                    onPlay={onAudioPlay}
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
