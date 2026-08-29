'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslations, useFormatter } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { useNowMinute } from '@/hooks/use-now-minute';
import { getUserTimezone } from '@/lib/timezone';
import { dateInTimezone } from '@/lib/dateStrings';
import { cn } from '@/lib/utils';
import { TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';

const ROTATE_INTERVAL_MS = 8000;
// Per-course via cacheSuffix (like the query cache), so switching courses
// doesn't inherit another course's rotation offset.
const CURSOR_STORAGE_KEY = 'projection_slot_cursor';

type Indicator = NonNullable<
  ReturnType<typeof useProjections>['data']
>['indicators'][number];

function useProjections(skip: boolean, cacheSuffix: string) {
  // getUserTimezone falls back to 'UTC' when the browser reports an empty
  // zone, matching the rest of the app instead of sending '' to the query.
  const timezone = getUserTimezone();
  // useNowMinute (not Date.now at render): when the rotation isn't running
  // (reduced motion, or a single frame), nothing else re-renders this
  // component, and `today` would stay pinned to yesterday across midnight.
  const now = useNowMinute();
  const today = dateInTimezone(now, timezone);
  const data = useCachedQuery(
    api.features.projections.getProjections,
    skip ? ('skip' as const) : { timezone, today },
    `projections_${today}${cacheSuffix}`,
  );
  return { data };
}

/** Midday-UTC Date for a "YYYY-MM-DD" string. Safe for date-only display. */
const toDate = (dateStr: string) => new Date(`${dateStr}T12:00:00Z`);

/** Signed shortest distance from idx to i on a ring of n items. */
function shortestOffset(i: number, idx: number, n: number): number {
  let d = (i - idx) % n;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

/** Half the rotating block's height. The rotation axis sits this far
 * behind the face plane, which makes it read as a solid block, not a card. */
const BLOCK_HALF_DEPTH = 19;

/**
 * The homescreen's rotating long-term motivation slot: cycles through
 * pace-based projections (words by year end, next-level ETA, sentences/hour,
 * …) computed by `getProjections`. Sits on the right of the daily-goal row.
 *
 * Interaction: auto-advances every 8s while visible; the whole block is a
 * button. Tap advances immediately. Clickability is signaled by the pager
 * dots, the chevron, hover surface and press-scale. Auto-rotation is
 * disabled under prefers-reduced-motion (tap still works). `replayKey`
 * restarts the rotation at a fresh indicator on every home visit.
 */
export function RotatingProjection({
  skip,
  replayKey,
  hasStudiedToday,
  cacheSuffix = '',
  className,
}: {
  skip: boolean;
  replayKey: number | string;
  /** Steers the first frame: session yield before studying, counterfactual after. */
  hasStudiedToday: boolean;
  cacheSuffix?: string;
  className?: string;
}) {
  const t = useTranslations('AppPage.projections');
  const format = useFormatter();
  const reducedMotion = useReducedMotion();
  const { data } = useProjections(skip, cacheSuffix);

  // The variety cursor is SNAPSHOT once per visit into state and is an
  // explicit dependency of the frame order below. Reading localStorage
  // inside the memo instead had two bugs: repeat visits never re-rotated
  // (the cursor wasn't a dep), and a live query re-emit mid-visit picked up
  // the already-bumped cursor and swapped the fact under the user's eyes
  // with no turn animation.
  const cursorKey = `${CURSOR_STORAGE_KEY}${cacheSuffix}`;
  const readCursor = React.useCallback((): number => {
    try {
      return Number(localStorage.getItem(cursorKey)) || 0;
    } catch {
      // localStorage unavailable (SSR/private mode), start at 0.
      return 0;
    }
  }, [cursorKey]);
  const [visitCursor, setVisitCursor] = React.useState(readCursor);

  // Order: contextual first frame, then the server order rotated by the
  // per-visit cursor so repeat visitors see variety.
  const frames = React.useMemo(() => {
    const indicators = (data?.indicators ?? []).filter(
      (i) => i.kind !== 'empty',
    );
    if (indicators.length === 0) return [];
    const firstKind = hasStudiedToday
      ? indicators.some((i) => i.kind === 'counterfactualWords')
        ? 'counterfactualWords'
        : null
      : indicators.some((i) => i.kind === 'sessionYield')
        ? 'sessionYield'
        : null;
    const first = indicators.filter((i) => i.kind === firstKind);
    const rest = indicators.filter((i) => i.kind !== firstKind);
    const rotated = rest.length
      ? [
          ...rest.slice(visitCursor % rest.length),
          ...rest.slice(0, visitCursor % rest.length),
        ]
      : rest;
    return [...first, ...rotated];
  }, [data, hasStudiedToday, visitCursor]);

  const [idx, setIdx] = React.useState(0);

  // New visit: restart at the contextual first frame, snapshot the stored
  // cursor for this visit's order, and bump it for the next visit.
  React.useEffect(() => {
    setIdx(0);
    const cursor = readCursor();
    setVisitCursor(cursor);
    try {
      localStorage.setItem(cursorKey, String(cursor + 1));
    } catch {
      // Best-effort only.
    }
  }, [replayKey, cursorKey, readCursor]);

  const advance = React.useCallback(() => {
    setIdx((i) => (frames.length ? (i + 1) % frames.length : 0));
  }, [frames.length]);

  React.useEffect(() => {
    if (skip || reducedMotion || frames.length < 2) return;
    const id = setInterval(advance, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
    // `idx` in deps restarts the 8s window after a manual tap.
  }, [skip, reducedMotion, frames.length, advance, idx]);

  if (data == null) {
    // Query still in flight with no warm `useCachedQuery` entry, i.e. the
    // first home visit in a given browser profile, where every other tile
    // paints instantly from its own cache and this one has nothing to fall
    // back on. Reserve the slot's footprint instead of collapsing to nothing,
    // so the daily-goal row doesn't read as "the projection is gone" (and
    // doesn't reflow when the numbers land).
    return (
      <span
        aria-hidden
        className={cn(
          'ml-auto block h-9 w-48 shrink-0 md:w-56 lg:w-64',
          className,
        )}
        data-testid="rotating-projection-pending"
        /* Keep the tour anchor during loading so the projections step
         * doesn't degrade to an unanchored popover when the tour fires
         * before the query resolves (exactly the first-visit case). */
        data-tutorial={TUTORIAL_ANCHORS.projections}
      />
    );
  }
  if (frames.length === 0) {
    // Zero-history teaser (basis 'empty'): static, not a rotating button.
    return (
      <span
        className={cn(
          'ml-auto max-w-48 text-right text-muted-xs md:max-w-56 lg:max-w-64',
          className,
        )}
        data-testid="rotating-projection-empty"
        data-tutorial={TUTORIAL_ANCHORS.projections}
      >
        {t('empty')}
      </span>
    );
  }
  const currentIndex = Math.min(idx, frames.length - 1);
  const current = renderFrame(frames[currentIndex], data.basis, t, format);
  const { big, label } = current;

  return (
    <motion.button
      type="button"
      onClick={advance}
      // Deliberately no vertical pan gesture: it needed `touch-none`, which
      // swallowed any scroll that happened to start on this ~144×36px widget
      // and left the home screen stuck. Tap already advances, and that is the
      // affordance the label advertises.
      data-testid="rotating-projection"
      data-tutorial={TUTORIAL_ANCHORS.projections}
      aria-label={`${big} — ${label}. ${t('cycleHint')}`}
      className={cn(
        'group -my-1 ml-auto flex min-w-0 shrink items-center gap-1 rounded-lg px-2 py-1 text-right sm:shrink-0',
        'transition-[background-color,transform] hover:bg-muted/60 active:scale-[0.97]',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col items-end gap-1">
        {/* Screen readers get the current fact as plain text; the 3D drum
         * below is presentation-only. Deliberately NOT a live region: the
         * facts rotate on an 8s timer, so `aria-live` turned this into an
         * unsolicited announcement every 8 seconds for anyone parked on the
         * home screen. The button's own aria-label carries the same text and
         * re-announces on focus/activation, which is the only time the user
         * actually asked for it. */}
        <span className="sr-only">{`${big} — ${label}`}</span>
        {/* Rotating 3D block: the facts are faces of a solid block turning
         * around its horizontal axis. One face visible at rest; advancing
         * tips the current face away over the top while the next rolls in
         * from below (face angle = off × -90° around an origin pushed back
         * by half the block depth). */}
        <div
          aria-hidden
          className="relative h-9 w-48 max-w-full md:w-56 lg:w-64"
          style={{ perspective: 260 }}
        >
          {frames.map((f, i) => {
            const off = shortestOffset(i, idx, frames.length);
            // Faces more than one notch away can never be seen mid-turn.
            if (Math.abs(off) > 1) return null;
            // The front face was already rendered for the aria/sr-only text.
            const face =
              i === currentIndex
                ? current
                : renderFrame(f, data.basis, t, format);
            return (
              <div
                key={`${f.kind}-${i}`}
                className="absolute inset-x-0 top-1/2"
                style={{ transform: 'translateY(-50%)' }}
              >
                <motion.div
                  initial={false}
                  animate={{
                    rotateX: off * -90,
                    // Fades out fast as the face tips edge-on, so at rest
                    // only the front face exists visually.
                    opacity: Math.max(0, 1 - Math.abs(off) * 1.15),
                  }}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 300, damping: 26 }
                  }
                  className="flex flex-col items-end gap-0.5"
                  style={{
                    transformOrigin: `center center -${BLOCK_HALF_DEPTH}px`,
                    backfaceVisibility: 'hidden',
                  }}
                >
                  <span className="max-w-full truncate text-sm font-semibold tabular-nums leading-tight text-primary">
                    {face.big}
                  </span>
                  <span className="max-w-full truncate text-muted-xs leading-none">
                    {face.label}
                  </span>
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.button>
  );
}

function renderFrame(
  frame: Indicator,
  basis: 'observed' | 'firstSession' | 'goal' | 'empty',
  t: ReturnType<typeof useTranslations<'AppPage.projections'>>,
  format: ReturnType<typeof useFormatter>,
): { big: string; label: string } {
  // "~2,400" for projections, "10,000+" when capped, plain for exact values.
  const approx = (n: number, capped = false) =>
    capped ? `${format.number(n)}+` : `~${format.number(n)}`;
  const day = (dateStr: string) =>
    format.dateTime(toDate(dateStr), { month: 'short', day: 'numeric' });
  // Pace-based ETAs read "at your current speed", unless the pace is the
  // goal-conditional fallback (long pause), where that claim would be false.
  const paceLabel =
    basis === 'goal' ? t('goalBasisLabel') : t('atCurrentSpeedLabel');

  switch (frame.kind) {
    case 'endOfYearWords':
      return {
        big: t('wordsBig', { words: approx(frame.words, frame.capped) }),
        label: t('endOfYearLabel', { year: frame.year }),
      };
    case 'oneYearWords':
      return {
        big: t('wordsBig', { words: approx(frame.words, frame.capped) }),
        label: t('oneYearLabel'),
      };
    case 'endOfMonthWords':
      return {
        big: t('wordsBig', { words: approx(frame.words, frame.capped) }),
        label: t('endOfMonthLabel', {
          month: format.dateTime(toDate(frame.monthDate), { month: 'long' }),
        }),
      };
    case 'counterfactualWords':
      return {
        big: t('wordsBig', { words: approx(frame.boostedWords, frame.capped) }),
        label: t('counterfactualLabel'),
      };
    case 'sessionYield':
      return {
        big: t('sessionYieldBig', { words: frame.words }),
        label: t('sessionYieldLabel', { goal: frame.goalMinutes }),
      };
    case 'endOfYearSentences':
      return {
        big: t('sentencesBig', { sentences: approx(frame.sentences) }),
        label: t('endOfYearLabel', { year: frame.year }),
      };
    case 'sentencesPerHour':
      return {
        big: t('avgSentencesBig', { rate: frame.rate }),
        label: t('perStudyHourLabel'),
      };
    case 'nextLevel':
      return {
        big: t('nextLevelBig', {
          code: frame.nextCode ?? frame.currentCode,
          days: frame.etaDays,
        }),
        label: frame.nextCode != null ? paceLabel : t('nextLevelCompleteLabel'),
      };
    case 'levelByYearEnd':
      return {
        big: t('levelByYearEndBig', { code: frame.code }),
        label: t('levelByYearEndLabel', { year: frame.year }),
      };
    case 'nextWordMilestone':
      return {
        big: t('wordsBig', { words: format.number(frame.milestone) }),
        label: t('inDaysLabel', { days: frame.etaDays }),
      };
    case 'studyTimeMilestone':
      return {
        big: t('studyTimeBig', { hours: frame.hours }),
        label: t('aroundDateLabel', { date: day(frame.etaDate) }),
      };
    case 'empty':
      return { big: '', label: '' };
  }
}
