'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { PenLine, Upload } from 'lucide-react';

export type AddCardsMode = 'individual' | 'import';

interface ImportModeSwitcherProps {
  value: AddCardsMode;
  onChange: (mode: AddCardsMode) => void;
}

export function ImportModeSwitcher({
  value,
  onChange,
}: ImportModeSwitcherProps) {
  const t = useTranslations('ImportTexts');

  return (
    <div
      className="flex w-full rounded-lg border bg-muted/50 p-1"
      role="tablist"
      aria-label={t('switcher.ariaLabel')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === 'individual'}
        onClick={() => onChange('individual')}
        data-testid="add-cards-mode-individual"
        className={cn(
          'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition-all min-w-0',
          value === 'individual'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <PenLine className="h-4 w-4 shrink-0" />
        <span className="truncate">{t('toggleIndividual')}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'import'}
        onClick={() => onChange('import')}
        data-testid="add-cards-mode-import"
        className={cn(
          'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition-all min-w-0',
          value === 'import'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Upload className="h-4 w-4 shrink-0" />
        <span className="truncate">{t('toggleImport')}</span>
      </button>
    </div>
  );
}
