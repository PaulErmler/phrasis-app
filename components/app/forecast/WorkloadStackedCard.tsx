'use client';

import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { addDays } from '@/lib/dateStrings';
import { formatTimeMs } from '@/lib/formatTime';
import {
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
  addCount: number;
  onAddCountChange: (n: number) => void;
  /** Extra load of the current stepper value vs. adding nothing. */
  whatIfDelta: { reviews: number; minutes: number };
};

const PLOT_HEIGHT = 104;

/** Same-day event weight per displayed segment class, used only to
 * proportion a day's stack in time mode (the day TOTAL is the model's
 * estimatedMinutes; these split it). Young-ish classes repeat more, matching
 * the model's event multipliers; backlog blends young and mature. */
const SEGMENT_TIME_WEIGHT = {
  backlog: 1.35,
  young: 1.5,
  mature: 1.1,
  returns: 1.5,
  whatIf: 1.5,
} as const;

type SegmentKey = keyof typeof SEGMENT_TIME_WEIGHT;

const SEGMENT_ORDER: SegmentKey[] = [
  'backlog',
  'young',
  'mature',
  'returns',
  'whatIf',
];

const SEGMENT_CLASS: Record<SegmentKey, string> = {
  backlog: 'bg-accent-orange/80',
  young: 'bg-primary/45',
  mature: 'bg-primary/80',
  returns: 'bg-primary/15',
  whatIf: 'bg-primary/15',
};

/** Striped fills mark ESTIMATES (returns 135°, what-if 45°) — the visual
 * contract that solid = exact schedule, striped = model. */
const SEGMENT_STRIPE: Partial<Record<SegmentKey, React.CSSProperties>> = {
  returns: {
    backgroundImage:
      'repeating-linear-gradient(135deg, color-mix(in srgb, var(--primary) 55%, transparent) 0 2px, transparent 2px 6px)',
  },
  whatIf: {
    backgroundImage:
      'repeating-linear-gradient(45deg, color-mix(in srgb, var(--primary) 55%, transparent) 0 2px, transparent 2px 6px)',
  },
};

function segmentCards(day: WorkloadDay): Record<SegmentKey, number> {
  return {
    backlog: day.scheduled.backlog,
    young: day.scheduled.young,
    mature: day.scheduled.mature,
    returns: day.estimated.returns,
    whatIf: day.estimated.whatIfAdds + day.estimated.typicalAdds,
  };
}

/** A day's segment values in the leading unit. Cards mode shows raw counts;
 * time mode splits the day's estimatedMinutes by event weight so the stack
 * height always agrees with its minute cap. */
function segmentValues(
  day: WorkloadDay,
  unit: WorkloadUnit,
): Record<SegmentKey, number> {
  const cards = segmentCards(day);
  if (unit === 'cards') return cards;
  const weighted = SEGMENT_ORDER.map(
    (key) => cards[key] * SEGMENT_TIME_WEIGHT[key],
  );
  const total = weighted.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return { backlog: 0, young: 0, mature: 0, returns: 0, whatIf: 0 };
  }
  const out = {} as Record<SegmentKey, number>;
  SEGMENT_ORDER.forEach((key, i) => {
    out[key] = (weighted[i] / total) * day.estimatedMinutes;
  });
  return out;
}

const dayTotal = (day: WorkloadDay, unit: WorkloadUnit) =>
  unit === 'time'
    ? day.estimatedMinutes
    : day.scheduled.total + day.estimated.total;

const fmtMin = (minutes: number) => formatTimeMs(minutes * 60_000);

/** Recessive gridline step: at most ~3 lines at a clean 1/2/5×10ⁿ value. */
function gridStep(max: number): number {
  for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500]) {
    if (max / step <= 3.5) return step;
  }
  return 1000;
}

/**
 * The shipping workload card (artifact prototype "V2 composed"): stacked
 * exact schedule (backlog / young / mature), striped estimate layers
 * (second-wave returns, what-if adds), a dashed usual-pace line, and the
 * "+X cards" stepper. Purely presentational — all data arrives via props,
 * so tests and previews can feed fixtures without Convex.
 */
