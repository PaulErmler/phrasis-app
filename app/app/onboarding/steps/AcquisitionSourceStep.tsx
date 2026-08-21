'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Check } from 'lucide-react';
import type { AcquisitionSource } from '../types';
import { shuffleKeepingLast } from '../lib/shuffleKeepingLast';
import {
  MAX_ONBOARDING_FREE_TEXT_LENGTH,
  ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD,
} from '@/lib/constants/onboarding';

interface Props {
  selected: AcquisitionSource | null;
  freeText: string | null;
  onSelect: (source: AcquisitionSource) => void;
  onFreeText: (text: string) => void;
}

const OPTION_VALUES: AcquisitionSource[] = [
  'reddit',
  'chatgpt',
  'gemini',
  'claude',
  'google',
  'friend',
  'appstore',
  'other',
];

export function AcquisitionSourceStep({
  selected,
  freeText,
  onSelect,
  onFreeText,
}: Props) {
  const t = useTranslations('Onboarding.acquisition');
  // Shuffle once per visit so position bias doesn't pile onto the first
  // tiles. "Other" stays last (bottom-right in the 2-column grid).
  const [options] = useState(() => shuffleKeepingLast(OPTION_VALUES, 'other'));
  return (
    <div
      data-testid="onboarding-step-acquisition"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
        <div className="text-center mb-6 md:mb-8">
          <h2 className="text-xl md:text-2xl font-bold">{t('title')}</h2>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <div className="max-w-2xl mx-auto w-full px-4 grid grid-cols-2 gap-2">
          {options.map((value) => {
            const isSelected = selected === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onSelect(value)}
                data-testid={`acquisition-option-${value}`}
                className={cn(
                  'rounded-lg border px-4 py-3 text-left transition-colors',
                  'hover:bg-accent flex items-center justify-between',
                  isSelected && 'border-primary bg-primary/5',
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
          })}
        </div>
        {selected === 'other' ? (
          <div className="max-w-md mx-auto w-full mt-4 px-4 animate-in fade-in slide-in-from-top-2 duration-300">
            {(() => {
              const value = freeText ?? '';
              const isOverLimit = value.length > MAX_ONBOARDING_FREE_TEXT_LENGTH;
              const remaining = MAX_ONBOARDING_FREE_TEXT_LENGTH - value.length;
              const showCharCount =
              isOverLimit ||
              remaining <= ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD;
              return (
                <>
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <label htmlFor="other-source" className="text-sm text-muted-foreground">
                      {t('otherLabel')}
                    </label>
                    {showCharCount ? (
                      <span
                        data-testid="acquisition-other-char-count"
                        className={`text-xs tabular-nums shrink-0 ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
                      >
                        {isOverLimit
                          ? `+${value.length - MAX_ONBOARDING_FREE_TEXT_LENGTH}`
                          : `${value.length}/${MAX_ONBOARDING_FREE_TEXT_LENGTH}`}
                      </span>
                    ) : null}
                  </div>
                  <Input
                    id="other-source"
                    data-testid="acquisition-other-input"
                    placeholder={t('otherPlaceholder')}
                    value={value}
                    maxLength={MAX_ONBOARDING_FREE_TEXT_LENGTH}
                    onChange={(e) => onFreeText(e.target.value)}
                  />
                </>
              );
            })()}
          </div>
        ) : null}
      </div>
    </div>
  );
}
