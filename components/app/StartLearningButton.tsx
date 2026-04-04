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
          className="h-auto min-h-10 w-full items-start justify-start gap-2 whitespace-normal py-2.5 text-left"
          onClick={() => onStartLearn('learn_new')}
        >
          <BookOpen className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="min-w-0 text-left leading-snug">{t('learnNew')}</span>
        </Button>
        <Button
          size="lg"
          className="h-auto min-h-10 w-full items-start justify-start gap-2 whitespace-normal py-2.5 text-left"
          onClick={() => onStartLearn('learnAndReview')}
        >
          <RefreshCw className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="min-w-0 text-left leading-snug">{t('learnAndReview')}</span>
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
              'flex min-h-8 flex-1 items-start justify-center gap-1.5 whitespace-normal rounded-md px-2.5 py-1.5 text-center text-xs font-medium transition-all',
              reviewMode === mode
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 text-center leading-snug">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