export function WorkloadStackedCard({
  forecast,
  today,
  unit = 'time',
  isProvisional = false,
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
  const dayLabel = (offset: number) => {
    if (offset === 0) return t('today');
    const [y, m, d] = addDays(today, offset).split('-').map(Number);
    return weekdayFormatter.format(new Date(Date.UTC(y, m - 1, d)));
  };

  const totals = days.map((day) => dayTotal(day, unit));
  const isEmpty = days.every(
    (day) => day.scheduled.total === 0 && day.estimated.total === 0,
  );
  const pace = isTime ? rates.avgDailyMinutes : rates.avgDailyReviews;
  const showPace = pace > 0.5;
  const max = Math.max(...totals, showPace ? pace : 0, 1) * 1.12;
  const step = gridStep(max);
  const gridValues: number[] = [];
  for (let value = step; value <= max; value += step) gridValues.push(value);
  const peakIndex = totals.indexOf(Math.max(...totals));

  const backlog = days[0].scheduled.backlog;
  const backlogMinutes = Math.max(
    1,
    Math.round(segmentValues(days[0], 'time').backlog),
  );
  const hasReturns = days.some((d) => d.estimated.returns > 0);
  const hasWhatIf = days.some(
    (d) => d.estimated.whatIfAdds + d.estimated.typicalAdds > 0,
  );

  const todayMinutes = fmtMin(days[0].estimatedMinutes);
  const weekMinutes = fmtMin(forecast.weekMinutes);

  return (
    <div className={cn(isProvisional && 'opacity-70 transition-opacity')}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{t('title')}</h3>
          <p className="text-muted-xs mt-0.5">
            {isTime ? (
              <>
                <span className="font-semibold text-foreground/80">
                  {t('approxToday', { value: todayMinutes })}
                </span>
                {' · '}
                {t('thisWeek', { value: weekMinutes })}
              </>
            ) : (
              <>
                <span className="font-semibold text-foreground/80">
                  {t('cardsToday', {
                    count: days[0].scheduled.total,
                    time: todayMinutes,
                  })}
                </span>
                {' · '}
                {t('thisWeek', { value: weekMinutes })}
              </>
            )}
          </p>
        </div>
        {backlog > 0 && (
          <span className="shrink-0 rounded-full bg-accent-orange/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-accent-orange">
            {isTime
              ? t('overdueTime', { value: `${backlogMinutes}m` })
              : t('overdue', { count: backlog })}
          </span>
        )}
      </div>

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
                  {value}
                  {isTime ? 'm' : ''}
                </span>
              </div>
            ))}
            <div className="flex" style={{ height: PLOT_HEIGHT + 22 + 24 }}>
              {days.map((day) => {
                const segs = segmentValues(day, unit);
                const total = dayTotal(day, unit);
                const cardsTotal =
                  day.scheduled.total + day.estimated.total;
                const showCap =
                  day.offset === 0 || (day.offset === peakIndex && total > 0);
                return (
                  <div
                    key={day.offset}
                    role="img"
                    aria-label={t('dayAria', {
                      day: dayLabel(day.offset),
                      scheduled: day.scheduled.total,
                      estimated: day.estimated.total,
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
                          ? `${day.estimatedMinutes}m`
                          : cardsTotal
                        : ''}
                    </span>
                    <div
                      className="flex w-[22px] flex-col-reverse gap-[2px]"
                      style={{ height: (total / max) * PLOT_HEIGHT }}
                    >
                      {SEGMENT_ORDER.map((key, i) => {
                        const value = segs[key];
                        if (value <= 0) return null;
                        const isTop = SEGMENT_ORDER.slice(i + 1).every(
                          (later) => segs[later] <= 0,
                        );
                        return (
                          <div
                            key={key}
                            className={cn(
                              'w-full',
                              SEGMENT_CLASS[key],
                              isTop && 'rounded-t-[4px]',
                            )}
                            style={{
                              height: Math.max(
                                (value / max) * PLOT_HEIGHT,
                                3,
                              ),
                              ...SEGMENT_STRIPE[key],
                            }}
                          />
                        );
                      })}
                    </div>
                    <span
                      className={cn(
                        'mt-[6px] text-[10px] leading-none',
                        day.offset === 0
                          ? 'font-semibold text-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {dayLabel(day.offset)}
                    </span>
                    <span className="mt-[3px] text-[9px] leading-none tabular-nums text-muted-foreground">
                      {isTime
                        ? t('cardsShort', { count: cardsTotal })
                        : `≈${day.estimatedMinutes}m`}
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
                style={{ bottom: 22 + (Math.min(pace, max) / max) * PLOT_HEIGHT }}
              >
                <span className="absolute right-0 top-[-15px] bg-card px-1 text-[9px] text-muted-foreground">
                  {t('paceLine', {
                    value: isTime
                      ? `≈${Math.max(1, Math.round(pace))}m`
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
                <Minus className="size-3.5" />
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
                <Plus className="size-3.5" />
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

          <div className="text-muted-xs mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
            {backlog > 0 && (
              <LegendKey className="bg-accent-orange/80">
                {t('legendOverdue')}
              </LegendKey>
            )}
            <LegendKey className="bg-primary/45">{t('legendYoung')}</LegendKey>
            <LegendKey className="bg-primary/80">{t('legendMature')}</LegendKey>
            {hasReturns && (
              <LegendKey
                className="bg-primary/15"
                style={SEGMENT_STRIPE.returns}
              >
                {t('legendReturns')}
              </LegendKey>
            )}
            {hasWhatIf && (
              <LegendKey className="bg-primary/15" style={SEGMENT_STRIPE.whatIf}>
                {t('legendWhatIf', { count: addCount })}
              </LegendKey>
            )}
            {showPace && (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 border-t-2 border-dashed border-muted-foreground/50" />
                {t('legendPace')}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LegendKey({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn('inline-block size-[9px] rounded-[2.5px]', className)}
        style={style}
      />
      {children}
    </span>
  );
}
