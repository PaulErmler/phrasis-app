'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { BookOpen, RefreshCw, Headphones, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReviewMode, SchedulingMode } from '@/convex/types';

interface StartLearningButtonProps {
  onStartLearn: (schedulingMode: SchedulingMode) => void;
  reviewMode: ReviewMode;
  onReviewModeChange: (mode: ReviewMode) => void;
}

export function StartLearningButton({
  onStartLearn,
  reviewMode,
  onReviewModeChange,
}: StartLearningButtonProps) {
  const t = useTranslations('AppPage');

  return (
    <div className="space-y-2" data-tutorial="start-learning">
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="w-full gap-2"
          onClick={() => onStartLearn('learn_new')}
        >
          <BookOpen className="h-5 w-5" />
          {t('learnNew')}
        </Button>
        <Button
          size="lg"
          className="w-full gap-2"
          onClick={() => onStartLearn('learnAndReview')}
        >
          <RefreshCw className="h-5 w-5" />
          {t('learnAndReview')}
        </Button>
      </div>

      {/* Review mode toggle - full width */}
      <div className="flex w-full rounded-lg border bg-muted/50 p-0.5">
        {([
          { mode: 'audio' as const, icon: Headphones, label: t('audioReview') },
          { mode: 'full' as const, icon: PenLine, label: t('fullReview') },
        ]).map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onReviewModeChange(mode)}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all',
              reviewMode === mode
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
