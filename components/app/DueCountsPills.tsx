'use client';

import * as React from 'react';
import { useQuery } from 'convex/react';
import { useTranslations } from 'next-intl';

import { api } from '@/convex/_generated/api';
import { useAppData } from '@/components/app/AppDataProvider';
import { useNowMinute } from '@/hooks/use-now-minute';
import { cn } from '@/lib/utils';

type Counts = {
  new: number;
  learning: number;
  relearning: number;
  review: number;
};

/**
 * Compact "N new · N learning · N review" pills for the Start Learning
 * area (Anki-style triad). Counts are filter-aware: the content-source
 * filter comes from the same (optimistically-updated) settings cache the
 * adjacent dropdown writes to, so switching the filter flips the numbers
 * in the same frame.
 *
 * "Learning" combines learning + relearning (cards mid-acquisition);
 * "Review" is graduated cards whose due date has lapsed; "New" is cards
 * never studied. While a refetch is in flight (filter switch, minute tick)
 * the last-known counts stay rendered to avoid a flash of empty pills
 * (same pattern as ProgressDisplay's card counts).
 */
export function DueCountsPills({ skip }: { skip?: boolean }) {
  const { courseSettings: settings } = useAppData();
  const t = useTranslations('AppPage.dueCounts');

  const filter = settings?.studyContentFilter ?? 'both';
  // Passed explicitly for the same reason as `filter`: this settings cache is
  // the one the adjacent Shadowing/Writing toggle optimistically writes, so
  // with separateModeTracking on the counts flip tracks in the same frame.
  const reviewMode = settings?.reviewMode;
  const now = useNowMinute(skip);
  const counts = useQuery(
    api.features.stats.getFilteredCardCounts,
    skip || !settings ? 'skip' : { filter, now, reviewMode },
  );

  // While the separateModeTracking writing seed is still running, the writing
  // aggregates hold only the already-seeded prefix, so the server flags the
  // counts as provisional rather than letting a confident 0/0/0/0 read as
  // "nothing to study". Treat them exactly like an in-flight refetch: keep the
  // last known numbers (or stay hidden if there are none yet) until the seed
  // finishes and real counts arrive.
  const isProvisional = counts?.preparingWriting === true;

  const lastCountsRef = React.useRef<Counts | null>(null);
  if (counts != null && !isProvisional) lastCountsRef.current = counts;
  const display = (isProvisional ? null : counts) ?? lastCountsRef.current;

  const learning = display
    ? display.learning + display.relearning
    : 0;

  // Reserve pill width while the first fetch is in flight so the
  // Shadowing/Writing toggle beside us doesn't reflow (and animate via
  // transition-all) when counts land.
  const pillClass =
    'rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5',
        !display && 'invisible pointer-events-none',
      )}
      aria-hidden={!display}
      data-testid="due-counts-pills"
      data-tutorial="due-counts"
    >
      <span
        className={cn(pillClass, 'bg-primary/10 text-primary')}
      >
        {t('new', { count: display?.new ?? 0 })}
      </span>
      <span
        className={cn(pillClass, 'bg-accent-orange/10 text-accent-orange')}
      >
        {t('learning', { count: learning })}
      </span>
      <span
        className={cn(pillClass, 'bg-success/10 text-success')}
      >
        {t('review', { count: display?.review ?? 0 })}
      </span>
    </div>
  );
}
