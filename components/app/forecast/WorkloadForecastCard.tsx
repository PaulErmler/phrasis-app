'use client';

import * as React from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { formatTimeMs } from '@/lib/formatTime';
import { useAppData } from '@/components/app/AppDataProvider';
import { useWorkloadForecast } from '@/hooks/use-workload-forecast';
import { TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';
import {
  WorkloadStackedCard,
  type WorkloadUnit,
} from '@/components/app/forecast/WorkloadStackedCard';

/** The unit that leads the shipped card. Time-first per the design decision
 * (minutes are what a day is planned around); flip to 'cards' to lead with
 * counts — the other unit always stays visible as the sub-labels. */
const WORKLOAD_UNIT_DEFAULT: WorkloadUnit = 'time';

/** Remembers the user's last expand/collapse choice. Default: collapsed —
 * the summary row carries the numbers; the chart is a tap away. */
const EXPANDED_STORAGE_KEY = 'workloadForecastExpanded';

/**
 * Home-screen 7-day workload forecast. Hidden via its own
 * `hideWorkloadForecast` preference (independent of the due-count pills,
 * which new accounts hide by default). `skip` pauses the live query while
 * the home view is kept-mounted but off screen — the same discipline as
 * DueCountsPills.
 *
 * Renders as a collapsible: a one-row summary (today + week load) that
 * expands into the full chart. Starts collapsed so the home screen stays
 * compact; the choice persists per browser via localStorage (read in an
 * effect, not the initializer, so hydration always matches the collapsed
 * server HTML).
 */
export function WorkloadForecastCard({ skip }: { skip?: boolean }) {
  const t = useTranslations('AppPage.workload');
  const { courseSettings } = useAppData();
  const {
    forecast,
    data,
    whatIfDelta,
    hidden,
    locked,
    isProvisional,
    addCount,
    setAddCount,
  } = useWorkloadForecast({ skip });

  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    try {
      if (localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true') {
        setExpanded(true);
      }
    } catch {
      // Storage unavailable (private mode, blocked): stay collapsed.
    }
  }, []);
  const onExpandedChange = (open: boolean) => {
    setExpanded(open);
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, String(open));
    } catch {
      // Non-persistent is fine; the toggle still works for this visit.
    }
  };

  if (hidden) return null;

  // Below the minimum-activity gate the estimates are pure priors, so the
  // card shows a teaser instead of a chart — the same "keep going and this
  // turns on" contract the projections widget uses. Not a Collapsible:
  // there is nothing behind it to open yet.
  if (locked) {
    return (
      <div
        className="card-surface p-3"
        data-testid="workload-forecast"
        data-tutorial={TUTORIAL_ANCHORS.workloadForecast}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight text-muted-foreground">
              {t('title')}
            </h3>
            <p className="text-muted-xs mt-0.5">{t('locked')}</p>
          </div>
          <Lock
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </div>
      </div>
    );
  }

  const isTime = WORKLOAD_UNIT_DEFAULT === 'time';
  const fmtMin = (minutes: number) => formatTimeMs(minutes * 60_000);
  const summary = forecast ? (
    <>
      <span className="font-semibold text-foreground/80">
        {isTime
          ? t('approxToday', {
              value: fmtMin(forecast.days[0].estimatedMinutes),
            })
          : t('cardsToday', {
              count: forecast.days[0].scheduled.total,
              time: fmtMin(forecast.days[0].estimatedMinutes),
            })}
      </span>
      {' · '}
      {t('thisWeek', { value: fmtMin(forecast.weekMinutes) })}
    </>
  ) : null;

  return (
    <div
      className="card-surface p-3"
      data-testid="workload-forecast"
      data-tutorial={TUTORIAL_ANCHORS.workloadForecast}
    >
      <Collapsible open={expanded} onOpenChange={onExpandedChange}>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 text-left">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">
              {t('title')}
            </h3>
            {summary ? (
              <p className="text-muted-xs mt-0.5">{summary}</p>
            ) : (
              <span className="mt-1 block h-3 w-40 animate-pulse rounded bg-muted/50" />
            )}
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {forecast && data ? (
            <div className="mt-1">
              <WorkloadStackedCard
                forecast={forecast}
                today={data.today}
                unit={WORKLOAD_UNIT_DEFAULT}
                isProvisional={isProvisional}
                dailyGoalMinutes={courseSettings?.dailyTimeGoalMinutes}
                addCount={addCount}
                onAddCountChange={setAddCount}
                whatIfDelta={whatIfDelta}
              />
            </div>
          ) : (
            // Fixed-height skeleton so the expanded card doesn't reflow when
            // data lands.
            <div className="mt-2 h-[200px] animate-pulse rounded-lg bg-muted/50" />
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
