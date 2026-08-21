'use client';

import { useTranslations } from 'next-intl';
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Radio,
  Settings,
  SkipBack,
  Volume2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

/**
 * Radio-mode replica: continuous hands-free playback, no rating bar, just
 * the playing card and transport. Sells all-day comprehensible input.
 */
const QUEUE = [
  { base: 'The train leaves in ten minutes.', target: 'El tren sale en diez minutos.' },
  { base: 'Could you speak more slowly?', target: '¿Podrías hablar más despacio?' },
];

export function RadioScreen() {
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
              <Radio className="h-3.5 w-3.5" />
              {tApp('radioMode')}
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

      <div className="flex-1 min-h-0 relative">
        <main className="flex-1 overflow-y-auto h-full">
          <div className="max-w-lg mx-auto px-4 pt-6 pb-16 space-y-4">
            {/* Now playing */}
            <div className="card-surface overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <Badge className="border-transparent bg-primary/10 text-primary text-xs">
                  Now playing
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {t('reviewCount', { count: 8 })}
                </Badge>
              </div>
              <div className="px-6 pb-6 space-y-4">
                <div className="flex items-start gap-2">
                  <p className="body-large flex-1">I would like a table for two.</p>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                    <Volume2 className="h-4 w-4" />
                  </Button>
                </div>
                <Separator />
                <div className="flex items-start gap-2">
                  <p className="body-large flex-1">
                    Quisiera una <span className="text-primary">mesa</span> para dos.
                  </p>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                    <Volume2 className="h-4 w-4 text-primary" />
                  </Button>
                </div>
              </div>
              <div className="relative h-1 w-full overflow-hidden bg-primary/20">
                <div className="absolute h-full bg-primary" style={{ width: '61%' }} />
              </div>
            </div>

            {/* Up next */}
            <div className="space-y-2">
              <p className="label-form px-1">Up next</p>
              {QUEUE.map((item) => (
                <div key={item.base} className="card-surface p-3 space-y-0.5 opacity-80">
                  <p className="text-sm text-muted-foreground">{item.base}</p>
                  <p className="text-sm font-medium">{item.target}</p>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      {/* Transport only. Radio has no ratings */}
      <div className="relative pb-[max(1rem,var(--safe-bottom))]">
        <div className="border-t">
          <div className="max-w-lg mx-auto px-4 py-4">
            <div className="flex gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0">
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 flex-[2] min-w-0">
                <Pause className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 flex-[1] min-w-0">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
