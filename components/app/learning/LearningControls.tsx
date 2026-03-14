'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Play, Pause, ChevronsLeft, ChevronRight, MessageCircle, Loader2 } from 'lucide-react';
import { AudioProgressBar } from './AudioProgressBar';
import { useLearningChatToggle } from './LearningChatLayout';
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
  showProgressBar?: boolean;
  instantProceed?: boolean;
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
  showProgressBar = false,
  instantProceed = false,
}: LearningControlsProps) {
  const t = useTranslations('LearningMode');
  const { openChat } = useLearningChatToggle();

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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < validRatings.length) {
        onSelectRating(validRatings[idx]);
        if (instantProceed) onNext();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [validRatings, onSelectRating, instantProceed, onNext]);

  return (
    <div className="relative bg-background pb-safe">
      <div className="hidden lg:block pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[100vw] border-t border-border" />
      {/* Open chat button - above bordered area (mobile only) */}
      <div className="max-w-lg mx-auto flex justify-end px-4 pt-4 pb-3 lg:hidden">
        <Button
          variant="outline"
          size="icon"
          onClick={openChat}
          className="h-9 w-9 shrink-0"
          aria-label="Open chat"
          data-tutorial="chat-button"
        >
          <MessageCircle className="h-5 w-5" />
        </Button>
      </div>

      <div className="border-t lg:border-t-0">
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {/* Rating buttons */}
        <div className="flex gap-2" data-tutorial="rating-buttons">
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
                  if (instantProceed) onNext();
                }}
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

        
        {showProgressBar && (
          <AudioProgressBar
            audioRef={audioRef}
            durationSec={durationSec}
            isPlaying={isPlaying}
            onSeek={onSeek}
            isMerging={isMerging}
          />
        )}

        {/* Restart + Play + Next row */}
        <div className="flex gap-2" data-tutorial="audio-controls">
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
            size="icon"
            onClick={isPlaying ? onPause : onPlay}
            disabled={isMerging || durationSec === 0}
            className="h-9 flex-[2] min-w-0"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="sm"
            onClick={onNext}
            disabled={isReviewing}
            className="flex-[1] gap-2"
          >
            {t('actions.next')}
            {showSpinner ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}
