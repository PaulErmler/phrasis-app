'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { BookOpen, RefreshCw, Headphones, PenLine, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { ReviewMode, SchedulingMode } from '@/convex/types';
import { ContentFilterDropdown } from '@/components/app/ContentFilterDropdown';

interface StartLearningButtonProps {
  onStartLearn: (schedulingMode: SchedulingMode) => void;
  reviewMode: ReviewMode;
  onReviewModeChange: (mode: ReviewMode) => void;
  /** Whether the active deck has any playable card. When false, the Radio
   * button is disabled and clicking it explains why. Defaults to `true` so
   * the button stays enabled while the query is still loading. */
  hasPlayableCards?: boolean;
}

export function StartLearningButton({
  onStartLearn,
  reviewMode,
  onReviewModeChange,
  hasPlayableCards = true,
}: StartLearningButtonProps) {
  const t = useTranslations('AppPage');

  const showRadio = reviewMode === 'audio';

  const handleRadioClick = () => {
    if (!hasPlayableCards) {
      toast.info(t('radioRequiresCards'));
      return;
    }
    onStartLearn('radio');
  };

  return (
    <div className="space-y-2" data-tutorial="start-learning">
      <div className={cn('grid gap-2', showRadio ? 'grid-cols-3' : 'grid-cols-2')}>
        <Button
          size="lg"
          className="h-auto min-h-10 w-full flex-col gap-1 whitespace-normal py-2.5 sm:flex-row sm:gap-2"
          onClick={() => onStartLearn('learn_new')}
          data-tutorial="learn-new"
        >
          <BookOpen className="h-5 w-5 shrink-0" />
          <span className="min-w-0 break-words leading-snug">{t('learnNew')}</span>
        </Button>
        <Button
          size="lg"
          className="h-auto min-h-10 w-full flex-col gap-1 whitespace-normal py-2.5 sm:flex-row sm:gap-2"
          onClick={() => onStartLearn('learnAndReview')}
          data-tutorial="learn-and-review"
        >
          <RefreshCw className="h-5 w-5 shrink-0" />
          <span className="min-w-0 break-words leading-snug">{t('learnAndReview')}</span>
        </Button>
        {showRadio && (
          <Button
            size="lg"
            variant={hasPlayableCards ? 'default' : 'secondary'}
            aria-disabled={!hasPlayableCards}
            className={cn(
              'h-auto min-h-10 w-full flex-col gap-1 whitespace-normal py-2.5 sm:flex-row sm:gap-2',
              !hasPlayableCards && 'opacity-50',
            )}
            onClick={handleRadioClick}
            data-tutorial="radio-mode"
          >
            <Radio className="h-5 w-5 shrink-0" />
            <span className="min-w-0 break-words leading-snug">{t('radioMode')}</span>
          </Button>
        )}
      </div>

      {/* Review mode toggle - full width */}
      <div
        className="flex w-full rounded-lg border bg-muted/50 p-0.5"
        data-tutorial="review-mode-toggle"
      >
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

      <ContentFilterDropdown />
    </div>
  );
}
