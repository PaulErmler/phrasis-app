'use client';

import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import { getLanguageByCode } from '@/lib/languages';
import { Button } from '@/components/ui/button';
import {
  PLAYBACK_SPEED_MIN,
  PLAYBACK_SPEED_MAX,
  PLAYBACK_SPEED_STEP,
} from '@/lib/constants/audioPlayback';

interface TimelineLanguageCardProps {
  code: string;
  type: 'base' | 'target';
  /** Caption shown above the language row, naming the group the card belongs
   *  to when the same language appears twice in the timeline. */
  label?: string;
  plays: number;
  repPause: number;
  speed: number;
  onPlaysChange: (value: number) => void;
  onRepPauseChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  repPauseLabel: string;
  speedLabel: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  showReorderButtons?: boolean;
}

export function TimelineLanguageCard({
  code,
  type,
  label,
  plays,
  repPause,
  speed,
  onPlaysChange,
  onRepPauseChange,
  onSpeedChange,
  repPauseLabel,
  speedLabel,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  showReorderButtons = true,
}: TimelineLanguageCardProps) {
  const t = useTranslations('LearningMode.settingsPanel.stepper');
  const lang = getLanguageByCode(code);
  const isDisabled = plays === 0;

  return (
    <div className="w-full max-w-[300px]">
      <div
        className={`rounded-lg border-2 px-3 py-2.5 space-y-2.5 transition-opacity ${
          type === 'base'
            ? 'border-timeline-base-border bg-timeline-base'
            : 'border-timeline-target-border bg-timeline-target'
        } ${isDisabled ? 'opacity-50' : ''}`}
      >
        {label && (
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
        )}
        <div className="flex items-center gap-2">
          {showReorderButtons && (canMoveUp || canMoveDown) && (
            <div className="grid grid-rows-2 gap-0 -my-1 w-[14px] place-items-center shrink-0">
              <div className="flex h-4 items-center justify-center">
                {canMoveUp && (
                  <button
                    type="button"
                    onClick={onMoveUp}
                    aria-label={t('moveUp')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex h-4 items-center justify-center">
                {canMoveDown && (
                  <button
                    type="button"
                    onClick={onMoveDown}
                    aria-label={t('moveDown')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          <span className="text-base">{lang?.flag}</span>
          <span className="text-sm font-medium">{lang?.name ?? code}</span>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6 rounded-full"
              onClick={() => onPlaysChange(Math.max(0, plays - 1))}
              disabled={plays <= 0}
              aria-label={t('decreasePlays')}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="tabular-nums text-sm font-medium w-5 text-center">
              {plays}x
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6 rounded-full"
              onClick={() => onPlaysChange(Math.min(10, plays + 1))}
              disabled={plays >= 10}
              aria-label={t('increasePlays')}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {plays > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {repPauseLabel}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded-full"
                onClick={() => onRepPauseChange(Math.max(0, repPause - 1))}
                disabled={repPause <= 0}
                aria-label={t('decreasePause')}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="tabular-nums text-sm font-medium w-5 text-center">
                {repPause}s
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded-full"
                onClick={() => onRepPauseChange(Math.min(30, repPause + 1))}
                disabled={repPause >= 30}
                aria-label={t('increasePause')}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}

        {plays > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{speedLabel}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded-full"
                onClick={() =>
                  onSpeedChange(
                    Math.max(
                      PLAYBACK_SPEED_MIN,
                      Math.round((speed - PLAYBACK_SPEED_STEP) * 10) / 10,
                    ),
                  )
                }
                disabled={speed <= PLAYBACK_SPEED_MIN}
                aria-label={t('decreaseSpeed')}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="tabular-nums text-sm font-medium w-10 text-center">
                {speed.toFixed(1)}x
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded-full"
                onClick={() =>
                  onSpeedChange(
                    Math.min(
                      PLAYBACK_SPEED_MAX,
                      Math.round((speed + PLAYBACK_SPEED_STEP) * 10) / 10,
                    ),
                  )
                }
                disabled={speed >= PLAYBACK_SPEED_MAX}
                aria-label={t('increaseSpeed')}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
