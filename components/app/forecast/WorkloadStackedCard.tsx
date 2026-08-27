'use client';

import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { addDays } from '@/lib/dateStrings';
import { formatTimeMs } from '@/lib/formatTime';
import {
  MIN_PACE_SAMPLE,
  WHAT_IF_ADD_MAX,
  WHAT_IF_ADD_MIN,
  type WorkloadDay,
  type WorkloadForecast,
} from '@/lib/workloadForecast';

/** Which unit leads the chart. The other unit stays visible as the per-day
 * sub-label, so this only swaps emphasis. Time is the default: minutes are
 * what a day gets planned around. */
export type WorkloadUnit = 'time' | 'cards';

type Props = {
  forecast: WorkloadForecast;
  /** Canonical day the payload was computed for (weekday labels derive from
   * it, so a cached payload stays internally consistent). */
  today: string;
  unit?: WorkloadUnit;
  isProvisional?: boolean;
  /** The course's daily study-time goal — the reference line while the
   * window has too few graded reviews for a trustworthy usual-pace average. */
  dailyGoalMinutes?: number;
  addCount: number;
  onAddCountChange: (n: number) => void;
  /** Extra load of the current stepper value vs. adding nothing. */
  whatIfDelta: { reviews: number; minutes: number };
};

const PLOT_HEIGHT = 104;

/** Striped fill marks the what-if cap — the one hypothetical, user-dialed
 * slice of an otherwise solid load bar. */
const WHAT_IF_STRIPE: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, color-mix(in srgb, var(--primary) 55%, transparent) 0 2px, transparent 2px 6px)',
};

const dayTotal = (day: WorkloadDay, unit: WorkloadUnit) =>
  unit === 'time'
    ? day.estimatedMinutes
    : day.scheduled.total + day.estimated.total;

/** The stepper's slice of a day's bar, in the leading unit. The model keeps
 * it ≤ the day total; re-clamped here so a rounded cards split can never
 * overshoot the bar. */
const dayWhatIf = (day: WorkloadDay, unit: WorkloadUnit) =>
  Math.min(
    unit === 'time' ? day.whatIf.minutes : day.whatIf.cards,
    dayTotal(day, unit),
  );

const fmtMin = (minutes: number) => formatTimeMs(minutes * 60_000);

/** Recessive gridline step: at most ~3 lines at a clean 1/2/5×10ⁿ value. */
function gridStep(max: number): number {
  for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500]) {
    if (max / step <= 3.5) return step;
  }
  return 1000;
}

/**
 * The shipping workload chart: one solid load bar per day (the model's
 * scheduled + estimated totals, folded — the internal exact-vs-estimated
 * taxonomy stays in lib/workloadForecast.ts), a striped cap for the what-if
 * stepper's adds, a dashed usual-pace line, and the "+X cards" stepper.
 * Purely presentational — all data arrives via props, so tests and previews
 * can feed fixtures without Convex. The title + summary row lives in the
 * collapsible wrapper (WorkloadForecastCard).
 */
