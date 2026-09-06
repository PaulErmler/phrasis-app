'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import type { PriorApp } from '../types';
import { shuffleKeepingLast } from '../lib/shuffleKeepingLast';
import { OtherFreeTextField } from './OtherFreeTextField';

interface Props {
  selected: PriorApp[];
  freeText: string | null;
  onToggle: (app: PriorApp) => void;
  onFreeText: (text: string) => void;
}

/** Shuffled per visit so position bias doesn't favour the top brands.
 *  "Other" is pinned last within the grid; "None of these" sits below it as
 *  a full-width row. */
const SHUFFLED_VALUES: PriorApp[] = [
  'anki',
  'glossika',
  'clozemaster',
  'babbel',
  'duolingo',
  'other',
];

export function PriorAppsStep({
  selected,
  freeText,
  onToggle,
  onFreeText,
}: Props) {
  const t = useTranslations('Onboarding.priorApps');
  const [options] = useState(() =>
    shuffleKeepingLast(SHUFFLED_VALUES, 'other'),
  );
  const selectedSet = new Set(selected);

  const tile = (value: PriorApp, className?: string) => {
    const isSelected = selectedSet.has(value);
    return (
      <button
        key={value}
        type="button"
        onClick={() => onToggle(value)}
        aria-pressed={isSelected}
        data-testid={`prior-apps-option-${value}`}
        className={cn(
          'rounded-lg border px-4 py-3 text-left transition-colors',
          'hover:bg-accent flex items-center justify-between',
          isSelected && 'border-primary bg-primary/5',
          className,
        )}
      >
        <span className="font-medium text-sm md:text-base">
          {t(`options.${value}`)}
        </span>
        {isSelected ? (
          <Check className="h-4 w-4 text-primary shrink-0" />
        ) : null}
      </button>
    );
  };

  return (
    <div
      data-testid="onboarding-step-prior-apps"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
        <div className="text-center mb-6 md:mb-8">
          <h2 className="text-xl md:text-2xl font-bold">{t('title')}</h2>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            {t('subtitle')}
          </p>
        </div>
        <div className="max-w-2xl mx-auto w-full px-4 grid grid-cols-2 gap-2">
          {options.map((value) => tile(value))}
          {tile('none', 'col-span-2')}
        </div>
        {selectedSet.has('other') ? (
          <OtherFreeTextField
            id="other-apps"
            testIdPrefix="prior-apps"
            label={t('otherLabel')}
            placeholder={t('otherPlaceholder')}
            value={freeText}
            onChange={onFreeText}
          />
        ) : null}
      </div>
    </div>
  );
}
