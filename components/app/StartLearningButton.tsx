'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  BookOpen,
  RefreshCw,
  Headphones,
  PenLine,
  Radio,
  NotebookPen,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { ReviewMode, SchedulingMode } from '@/convex/types';
import { TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';
import { ContentFilterDropdown } from '@/components/app/ContentFilterDropdown';
import { DueCountsPills } from '@/components/app/DueCountsPills';
import { useAppData } from '@/components/app/AppDataProvider';

interface StartLearningButtonProps {
  onStartLearn: (schedulingMode: SchedulingMode) => void;
  onReviewModeChange: (mode: ReviewMode) => void;
  /** Whether the active deck has any playable card. When false, the free-play
   * button (Radio / Free Study) is disabled and clicking it explains why.
   * Defaults to `true` so the button stays enabled while the query is still
   * loading. */
  hasPlayableCards?: boolean;
  /** Pause the due-count subscription while the home view is hidden
   * (kept-mounted views stay rendered, see KeepMountedView). */
  skipLiveCounts?: boolean;
}

export function StartLearningButton({
  onStartLearn,
  onReviewModeChange,
  hasPlayableCards = true,
  skipLiveCounts,
}: StartLearningButtonProps) {
  const t = useTranslations('AppPage');
  const { courseSettings } = useAppData();
  const reviewMode = courseSettings?.reviewMode ?? 'audio';

  // Third slot: free play. One scheduling mode ('radio') that wears the face
  // of whichever review mode is selected. Shadowing gets Radio (endless
  // listening), Writing gets Free Study (endless typing practice). Both draw
  // the whole deck round-robin, each from its own rotation, and never touch
  // the FSRS schedule. Only the label and icon change here; flipping the
  // toggle mid-session switches faces live.
  const freePlay =
    reviewMode === 'audio'
      ? {
          Icon: Radio,
          label: t('radioMode'),
          requiresCardsMessage: t('radioRequiresCards'),
          tutorial: TUTORIAL_ANCHORS.radioMode,
        }
      : {
          Icon: NotebookPen,
          label: t('freeStudyMode'),
          requiresCardsMessage: t('freeStudyRequiresCards'),
          tutorial: TUTORIAL_ANCHORS.freeStudyMode,
        };

  const handleFreePlayClick = () => {
    if (!hasPlayableCards) {
      toast.info(freePlay.requiresCardsMessage);
      return;
    }
    onStartLearn('radio');
  };

  // Three equal columns are tight on SE (~375px): icon-above there so labels
  // like "Learn & Review" don't shatter mid-word; icon-left from ~400px up
  // (XR and larger) where there's room beside the icon.
  const modeBtnClass =
    'h-auto min-h-10 w-full items-center justify-center whitespace-normal py-2 max-[399px]:flex-col max-[399px]:gap-1 max-[399px]:px-1.5 min-[400px]:flex-row min-[400px]:gap-1.5 min-[400px]:px-2 min-[400px]:has-[>svg]:px-2';
  const modeLabelClass =
    'min-w-0 text-xs leading-snug [overflow-wrap:normal] [word-break:keep-all] max-[399px]:text-center min-[400px]:text-left min-[400px]:text-sm';
  const modeIconClass = 'h-4 w-4 shrink-0 min-[400px]:h-5 min-[400px]:w-5';

  return (
    <div className="space-y-2" data-tutorial={TUTORIAL_ANCHORS.startLearning}>
      <div className="grid grid-cols-3 gap-1.5 min-[400px]:gap-2">
        <Button
          size="lg"
          variant="outline"
          className={modeBtnClass}
          onClick={() => onStartLearn('learn_new')}
          data-tutorial={TUTORIAL_ANCHORS.learnNew}
        >
          <BookOpen className={modeIconClass} />
          <span className={modeLabelClass}>{t('learnNew')}</span>
        </Button>
        <Button
          size="lg"
          className={modeBtnClass}
          onClick={() => onStartLearn('learnAndReview')}
          data-tutorial={TUTORIAL_ANCHORS.learnAndReview}
        >
          <RefreshCw className={modeIconClass} />
          <span className={modeLabelClass}>{t('learnAndReview')}</span>
        </Button>
        <Button
          size="lg"
          variant={hasPlayableCards ? 'outline' : 'secondary'}
          aria-disabled={!hasPlayableCards}
          className={cn(modeBtnClass, !hasPlayableCards && 'opacity-50')}
          onClick={handleFreePlayClick}
          /* Face-dependent anchor: the home tour branches on `reviewMode` to
           * pick the matching step + copy (see lib/tutorials/home-tour.ts). */
          data-tutorial={freePlay.tutorial}
        >
          <freePlay.Icon className={modeIconClass} />
          <span className={modeLabelClass}>{freePlay.label}</span>
        </Button>
      </div>

      {/* Review mode toggle. Its own full-width row. Selected toggle uses a
       * soft primary tint (not the solid dark-blue fill) so the hierarchy
       * stays clean: only Learn & Review carries the strong accent. */}
      <div
        className="flex w-full rounded-lg border bg-muted/50 p-0.5"
        data-tutorial={TUTORIAL_ANCHORS.reviewModeToggle}
      >
        {[
          { mode: 'audio' as const, icon: Headphones, label: t('audioReview') },
          { mode: 'full' as const, icon: PenLine, label: t('fullReview') },
        ].map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onReviewModeChange(mode)}
            className={cn(
              'flex min-h-8 flex-1 items-start justify-center gap-1.5 whitespace-normal rounded-md px-2.5 py-1.5 text-center text-xs font-medium transition-[color,background-color,box-shadow]',
              reviewMode === mode
                ? 'bg-primary/15 text-primary shadow-sm ring-1 ring-primary/30'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 text-center leading-snug">{label}</span>
          </button>
        ))}
      </div>

      {/* Deck counts + source filter, below the toggle: one line when there's
       * room (pills left, dropdown pinned right), otherwise the dropdown
       * wraps under them. This row spans the full width, so. Unlike the
       * earlier nested flex-grow layout. There's no leftover-width
       * computation for Safari and Chrome to disagree on. */}
      <div className="flex flex-wrap items-center gap-2 gap-y-2 sm:gap-3">
        <DueCountsPills skip={skipLiveCounts} />
        <div className="ml-auto">
          <ContentFilterDropdown />
        </div>
      </div>
    </div>
  );
}
