'use client';

import * as React from 'react';
import { usePreloadedQuery } from 'convex/react';
import { useTranslations } from 'next-intl';

import { useAppData } from '@/components/app/AppDataProvider';
import { useUpdateDailyGoal } from '@/hooks/use-update-daily-goal';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DAILY_TIME_PRESETS,
  DAILY_TIME_CUSTOM_MIN,
  DAILY_TIME_CUSTOM_MAX,
  parseCustomGoal,
} from '@/lib/constants/dailyGoal';
import { GoalPresetTile } from '@/components/app/stats/GoalPresetTile';

/**
 * Popover for editing the daily study-time goal straight from the
 * homescreen: tap the goal indicator (the trigger child), pick one of the
 * onboarding preset tiles or type a custom value. Writes through
 * `useUpdateDailyGoal`, whose optimistic update makes the ring re-render
 * with the new goal immediately. The user's original onboarding answer is
 * untouched (it lives on the frozen onboardingProgress row).
 */
export function DailyGoalQuickEdit({
  children,
}: {
  children: React.ReactNode;
}) {
  const { preloadedCourseSettings } = useAppData();
  const settings = usePreloadedQuery(preloadedCourseSettings);
  const updateGoal = useUpdateDailyGoal();
  const t = useTranslations('AppPage.dailyGoal');

  const [open, setOpen] = React.useState(false);
  const [customValue, setCustomValue] = React.useState('');

  if (!settings) return <>{children}</>;

  const current = settings.dailyTimeGoalMinutes;

  const applyGoal = async (minutes: number) => {
    setOpen(false);
    setCustomValue('');
    await updateGoal({
      courseId: settings.courseId,
      dailyTimeGoalMinutes: minutes,
    });
  };

  const parsedCustom = parseCustomGoal(customValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-60 p-3"
        align="start"
        data-testid="daily-goal-popover"
      >
        <p className="mb-2 text-sm font-medium">{t('editTitle')}</p>
        <div className="grid grid-cols-5 gap-1.5">
          {DAILY_TIME_PRESETS.map((minutes) => (
            <GoalPresetTile
              key={minutes}
              active={current === minutes}
              onClick={() => applyGoal(minutes)}
              data-testid={`daily-goal-preset-${minutes}`}
            >
              {minutes}
            </GoalPresetTile>
          ))}
        </div>
        <form
          className="mt-2 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsedCustom != null) void applyGoal(parsedCustom);
          }}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={DAILY_TIME_CUSTOM_MIN}
            max={DAILY_TIME_CUSTOM_MAX}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder={t('customPlaceholder')}
            className="h-8 flex-1 text-xs"
            data-testid="daily-goal-custom-input"
          />
          <span className="text-muted-xs">{t('minutesUnit')}</span>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={parsedCustom == null}
            className="h-8 px-2.5 text-xs"
          >
            {t('set')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
