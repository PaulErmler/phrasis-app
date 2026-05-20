'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Check, Plane, Heart, Briefcase, Sparkles, GraduationCap, Pencil } from 'lucide-react';
import type { LearningReason } from '../types';
import {
  MAX_ONBOARDING_FREE_TEXT_LENGTH,
  ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD,
} from '@/lib/constants/onboarding';

interface Props {
  selected: LearningReason[];
  freeText: string | null;
  onToggle: (reason: LearningReason) => void;
  onFreeText: (text: string) => void;
}

const REASONS: {
  value: LearningReason;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: 'travel', Icon: Plane },
  { value: 'family', Icon: Heart },
  { value: 'work', Icon: Briefcase },
  { value: 'curiosity', Icon: Sparkles },
  { value: 'exam', Icon: GraduationCap },
  { value: 'other', Icon: Pencil },
];

export function LearningGoalStep({ selected, freeText, onToggle, onFreeText }: Props) {
  const t = useTranslations('Onboarding.goal');
  const selectedSet = new Set(selected);
  return (
    <div
      data-testid="onboarding-step-goal"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-w-3xl mx-auto w-full">
          {REASONS.map(({ value, Icon }) => {
            const isSelected = selectedSet.has(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => onToggle(value)}
                aria-pressed={isSelected}
                data-testid={`goal-option-${value}`}
                className={cn(
                  'relative rounded-xl border p-6 text-left transition-all flex flex-col gap-3',
                  'hover:bg-accent hover:scale-[1.02]',
                  isSelected && 'border-primary bg-primary/5 ring-2 ring-primary/20',
                )}
              >
                {isSelected ? (
                  <Check className="absolute top-3 right-3 h-4 w-4 text-primary" />
                ) : null}
                <Icon className={cn('h-7 w-7', isSelected ? 'text-primary' : 'text-muted-foreground')} />
                <div>
                  <div className="font-semibold">{t(`options.${value}.label`)}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {t(`options.${value}.description`)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {selectedSet.has('other') ? (
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
                    <label htmlFor="other-reason" className="text-sm text-muted-foreground">
                      {t('otherLabel')}
                    </label>
                    {showCharCount ? (
                      <span
                        data-testid="goal-other-char-count"
                        className={`text-xs tabular-nums shrink-0 ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
                      >
                        {isOverLimit
                          ? `+${value.length - MAX_ONBOARDING_FREE_TEXT_LENGTH}`
                          : `${value.length}/${MAX_ONBOARDING_FREE_TEXT_LENGTH}`}
                      </span>
                    ) : null}
                  </div>
                  <Input
                    id="other-reason"
                    data-testid="goal-other-input"
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
