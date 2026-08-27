'use client';

import * as React from 'react';
import { usePreloadedQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { useAppData } from '@/components/app/AppDataProvider';
import { useNowMinute } from '@/hooks/use-now-minute';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { getUserTimezone } from '@/lib/timezone';
import { dateInTimezone } from '@/lib/dateStrings';
import {
  buildWorkloadForecast,
  DEFAULT_WHAT_IF_ADD,
  isWorkloadForecastData,
  MIN_STARTED_CARDS_FOR_FORECAST,
  type WorkloadForecast,
  type WorkloadForecastData,
} from '@/lib/workloadForecast';

/**
 * Bump when `getWorkloadForecast`'s payload shape changes so stale
 * localStorage entries are keyed away instead of parsed. The shape guard
 * below still runs — the version protects against forgetting the bump, the
 * guard against truncated/corrupted entries within a version.
 */
const CACHE_VERSION = 'v2';

/** Cached payloads may be `null` (the query's no-course result) — valid. */
const isCachedPayloadValid = (value: unknown) =>
  value === null || isWorkloadForecastData(value);

export type UseWorkloadForecastResult = {
  /** Model output for the current what-if value; null while loading. */
  forecast: WorkloadForecast | null;
  /** The raw query payload the forecast was built from (source of `today`). */
  data: WorkloadForecastData | null;
  /** Extra load the current stepper value adds vs. adding nothing. */
  whatIfDelta: { reviews: number; minutes: number };
  /** The user opted out via the hideWorkloadForecast preference. */
  hidden: boolean;
  /** Below the minimum-activity gate (MIN_STARTED_CARDS_FOR_FORECAST): the
   * card renders its locked teaser instead of a chart. Null while the first
   * payload is still loading, so the card can hold the skeleton rather than
   * flashing the lock at someone who has long since passed the gate. */
  locked: boolean | null;
  /** Rendering last-known data while the writing seed fills the aggregates. */
  isProvisional: boolean;
  reviewMode: 'audio' | 'full';
  addCount: number;
  setAddCount: (n: number) => void;
};

/**
 * Data + model plumbing for the home-screen workload forecast card.
 *
 * Composes the proven due-pills patterns: the `hideWorkloadForecast` gate
 * doubles as a query skip; `now` is minute-quantized (no wall clock in
 * queries);
 * `reviewMode`/`filter` are passed explicitly from the optimistically-updated
 * settings cache so the bars flip in the same frame as the home toggles; the
 * localStorage-backed query keeps a warm first paint (a stale payload still
 * renders consistently — all dates derive from its own `today`); and
 * mid-writing-seed payloads fall back to the last good one instead of
 * rendering confident zeros.
 */
export function useWorkloadForecast({
  skip,
}: { skip?: boolean } = {}): UseWorkloadForecastResult {
  const { courseSettings: settings, preloadedSettings } = useAppData();
  const userSettings = usePreloadedQuery(preloadedSettings);
  // Own preference, independent of hideDueCounts. Show only on an explicit
  // opt-in (`false`); unset = hidden by default, like the pills.
  const hidden = userSettings?.hideWorkloadForecast !== false;

  const filter = settings?.studyContentFilter ?? 'both';
  const reviewMode = settings?.reviewMode ?? 'audio';
  const timezone = getUserTimezone();
  const now = useNowMinute(skip || hidden);
  const today = dateInTimezone(now, timezone);

  const data = useCachedQuery(
    api.features.stats.getWorkloadForecast,
    skip || hidden || !settings
      ? 'skip'
      : { timezone, today, now, reviewMode, filter },
    `workload_${CACHE_VERSION}_${settings?.courseId ?? 'none'}_${reviewMode}_${filter}`,
    isCachedPayloadValid,
  );

  const isProvisional = data?.preparingWriting === true;
  const lastGoodRef = React.useRef<WorkloadForecastData | null>(null);
  if (data != null && !isProvisional) lastGoodRef.current = data;
  const effective =
    (isProvisional ? null : (data ?? null)) ?? lastGoodRef.current;

  // The minimum-activity gate needs the payload, so unlike the preference it
  // cannot skip the query — the subscription stays live and the card unlocks
  // reactively the moment the Nth card starts learning.
  const locked =
    effective === null
      ? null
      : effective.startedCards < MIN_STARTED_CARDS_FOR_FORECAST;

  const [addCount, setAddCount] = React.useState(DEFAULT_WHAT_IF_ADD);

  const forecast = React.useMemo(
    () =>
      effective
        ? buildWorkloadForecast(effective, {
            addCount,
            // Deliberately off in the shipped card: the model supports
            // continuing the user's typical adds/day on future days
            // (estimated.typicalAdds; unit-tested), kept as a future
            // toggle rather than wired to UI.
            includeTypicalAdds: false,
            reviewMode,
          })
        : null,
    [effective, addCount, reviewMode],
  );

  // The stepper note ("+17 reviews · +6 min") is the delta against adding
  // nothing; the model is pure and cheap, so a second run is the simplest
  // correct way to get it.
  const whatIfDelta = React.useMemo(() => {
    if (!effective || !forecast || addCount === 0)
      return { reviews: 0, minutes: 0 };
    const baseline = buildWorkloadForecast(effective, {
      addCount: 0,
      includeTypicalAdds: false,
      reviewMode,
    });
    return {
      reviews: Math.max(0, forecast.weekReviews - baseline.weekReviews),
      minutes: Math.max(0, forecast.weekMinutes - baseline.weekMinutes),
    };
  }, [effective, forecast, addCount, reviewMode]);

  return {
    forecast,
    data: effective,
    whatIfDelta,
    hidden,
    locked,
    isProvisional,
    reviewMode,
    addCount,
    setAddCount,
  };
}
