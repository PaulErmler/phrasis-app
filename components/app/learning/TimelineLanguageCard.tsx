'use client';

import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import { getLanguageByCode } from '@/lib/languages';
import { Button } from '@/components/ui/button';

interface TimelineLanguageCardProps {
  code: string;
  type: 'base' | 'target';
  plays: number;
  repPause: number;
  onPlaysChange: (value: number) => void;
  onRepPauseChange: (value: number) => void;
  repPauseLabel: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function TimelineLanguageCard({
  code,
  type,
  plays,
  repPause,
  onPlaysChange,
  onRepPauseChange,
  repPauseLabel,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: TimelineLanguageCardProps) {
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
        <div className="flex items-center gap-2">
          <div className="flex flex-col -my-1">
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:pointer-events-none"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:pointer-events-none"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <span className="text-base">{lang?.flag}</span>
          <span className="text-sm font-medium">{lang?.name ?? code}</span>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6 rounded-full"
              onClick={() => onPlaysChange(Math.max(0, plays - 1))}
              disabled={plays <= 0}
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
