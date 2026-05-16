'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Clock, Settings2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  DAILY_TIME_PRESETS,
  DAILY_TIME_CUSTOM_MIN,
  DAILY_TIME_CUSTOM_MAX,
  type DailyTimeGoalMinutes,
} from '../types';

interface Props {
  selected: DailyTimeGoalMinutes | null;
  onSelect: (mins: DailyTimeGoalMinutes) => void;
}

function isPreset(value: number | null): boolean {
  if (value === null) return false;
  return (DAILY_TIME_PRESETS as readonly number[]).includes(value);
}

export function DailyTimeGoalStep({ selected, onSelect }: Props) {
  const t = useTranslations('Onboarding.dailyTime');
  const [customMode, setCustomMode] = useState(
    () => selected !== null && !isPreset(selected),
  );
  const [customDraft, setCustomDraft] = useState<string>(
    () => (selected !== null && !isPreset(selected) ? String(selected) : ''),
  );
  const customInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the input when the Custom tile expands.
  useEffect(() => {
    if (customMode) customInputRef.current?.focus();
  }, [customMode]);

  const customIsActive = customMode || (selected !== null && !isPreset(selected));

  const commitCustom = (raw: string) => {
    setCustomDraft(raw);
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= DAILY_TIME_CUSTOM_MIN && n <= DAILY_TIME_CUSTOM_MAX) {
      onSelect(n);
    }
  };

  return (
    <div
      data-testid="onboarding-step-daily-time"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
      <div className="text-center mb-8 max-w-md mx-auto px-4">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {t.rich('subtitle', {
            strong: (chunks) => (
              <span className="font-medium text-foreground">{chunks}</span>
            ),
          })}
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 max-w-4xl mx-auto w-full">
        {DAILY_TIME_PRESETS.map((value) => {
          const isSelected = selected === value && !customIsActive;
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                setCustomMode(false);
                setCustomDraft('');
                onSelect(value);
              }}
              data-testid={`daily-time-option-${value}`}
              className={cn(
                'rounded-xl border p-6 text-center transition-all',
                'hover:bg-accent hover:scale-[1.02]',
                isSelected && 'border-primary bg-primary/5 ring-2 ring-primary/20',
              )}
            >
              <Clock className={cn('h-6 w-6 mx-auto mb-2', isSelected ? 'text-primary' : 'text-muted-foreground')} />
              <div className="font-semibold">{t(`options.${value}.label`)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {t(`options.${value}.description`)}
              </div>
            </button>
          );
        })}
        {/* Custom is the 6th tile — five presets + Custom fills the grid
            evenly (3 rows × 2 on mobile, 1 row × 6 on desktop) so no
            col-span override is needed. */}
        <button
          type="button"
          onClick={() => {
            setCustomMode(true);
            if (selected !== null && !isPreset(selected)) {
              setCustomDraft(String(selected));
            }
          }}
          data-testid="daily-time-option-custom"
          className={cn(
            'rounded-xl border p-6 text-center transition-all',
            'hover:bg-accent hover:scale-[1.02]',
            customIsActive && 'border-primary bg-primary/5 ring-2 ring-primary/20',
          )}
        >
          <Settings2 className={cn('h-6 w-6 mx-auto mb-2', customIsActive ? 'text-primary' : 'text-muted-foreground')} />
          <div className="font-semibold">{t('options.custom.label')}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {t('options.custom.description')}
          </div>
        </button>
      </div>

      {customMode ? (
        <div className="mt-4 max-w-xs mx-auto w-full px-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <label
            htmlFor="custom-daily-time"
            className="text-sm text-muted-foreground block mb-2 text-center"
          >
            {t('customLabel', { min: DAILY_TIME_CUSTOM_MIN, max: DAILY_TIME_CUSTOM_MAX })}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="custom-daily-time"
              data-testid="daily-time-custom-input"
              ref={customInputRef}
              type="number"
              inputMode="numeric"
              min={DAILY_TIME_CUSTOM_MIN}
              max={DAILY_TIME_CUSTOM_MAX}
              value={customDraft}
              onChange={(e) => commitCustom(e.target.value)}
              placeholder={t('customPlaceholder')}
              className="text-center"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {t('minutesUnit')}
            </span>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
