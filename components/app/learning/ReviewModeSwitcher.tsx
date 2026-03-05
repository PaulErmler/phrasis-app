'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Headphones, PenLine } from 'lucide-react';

type ReviewMode = 'audio' | 'full';

interface ReviewModeSwitcherProps {
  value: ReviewMode;
  onChange: (mode: ReviewMode) => void;
}

export function ReviewModeSwitcher({ value, onChange }: ReviewModeSwitcherProps) {
  const t = useTranslations('LearningMode.settingsPanel');

  return (
    <div className="flex w-full rounded-md border bg-muted/40 p-0.5">
      <button
        type="button"
        onClick={() => onChange('audio')}
        className={cn(
          'flex-1 inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
          value === 'audio'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Headphones className="h-4 w-4" />
        {t('reviewModeAudio')}
      </button>
      <button
        type="button"
        onClick={() => onChange('full')}
        className={cn(
          'flex-1 inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
          value === 'full'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <PenLine className="h-4 w-4" />
        {t('reviewModeFull')}
      </button>
    </div>
  );
}
