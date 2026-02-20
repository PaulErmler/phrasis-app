'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Play, Pause, ChevronsLeft, ChevronRight } from 'lucide-react';
import { AudioProgressBar } from './AudioProgressBar';
import type { ReviewRating } from '@/lib/scheduling';

interface LearningControlsProps {
  validRatings: ReviewRating[];
  activeRating: ReviewRating;
  ratingIntervals: Record<string, string>;
  onSelectRating: (rating: ReviewRating) => void;
  onPlay: () => void;
  onPause: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  isMerging: boolean;
  durationSec: number;
  onSeek: (seconds: number) => void;
  onNext: () => void;
  isReviewing: boolean;
}

export function LearningControls({
  validRatings,
  activeRating,
  ratingIntervals,
  onSelectRating,
  onPlay,
  onPause,
  audioRef,
  isPlaying,
  isMerging,
  durationSec,
  onSeek,
  onNext,
  isReviewing,
}: LearningControlsProps) {
  const t = useTranslations('LearningMode');

  return (
    <div className="border-t bg-background pb-safe">
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {/* Rating buttons */}
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

        
        <AudioProgressBar
          audioRef={audioRef}
          durationSec={durationSec}
          isPlaying={isPlaying}
          onSeek={onSeek}
        />

        {/* Restart + Play + Next row */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onSeek(0)}
            disabled={isMerging || durationSec === 0}
            className="h-9 w-9 shrink-0"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={isPlaying ? onPause : onPlay}
            disabled={isMerging || durationSec === 0}
            className="flex-[2] gap-2"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isPlaying ? t('actions.pause') : t('actions.play')}
          </Button>
          <Button
            size="sm"
            onClick={onNext}
            disabled={isReviewing}
            className="flex-[1] gap-2"
          >
            {t('actions.next')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