export function WorkloadStackedCard({
  forecast,
  today,
  unit = 'time',
  isProvisional = false,
  dailyGoalMinutes,
  addCount,
  onAddCountChange,
  whatIfDelta,
}: Props) {
  const t = useTranslations('AppPage.workload');
  const locale = useLocale();

  const { days, rates } = forecast;
  const isTime = unit === 'time';

  const weekdayFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
    [locale],
  );
  // One label per day, memoized: each render otherwise re-derives every
  // label twice (aria + visible) through addDays + an Intl format call.
  const dayLabels = React.useMemo(
    () =>
      days.map((day) => {
        if (day.offset === 0) return t('today');
        const [y, m, d] = addDays(today, day.offset).split('-').map(Number);
        return weekdayFormatter.format(new Date(Date.UTC(y, m - 1, d)));
      }),
    [days, today, weekdayFormatter, t],
  );

  const totals = days.map((day) => dayTotal(day, unit));
  // Emptiness is a property of the REAL data: scheduled cards, their
  // second-wave returns, and the typical-adds continuation. The what-if
  // stepper is hypothetical — its +5 default must not conjure workload bars
  // for a course with nothing scheduled at all.
  const isEmpty = days.every(
    (day) =>
      day.scheduled.total === 0 &&
      day.estimated.returns === 0 &&
      day.estimated.typicalAdds === 0,
  );
  // Reference line: the observed usual pace once the window holds enough
  // graded reviews to mean something; before that, the user's daily goal
  // (time mode only — the goal is a minutes number).
  const paceReliable = rates.gradedReviews >= MIN_PACE_SAMPLE;
  const observedPace = isTime ? rates.avgDailyMinutes : rates.avgDailyReviews;
  const usingGoal = !paceReliable && isTime && (dailyGoalMinutes ?? 0) > 0;
  const pace = usingGoal ? dailyGoalMinutes! : observedPace;
  const showPace = usingGoal || (paceReliable && observedPace > 0.5);
  const max = Math.max(...totals, showPace ? pace : 0, 1) * 1.12;
  const step = gridStep(max);
  const gridValues: number[] = [];
  for (let value = step; value <= max; value += step) gridValues.push(value);
  const peakIndex = totals.indexOf(Math.max(...totals));

  const hasWhatIf = days.some((day) => dayWhatIf(day, unit) > 0);

  // fmtMin renders 0 as "0s"; a zero-load DAY label should read "0m".
  const fmtMinLabel = (minutes: number) =>
    minutes > 0 ? fmtMin(minutes) : t('axisMinutes', { value: 0 });

  return (
    <div className={cn(isProvisional && 'opacity-70 transition-opacity')}>
      {isEmpty ? (
        <p className="text-muted-xs py-6 text-center">{t('empty')}</p>
      ) : (
        <>
          <div className="relative mt-3">
            {/* Gridlines + right-edge ticks, recessive. */}
            {gridValues.map((value) => (
              <div
                key={value}
                className="pointer-events-none absolute inset-x-0 border-t border-border/60"
                style={{ bottom: 22 + (value / max) * PLOT_HEIGHT }}
              >
                <span className="absolute right-0 top-[-13px] text-[9px] tabular-nums text-muted-foreground">
                  {isTime ? t('axisMinutes', { value }) : value}
                </span>
              </div>
            ))}
            <div className="flex" style={{ height: PLOT_HEIGHT + 22 + 24 }}>
              {days.map((day, i) => {
                const total = dayTotal(day, unit);
                const whatIf = dayWhatIf(day, unit);
                const base = total - whatIf;
                const cardsTotal = day.scheduled.total + day.estimated.total;
                const showCap =
                  day.offset === 0 || (day.offset === peakIndex && total > 0);
                return (
                  <div
                    key={day.offset}
                    role="img"
                    aria-label={t('dayAria', {
                      day: dayLabels[i],
                      cards: cardsTotal,
                      minutes: day.estimatedMinutes,
                    })}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end"
                  >
                    <span
                      className={cn(
                        'mb-1 min-h-[11px] text-[10px] font-semibold leading-none tabular-nums',
                        day.offset === 0
                          ? 'text-foreground/80'
                          : 'text-muted-foreground',
                      )}
                    >
                      {showCap
                        ? isTime
                          ? fmtMinLabel(day.estimatedMinutes)
                          : cardsTotal
                        : ''}
                    </span>
                    {/* flex-grow apportions the container height by value
                        (gaps are taken out first), so the bar can neither
                        overflow its value-scaled height nor silently shrink;
                        min-h-px keeps slivers visible as hairlines. */}
                    <div
                      className="flex w-[22px] flex-col-reverse gap-[2px] overflow-hidden"
                      style={{ height: (total / max) * PLOT_HEIGHT }}
                    >
                      {base > 0 && (
                        <div
                          className={cn(
                            'min-h-px w-full bg-primary/70',
                            whatIf <= 0 && 'rounded-t-[4px]',
                          )}
                          style={{ flexGrow: base, flexBasis: 0 }}
                        />
                      )}
                      {whatIf > 0 && (
                        <div
                          data-testid="whatif-cap"
                          className="min-h-px w-full rounded-t-[4px] bg-primary/15"
                          style={{
                            flexGrow: whatIf,
                            flexBasis: 0,
                            ...WHAT_IF_STRIPE,
                          }}
                        />
                      )}
                    </div>
                    <span
                      className={cn(
                        'mt-[6px] text-[10px] leading-none',
                        day.offset === 0
                          ? 'font-semibold text-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {dayLabels[i]}
                    </span>
                    <span className="mt-[3px] text-[9px] leading-none tabular-nums text-muted-foreground">
                      {isTime
                        ? t('cardsShort', { count: cardsTotal })
                        : t('approxShort', {
                            value: fmtMinLabel(day.estimatedMinutes),
                          })}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Baseline between bars and day labels. */}
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-border"
              style={{ bottom: 22 }}
            />
            {showPace && (
              <div
                className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-dashed border-muted-foreground/50"
                style={{
                  bottom: 22 + (Math.min(pace, max) / max) * PLOT_HEIGHT,
                }}
              >
                <span className="absolute right-0 top-[-15px] bg-card px-1 text-[9px] text-muted-foreground">
                  {usingGoal
                    ? t('goalLine', { value: fmtMin(pace) })
                    : t('paceLine', {
                        value: isTime
                          ? t('approxShort', {
                              value: fmtMin(Math.max(1, Math.round(pace))),
                            })
                          : Math.round(pace),
                      })}
                </span>
              </div>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div
              className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5"
              role="group"
              aria-label={t('stepperLabel')}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label={t('stepperFewer')}
                disabled={addCount <= WHAT_IF_ADD_MIN}
                onClick={() =>
                  onAddCountChange(Math.max(WHAT_IF_ADD_MIN, addCount - 1))
                }
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-[64px] text-center text-xs font-semibold tabular-nums">
                {t('stepperValue', { count: addCount })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label={t('stepperMore')}
                disabled={addCount >= WHAT_IF_ADD_MAX}
                onClick={() =>
                  onAddCountChange(Math.min(WHAT_IF_ADD_MAX, addCount + 1))
                }
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-muted-xs text-right">
              {addCount === 0
                ? t('whatIfHint')
                : t('whatIfNote', {
                    reviews: whatIfDelta.reviews,
                    time: fmtMin(Math.max(1, whatIfDelta.minutes)),
                  })}
            </p>
          </div>

          {(hasWhatIf || showPace) && (
            <div className="text-muted-xs mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px]">
              {/* What-if stays left; the reference-line key sits right,
                  under the right-anchored line label it explains. */}
              <span>
                {hasWhatIf && (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block size-[9px] rounded-[2.5px] bg-primary/15"
                      style={WHAT_IF_STRIPE}
                    />
                    {t('legendWhatIf', { count: addCount })}
                  </span>
                )}
              </span>
              {showPace && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3.5 border-t-2 border-dashed border-muted-foreground/50" />
                  {usingGoal ? t('legendGoal') : t('legendPace')}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
