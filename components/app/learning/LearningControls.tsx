'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Play, Pause, ChevronRight, Loader2 } from 'lucide-react';
import type { ReviewRating } from '@/lib/scheduling';

interface LearningControlsProps {
  validRatings: ReviewRating[];
  activeRating: ReviewRating;
  ratingIntervals: Record<string, string>;
  onSelectRating: (rating: ReviewRating) => void;
  onAutoPlay: () => void;
  onStopAutoPlay: () => void;
  isAutoPlaying: boolean;
  onNext: () => void;
  isReviewing: boolean;
}

export function LearningControls({
  validRatings,
  activeRating,
  ratingIntervals,
  onSelectRating,
  onAutoPlay,
  onStopAutoPlay,
  isAutoPlaying,
  onNext,
  isReviewing,
}: LearningControlsProps) {
  const t = useTranslations('LearningMode');

  return (
    <div className="border-t bg-background pb-safe">
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {/* Rating buttons — select only, don't submit */}
        <div className="flex gap-2">
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
                onClick={() => onSelectRating(rating)}
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

        {/* Play + Next row — play 2/3, next 1/3 */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={isAutoPlaying ? onStopAutoPlay : onAutoPlay}
            className="flex-[2] gap-2"
          >
            {isAutoPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isAutoPlaying ? t('actions.pause') : t('actions.play')}
          </Button>
          <Button
            size="sm"
            onClick={onNext}
            disabled={isReviewing}
            className="flex-[1] gap-2"
          >
            {isReviewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {t('actions.next')}
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
