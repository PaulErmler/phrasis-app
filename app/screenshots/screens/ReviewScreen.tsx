'use client';

import { useTranslations } from 'next-intl';
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  MoreHorizontal,
  Pause,
  RefreshCw,
  Settings,
  SkipBack,
  Star,
  Undo2,
  Volume2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { REVIEW_CARD } from '../fixtures';

/** Inline audio button + speed badge as they appear on card rows. */
function RowAudio({ playing = false }: { playing?: boolean }) {
  return (
    <div className="flex items-center">
      <Button variant="ghost" size="icon" className="h-7 w-7">
        <Volume2 className={playing ? 'h-4 w-4 text-primary' : 'h-4 w-4'} />
      </Button>
      <button
        type="button"
        className="tabular-nums rounded h-5 px-1 text-[11px] leading-none transition-colors text-foreground font-medium"
      >
        0.9x
      </button>
    </div>
  );
}

/**
 * Replica of the shadowing review screen: LearningHeader + SessionProgressBar
 * + CardShell/LearningCardContent card + LearningControls (structures quoted
 * from components/app/learning/*).
 */
export function ReviewScreen() {
  const t = useTranslations('LearningMode');
  const tApp = useTranslations('AppPage');
  const card = REVIEW_CARD;
  const ratings = ['again', 'hard', 'good', 'easy'] as const;

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden bg-background text-foreground">
      {/* LearningHeader */}
      <header className="sticky-header">
        <div className="container mx-auto px-4 h-14 flex items-center relative">
          <Button variant="ghost" className="gap-2 -ml-2 z-10">
            <ChevronLeft className="h-4 w-4" />
            {t('back')}
          </Button>
          <div className="flex-1 min-w-0 flex items-center justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
              {tApp('learnAndReview')}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1 z-10">
            <ThemeSwitcher className="-mr-1" />
            <Button variant="ghost" size="icon" className="size-9 -mr-1">
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* SessionProgressBar */}
      <div className="px-4 py-2">
        <Progress value={64} className="h-1.5" />
      </div>

      {/* Card area */}
      <div className="flex-1 min-h-0 relative">
        <main className="flex-1 overflow-y-auto h-full">
          <div className="max-w-lg mx-auto px-4 pt-6 pb-16 space-y-4">
            <div className="card-surface overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {t('reviewCount', { count: card.reviewCount })}
                  </Badge>
                </div>
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="px-6 pb-6 space-y-4">
                {/* Base language row */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <p className="body-large">{card.base.text}</p>
                    </div>
                    <RowAudio />
                  </div>
                </div>

                <Separator />

                {/* Target language row. Revealed, karaoke highlight on one word */}
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <p className="body-large">
                        ¿Podríamos <span className="text-primary">ver</span> el
                        menú, por favor?
                      </p>
                    </div>
                    <RowAudio playing />
                  </div>
                </div>
              </div>

              {/* AudioProgressBar (slim, at the card's bottom edge) */}
              <div className="relative h-1 w-full overflow-hidden bg-primary/20">
                <div
                  className="absolute h-full bg-primary"
                  style={{ width: '38%' }}
                />
              </div>
            </div>
          </div>
        </main>

        {/* Floating chat button */}
        <div className="absolute inset-x-0 bottom-0 max-w-lg mx-auto flex justify-end px-4 pb-3 pointer-events-none">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 pointer-events-auto"
          >
            <MessageCircle className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* LearningControls */}
      <div className="relative pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="border-t">
          <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
            <div className="flex gap-2">
              {ratings.map((rating) => (
                <div
                  key={rating}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <span className="text-[11px] text-muted-foreground">
                    {card.ratingIntervals[rating]}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className={
                      rating === 'good'
                        ? 'w-full ring-2 ring-primary border-primary bg-primary/5'
                        : 'w-full'
                    }
                  >
                    {t(`ratings.${rating}`)}
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-9 flex-[2] min-w-0"
              >
                <Pause className="h-4 w-4" />
              </Button>
              <Button size="sm" className="flex-[1] gap-2">
                {t('actions.next')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
