'use client';

import * as React from 'react';

import { useWorkloadForecast } from '@/hooks/use-workload-forecast';
import {
  WorkloadStackedCard,
  type WorkloadUnit,
} from '@/components/app/forecast/WorkloadStackedCard';

/** The unit that leads the shipped card. Time-first per the design decision
 * (minutes are what a day is planned around); flip to 'cards' to lead with
 * counts — the other unit always stays visible as the sub-labels. */
const WORKLOAD_UNIT_DEFAULT: WorkloadUnit = 'time';

/**
 * Home-screen 7-day workload forecast. Hidden together with the due-count
 * pills (`hideDueCounts`), and `skip` pauses the live query while the home
 * view is kept-mounted but off screen — the same discipline as
 * DueCountsPills.
 */
export function WorkloadForecastCard({ skip }: { skip?: boolean }) {
  const {
    forecast,
    data,
    whatIfDelta,
    hidden,
    isProvisional,
    addCount,
    setAddCount,
  } = useWorkloadForecast({ skip });

  if (hidden) return null;

  return (
    <div
      className="card-surface p-3"
      data-testid="workload-forecast"
      data-tutorial="workload-forecast"
    >
      {forecast && data ? (
        <WorkloadStackedCard
          forecast={forecast}
          today={data.today}
          unit={WORKLOAD_UNIT_DEFAULT}
          isProvisional={isProvisional}
          addCount={addCount}
          onAddCountChange={setAddCount}
          whatIfDelta={whatIfDelta}
        />
      ) : (
        // Fixed-height skeleton so home doesn't reflow when data lands.
        <div className="h-[220px] animate-pulse rounded-lg bg-muted/50" />
      )}
    </div>
  );
}
