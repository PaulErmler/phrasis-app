'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Play, Pause, SkipBack, ChevronRight, Eye, Loader2, Undo2 } from 'lucide-react';
import type { ReviewRating } from '@/lib/scheduling';

interface LearningControlsProps {
  validRatings: ReviewRating[];
  activeRating: ReviewRating;
  ratingIntervals: Record<string, string>;
  onSelectRating: (rating: ReviewRating) => void;
  onPlay: () => void;
  onPause: () => void;
  isPlaying: boolean;
  isMerging: boolean;
  durationSec: number;
  onSeek: (seconds: number) => void;
  /** Pass `ratingOverride` when advancing in the same tick as a rating pick (instant proceed). */
  onNext: (ratingOverride?: ReviewRating) => void;
  /** Undo the last review and bring its card back. */
  onUndo: () => void;
  /** True when the undo stack is empty or an undo/review is in flight. */
  undoDisabled: boolean;
  isReviewing: boolean;
  instantProceed?: boolean;
  isFullReview?: boolean;
  fullReviewRevealed?: boolean;
  onReveal?: () => void;
  /** When true, window shortcuts (Space, Enter, ArrowRight, rating keys) are disabled — e.g. settings or edit dialog open. */
  shortcutsDisabled?: boolean;
  /** Audio review: Enter / ArrowRight reveal all blurred targets, then the same keys advance to the next card. */
  isAudioReview?: boolean;
  /** When false and `isAudioReview`, Enter / ArrowRight reveal targets instead of advancing. */
  audioAllTargetsRevealed?: boolean;
  onRevealAllAudioTargets?: () => void;
}

export function LearningControls({
  validRatings,
  activeRating,
  ratingIntervals,
  onSelectRating,
  onPlay,
  onPause,
  isPlaying,
  isMerging,
  durationSec,
  onSeek,
  onNext,
  onUndo,
  undoDisabled,
  isReviewing,
  instantProceed = false,
  isFullReview = false,
  fullReviewRevealed = false,
  onReveal,
  shortcutsDisabled = false,
  isAudioReview = false,
  audioAllTargetsRevealed = true,
  onRevealAllAudioTargets,
}: LearningControlsProps) {
  const t = useTranslations('LearningMode');

  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    if (!isReviewing) {
      setShowSpinner(false);
      return;
    }
    const id = setTimeout(() => setShowSpinner(true), 300);
    return () => clearTimeout(id);
  }, [isReviewing]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shortcutsDisabled) return;
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        // Let Space activate focused interactive controls so keyboard
        // navigation and accessibility are not broken.
        if (
          target instanceof HTMLElement &&
          target.closest(
            'button, a, select, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="tab"]',
          )
        ) {
          return;
        }
        if (e.repeat || isMerging || durationSec === 0) return;
        e.preventDefault();
        if (isPlaying) {
          onPause();
        } else {
          onPlay();
        }
        return;
      }
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        if (
          target instanceof HTMLElement &&
          target.closest(
            'button, a, select, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="tab"]',
          )
        ) {
          return;
        }
        if (isFullReview && !fullReviewRevealed && onReveal) {
          e.preventDefault();
          onReveal();
        } else if (
          isAudioReview &&
          !audioAllTargetsRevealed &&
          onRevealAllAudioTargets
        ) {
          e.preventDefault();
          onRevealAllAudioTargets();
        } else if (!isReviewing) {
          e.preventDefault();
          onNext();
        }
        return;
      }
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < validRatings.length) {
        const chosen = validRatings[idx];
        onSelectRating(chosen);
        if (instantProceed) onNext(chosen);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    shortcutsDisabled,
    validRatings,
    onSelectRating,
    instantProceed,
    onNext,
    isFullReview,
    fullReviewRevealed,
    onReveal,
    isReviewing,
    isMerging,
    durationSec,
    isPlaying,
    onPause,
    onPlay,
    isAudioReview,
    audioAllTargetsRevealed,
    onRevealAllAudioTargets,
  ]);

  return (
    <div className="relative pb-[max(1rem,var(--safe-bottom))]">
      <div className="hidden lg:block pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[100vw] border-t border-border" />

      <div className="border-t lg:border-t-0">
        <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
          {/* Rating buttons */}
          {validRatings.length > 0 && (
            <div
              className="flex gap-2"
              data-tutorial="rating-buttons"
              data-coachmark-anchor="rating-buttons"
            >
              {validRatings.map((rating) => (
                <div
                  key={rating}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <span className="text-[11px] text-muted-foreground">
                    {ratingIntervals[rating]}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onSelectRating(rating);
                      if (instantProceed) onNext(rating);
                    }}
                    data-testid={
                      rating === 'stillLearning'
                        ? 'learn-rating-still-learning'
                        : rating === 'understood'
                          ? 'learn-rating-understood'
                          : `learn-rating-${rating}`
                    }
                    className={`w-full ${
                      activeRating === rating
                        ? 'ring-2 ring-primary border-primary bg-primary/5'
                        : ''
                    }`}
                  >
                    {t(`ratings.${rating}`)}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Undo + Restart + Play + Next row */}
          <div className="flex gap-2" data-tutorial="audio-controls">
            <div className="flex gap-2" data-tutorial="undo-restart">
              <Button
                variant="outline"
                size="icon"
                onClick={onUndo}
                disabled={undoDisabled}
                data-testid="learn-undo"
                aria-label={t('actions.undo')}
                title={t('actions.undo')}
                className="h-9 w-9 shrink-0"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onSeek(0)}
                disabled={isMerging || durationSec === 0}
                className="h-9 w-9 shrink-0"
              >
                <SkipBack className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={isPlaying ? onPause : onPlay}
              disabled={isMerging || durationSec === 0}
              className="h-9 flex-[2] min-w-0"
              data-tutorial="audio-play"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            {isFullReview && !fullReviewRevealed && onReveal ? (
              <Button
                size="sm"
                onClick={onReveal}
                data-testid="learn-reveal"
                className="flex-[1] gap-2"
              >
                {t('actions.reveal')}
                <Eye className="h-4 w-4" />
              </Button>
            ) : isAudioReview &&
              !audioAllTargetsRevealed &&
              onRevealAllAudioTargets ? (
                <Button
                  size="sm"
                  onClick={onRevealAllAudioTargets}
                  data-testid="learn-reveal"
                  className="flex-[1] gap-2"
                >
                  {t('actions.reveal')}
                  <Eye className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => onNext()}
                  disabled={isReviewing}
                  data-testid="learn-next"
                  className="flex-[1] gap-2"
                >
                  {t('actions.next')}
                  {showSpinner ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
