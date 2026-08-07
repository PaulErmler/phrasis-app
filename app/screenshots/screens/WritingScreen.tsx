'use client';

import { useTranslations } from 'next-intl';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  PenLine,
  Settings,
  SkipBack,
  Star,
  Undo2,
  Volume2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { WordDiff } from '@/components/app/learning/WordDiff';

/**
 * Writing-mode review replica: typed answer + the real WordDiff feedback
 * (imported component — authentic character-level scoring pills).
 */
export function WritingScreen() {
  const t = useTranslations('LearningMode');
  const tApp = useTranslations('AppPage');

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden bg-background text-foreground">
      <header className="sticky-header">
        <div className="container mx-auto px-4 h-14 flex items-center relative">
          <Button variant="ghost" className="gap-2 -ml-2">
            <ChevronLeft className="h-4 w-4" />
            {t('back')}
          </Button>
          <div className="flex-1 min-w-0 flex items-center justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
              <PenLine className="h-3.5 w-3.5" />
              {tApp('fullReview')}
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

      <div className="px-4 py-2">
        <Progress value={48} className="h-1.5" />
      </div>

      <div className="flex-1 min-h-0 relative">
        <main className="flex-1 overflow-y-auto h-full">
          <div className="max-w-lg mx-auto px-4 pt-6 pb-16 space-y-4">
            <div className="card-surface overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <Badge variant="secondary" className="text-xs">
                  {t('reviewCount', { count: 5 })}
                </Badge>
                <div className="flex items-center">
                  <Button variant="ghost" size="icon" className="text-muted-foreground">
                    <Star className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-muted-foreground">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="px-6 pb-6 space-y-4">
                <p className="body-large">Could we see the menu, please?</p>
                <Separator />

                {/* Submitted answer with real diff feedback */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase">
                      Spanish
                    </span>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <Volume2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <WordDiff
                    expected="¿Podríamos ver el menú, por favor?"
                    actual="¿Podriamos ver el menu, por favor?"
                    language="es"
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      readOnly
                      value="¿Podriamos ver el menu, por favor?"
                      className="flex-1 text-left"
                    />
                    <Button variant="outline" size="icon" className="h-9 w-9 shrink-0">
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Controls */}
      <div className="relative pb-[max(1rem,var(--safe-bottom))]">
        <div className="border-t">
          <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
            <div className="flex gap-2">
              {([['again', '<10m'], ['hard', '2d'], ['good', '6d'], ['easy', '14d']] as const).map(
                ([rating, interval]) => (
                  <div key={rating} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[11px] text-muted-foreground">{interval}</span>
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
                ),
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0">
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0">
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 flex-[2] min-w-0">
                <Volume2 className="h-4 w-4" />
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
