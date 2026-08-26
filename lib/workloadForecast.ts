/**
 * Pure model behind the home-screen workload forecast: turns the exact
 * per-day scheduled due counts (from `getWorkloadForecast`) plus a trailing
 * window of the user's own behaviour (grade rates, pace, add habits) into
 * per-day chart data — scheduled segments, estimated overlays, and
 * time-needed framing.
 *
 * Shared app/Convex module (no imports from convex/), unit-tested in
 * tests/unit/lib/workloadForecast.test.ts.
 *
 * The hard rule the model keeps: `scheduled` numbers are EXACT (straight
 * from the due-date aggregates); everything under `estimated` is a model —
 * same-day repeats, the "second wave" (cards due early in the window that
 * get reviewed and become due again within it), and what-if additions. The
 * two are never blended. Kernels are derived by running the real scheduler
 * (lib/scheduling.ts), so they track FSRS parameter changes automatically —
 * but not the deck's POPULATION: the mature kernel needs to know how stable
 * the due cards actually are, which the per-deck stability-bucket counts
 * (`matureStabilityCounts`, from the cardsByStabilityBucketAndDueDate
 * aggregate) supply, with a young-deck prior as the thin-data fallback.
 */

import {
  scheduleCard,
  type CardSchedulingState,
  type FSRSRating,
  type FsrsCardState,
} from './scheduling';
import { mergedDueCount } from './constants/dueCounts';

export const WORKLOAD_DAYS = 7;
export const WORKLOAD_HISTORY_WINDOW_DAYS = 14;
export const DEFAULT_WHAT_IF_ADD = 5;
export const WHAT_IF_ADD_MIN = 0;
/**
 * Minimum-activity gate: the forecast card renders LOCKED until this many
 * cards have entered a non-'new' state (payload `startedCards`). Below it
 * every estimate is a pure prior — fabricated-looking numbers for a user
 * who has barely started — so the card shows a teaser instead of a chart,
 * the same "keep going and this turns on" contract the projections widget
 * uses (lib/projections.ts, basis 'empty').
 */
export const MIN_STARTED_CARDS_FOR_FORECAST = 5;

/** Upper bound of the what-if stepper. Deliberately above
 * MAX_CARDS_PER_BATCH (15): the preview may explore bigger plans than one
 * add-batch allows. */
export const WHAT_IF_ADD_MAX = 50;

const DAY_MS = 86_400_000;

/**
 * Priors used while the trailing window holds fewer than
 * `MIN_RATING_SAMPLE` FSRS grades. pAgain ≈ (1 − request_retention 0.95)
 * with a margin for real-world drift; the good/hard/easy split matches the
 * broad shape seen in FSRS datasets. Replaced entirely by the user's own
 * distribution once the sample is large enough.
 */
export const MIN_RATING_SAMPLE = 20;
const PRIOR_RATES: RatingRates = {
  pAgain: 0.1,
  pHard: 0.1,
  pGood: 0.7,
  pEasy: 0.1,
};

/**
 * Seconds-per-review priors per mode while the window has no timed reviews:
 * Shadowing is listen-and-rate (~20s), Writing types the answer (~45s).
 * Clamped to a sane band either way so one weird window can't produce
 * absurd time estimates.
 */
const SECONDS_PER_REVIEW_PRIOR = { audio: 20, full: 45 } as const;
const SECONDS_PER_REVIEW_MIN = 3;
const SECONDS_PER_REVIEW_MAX = 120;

/**
 * Same-day grading events per card sighting, priced by the STATE BUCKET the
 * card is in when it comes up:
 *
 *   - new (never studied): `deriveNewCardEvents` — the initial-reps setting
 *     early-exited by the user's observed Understood rate; the writing track
 *     has no pre-review phase, so Writing mode is a flat 2 learning steps.
 *   - learning / relearning (mid-steps): this constant — the card runs its
 *     remaining short steps the same day.
 *   - review (mature, including every estimated return and add echo — they
 *     re-land graduated): `1 + pAgain`, one review plus the probabilistic
 *     lapse loop.
 */
const YOUNG_EVENTS_PER_SIGHTING = 1.5;

/**
 * Expected same-day grading events for a NEW card first studied in the
 * given mode. Writing (`full`) has no pre-review phase (reviewCard forces
 * the review phase for that track), so a new card is just the two FSRS
 * learning steps. Shadowing runs up to `initialReviewCount − 2` pre-review
 * steps first, each exited early by "Understood" at the user's observed
 * rate — approximated linearly by the window's stillLearning share (prior
 * 0.5 while the sample is thin).
 */
export function deriveNewCardEvents(
  reviewMode: 'audio' | 'full',
  initialReviewCount: number,
  ratingCounts: RatingCounts,
): number {
  if (reviewMode === 'full') return 2;
  const seen = ratingCounts.stillLearning + ratingCounts.understood;
  const pStill =
    seen >= MIN_RATING_SAMPLE ? ratingCounts.stillLearning / seen : 0.5;
  return clamp(
    2 + (initialReviewCount - 2) * pStill,
    2,
    Math.max(initialReviewCount, 2),
  );
}

/**
 * Stability buckets for mature (Review-state) cards, shared with the
 * `cardsByStabilityBucketAndDueDate` aggregate (convex/db/stats/
 * cardAggregates.ts derives its namespaces from these, so the two can't
 * drift). The per-deck counts of due-in-window cards per bucket calibrate
 * the mature return kernel; each bucket is represented by one stability the
 * kernel simulates.
 */
export const STABILITY_BUCKETS = [
  { key: 's0', maxStabilityDays: 3.5, representativeStabilityDays: 2 },
  { key: 's1', maxStabilityDays: 8, representativeStabilityDays: 5 },
  { key: 's2', maxStabilityDays: 21, representativeStabilityDays: 12 },
  { key: 's3', maxStabilityDays: Infinity, representativeStabilityDays: 45 },
] as const;

export type StabilityBucketKey = (typeof STABILITY_BUCKETS)[number]['key'];

export type MatureStabilityCounts = Record<StabilityBucketKey, number>;

/** Bucket a Review-state card's FSRS stability (days). Total — any finite
 * number lands in a bucket. */
export function stabilityBucketKey(stabilityDays: number): StabilityBucketKey {
  for (const bucket of STABILITY_BUCKETS) {
    if (stabilityDays < bucket.maxStabilityDays) return bucket.key;
  }
  return STABILITY_BUCKETS[STABILITY_BUCKETS.length - 1].key;
}

/** Below this many bucketed due cards the observed mix is noise (or the
 * backfill hasn't covered the deck yet) and the prior applies. */
export const MIN_STABILITY_SAMPLE = 10;

export type MatureStabilityMix = Array<{
  stabilityDays: number;
  weight: number;
}>;

/** PRIOR stability mix for mature cards due inside the window, used while
 * no observed bucket counts are available. The short, front-loaded
 * stabilities match a YOUNG deck — the right prior for the thin-data
 * cohort; established decks get their own observed mix instead. */
const MATURE_STABILITY_MIX: MatureStabilityMix = [
  { stabilityDays: 2, weight: 0.4 },
  { stabilityDays: 5, weight: 0.35 },
  { stabilityDays: 10, weight: 0.25 },
];

/**
 * The stability mix the mature return kernel runs over: observed per-bucket
 * due-card counts normalized into weights over the bucket representatives,
 * or the young-deck prior while counts are absent or the sample is thin.
 */
export function deriveStabilityMix(
  counts: MatureStabilityCounts | undefined,
): MatureStabilityMix {
  if (!counts) return MATURE_STABILITY_MIX;
  const total = STABILITY_BUCKETS.reduce((sum, b) => sum + counts[b.key], 0);
  if (total < MIN_STABILITY_SAMPLE) return MATURE_STABILITY_MIX;
  return STABILITY_BUCKETS.filter((b) => counts[b.key] > 0).map((b) => ({
    stabilityDays: b.representativeStabilityDays,
    weight: counts[b.key] / total,
  }));
}

export type DayStateCounts = {
  new: number;
  learning: number;
  relearning: number;
  review: number;
};

export type RatingCounts = {
  stillLearning: number;
  understood: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
};

/** Mirrors the non-null return of `api.features.stats.getWorkloadForecast`
 * (kept structurally in sync by the hook's typing; lib/ stays free of
 * convex/_generated imports). */
export type WorkloadForecastData = {
  today: string;
  dayStartMs: number;
  availableNow: DayStateCounts;
  laterToday: DayStateCounts;
  futureDays: DayStateCounts[];
  history: {
    windowDays: number;
    activeDays: number;
    reps: number;
    cardsReviewed: number;
    newCards: number;
    timeMs: number;
    reviewsByMode: { audio: number; full: number };
    timeMsByMode: { audio: number; full: number };
    ratingCounts: RatingCounts;
  };
  initialReviewCount: number;
  /** Deck-wide cards in any non-'new' active state — see
   * MIN_STARTED_CARDS_FOR_FORECAST. */
  startedCards: number;
  /** Per-stability-bucket counts of mature cards due inside the window,
   * from the shared-track cardsByStabilityBucketAndDueDate aggregate.
   * Omitted while the backfill hasn't covered the deck (the query's
   * cold-start guard) — the prior mix applies then. */
  matureStabilityCounts?: MatureStabilityCounts;
  preparingWriting?: boolean;
};

export type WorkloadModelParams = {
  /** What-if stepper value: cards hypothetically added today. Clamped to
   * [WHAT_IF_ADD_MIN, WHAT_IF_ADD_MAX]. */
  addCount: number;
  /** Continue the user's typical adds/day on future days too. */
  includeTypicalAdds: boolean;
  /** Which mode's pace converts events to minutes. */
  reviewMode: 'audio' | 'full';
};

export type RatingRates = {
  pAgain: number;
  pHard: number;
  pGood: number;
  pEasy: number;
};

export type WorkloadDay = {
  /** offset days from `today` (0..WORKLOAD_DAYS-1). Date = addDays(today, offset),
   * left to the caller so this module needs no date arithmetic. */
  offset: number;
  /** EXACT scheduled counts from the aggregates. */
  scheduled: {
    /** Day 0 only: the overdue/due-now backlog — learning + relearning +
     * review cards already available (the `mergedDueCount` rule the due
     * pills use). Never-studied 'new' cards are NOT backlog: the pills call
     * them "new", so labeling them "overdue" here would contradict the
     * pills in the same viewport. They count as young instead. */
    backlog: number;
    /** Ungraduated load: learning + relearning + 'new'-state cards (day 0:
     * available-now new cards plus the later-today bucket; future days: the
     * whole day). */
    young: number;
    /** Graduated Review-state cards. */
    mature: number;
    total: number;
  };
  /** ESTIMATED overlay (model output; the UI folds it into the day's
   * single load bar). */
  estimated: {
    /** Second wave + same-day repeats: cards seen earlier in the window
     * re-landing here, in card sightings. */
    returns: number;
    /** Kernel-convolved impact of the what-if stepper adds (day 0). */
    whatIfAdds: number;
    /** Kernel-convolved continuation of typical adds/day (future days). */
    typicalAdds: number;
    total: number;
  };
  /** Grading events expected for the day (sightings × per-class same-day
   * event multipliers), rounded. */
  estimatedReviews: number;
  /** estimatedReviews × the user's seconds-per-review, whole minutes
   * (min 1 when the day has any load). Display value — the week totals sum
   * the unrounded events instead. */
  estimatedMinutes: number;
  /** The what-if stepper's share of this day, for the bar's hypothetical
   * cap: cards (rounded, = estimated.whatIfAdds) and the fractional slice
   * of estimatedMinutes its events account for. Zero at addCount 0. */
  whatIf: { cards: number; minutes: number };
};

export type WorkloadForecast = {
  days: WorkloadDay[];
  rates: RatingRates & {
    typicalAddsPerDay: number;
    /** Graded (audio + full) reviews in the window. Below MIN_PACE_SAMPLE
     * the pace averages are noise — the chart swaps its reference line to
     * the daily goal then. */
    gradedReviews: number;
    /** Graded (audio + full) reviews per active day in the window — free
     * play excluded, matching what the bars count. */
    avgDailyReviews: number;
    /** Graded review minutes per active day — same graded-only rule. */
    avgDailyMinutes: number;
    secondsPerReview: number;
    /** FSRS grades in the window; below MIN_RATING_SAMPLE the priors apply. */
    sampleSize: number;
  };
  /** Where the load of ONE card added today lands over the window. */
  addKernel: number[];
  weekReviews: number;
  weekMinutes: number;
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

const youngOf = (c: DayStateCounts) => c.new + c.learning + c.relearning;

const zeroDayCounts = (): DayStateCounts => ({
  new: 0,
  learning: 0,
  relearning: 0,
  review: 0,
});

const isDayStateCounts = (value: unknown): value is DayStateCounts =>
  typeof value === 'object' &&
  value !== null &&
  (['new', 'learning', 'relearning', 'review'] as const).every(
    (k) => typeof (value as Record<string, unknown>)[k] === 'number',
  );

const hasNumbers = (value: unknown, keys: readonly string[]): boolean =>
  typeof value === 'object' &&
  value !== null &&
  keys.every((k) => typeof (value as Record<string, unknown>)[k] === 'number');

/**
 * Runtime shape check covering everything `buildWorkloadForecast`
 * dereferences. Live payloads are guaranteed by the query's `returns`
 * validator; this exists for localStorage-cached ones, whose shape can lag
 * a deploy — a payload failing it must be discarded, not rendered.
 */
export function isWorkloadForecastData(
  value: unknown,
): value is WorkloadForecastData {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  const history = d.history as Record<string, unknown> | null | undefined;
  return (
    typeof d.today === 'string' &&
    typeof d.dayStartMs === 'number' &&
    typeof d.initialReviewCount === 'number' &&
    typeof d.startedCards === 'number' &&
    (d.matureStabilityCounts === undefined ||
      hasNumbers(d.matureStabilityCounts, ['s0', 's1', 's2', 's3'])) &&
    isDayStateCounts(d.availableNow) &&
    isDayStateCounts(d.laterToday) &&
    Array.isArray(d.futureDays) &&
    d.futureDays.length === WORKLOAD_DAYS - 1 &&
    d.futureDays.every(isDayStateCounts) &&
    typeof history === 'object' &&
    history !== null &&
    hasNumbers(history, [
      'windowDays',
      'activeDays',
      'reps',
      'cardsReviewed',
      'newCards',
      'timeMs',
    ]) &&
    hasNumbers(history.reviewsByMode, ['audio', 'full']) &&
    hasNumbers(history.timeMsByMode, ['audio', 'full']) &&
    hasNumbers(history.ratingCounts, [
      'stillLearning',
      'understood',
      'again',
      'hard',
      'good',
      'easy',
    ])
  );
}

/** The user's FSRS grade distribution over the window, or the priors while
 * the sample is thin. preReview grades are excluded — they're binary and say
 * nothing about lapse behaviour. */
export function deriveRatingRates(ratingCounts: RatingCounts): RatingRates {
  const total =
    ratingCounts.again + ratingCounts.hard + ratingCounts.good + ratingCounts.easy;
  if (total < MIN_RATING_SAMPLE) return { ...PRIOR_RATES };
  return {
    pAgain: ratingCounts.again / total,
    pHard: ratingCounts.hard / total,
    pGood: ratingCounts.good / total,
    pEasy: ratingCounts.easy / total,
  };
}

/** Below this many timed reviews a window mean is noise — a couple of
 * left-open cards can read as a 100s "pace" — so the prior applies, the
 * same rule MIN_RATING_SAMPLE plays for the grade distribution. */
export const MIN_PACE_SAMPLE = 10;

/** Average seconds per grading event in the given mode: per-mode window data
 * first, overall window second, mode prior last — each accepted only at
 * MIN_PACE_SAMPLE or more reviews, and always clamped. */
export function deriveSecondsPerReview(
  history: WorkloadForecastData['history'],
  reviewMode: 'audio' | 'full',
): number {
  const modeReviews = history.reviewsByMode[reviewMode];
  const modeTimeMs = history.timeMsByMode[reviewMode];
  const raw =
    modeReviews >= MIN_PACE_SAMPLE && modeTimeMs > 0
      ? modeTimeMs / modeReviews / 1000
      : history.reps >= MIN_PACE_SAMPLE && history.timeMs > 0
        ? history.timeMs / history.reps / 1000
        : SECONDS_PER_REVIEW_PRIOR[reviewMode];
  return clamp(raw, SECONDS_PER_REVIEW_MIN, SECONDS_PER_REVIEW_MAX);
}

/** Run the real scheduler from `state` at `now`, rating `good`, until the
 * next due lands at least a day out (or the step budget runs dry). Returns
 * the whole-day offset from `t0` and the state to branch from. */
function advanceToFirstDayOut(
  state: CardSchedulingState,
  t0: number,
  initialReviewCount: number,
): { offset: number; state: CardSchedulingState } {
  let cur = state;
  let now = t0;
  for (let i = 0; i < 12; i++) {
    const r = scheduleCard(cur, cur.schedulingPhase === 'preReview' ? 'understood' : 'good', initialReviewCount, now);
    cur = {
      schedulingPhase: r.schedulingPhase,
      preReviewCount: r.preReviewCount,
      dueDate: r.dueDate,
      fsrsState: r.fsrsState,
    };
    if (r.dueDate - t0 >= DAY_MS) {
      return { offset: Math.round((r.dueDate - t0) / DAY_MS), state: cur };
    }
    now = r.dueDate; // review again when it comes back, minutes later
  }
  return { offset: 1, state: cur };
}

/** Day offset produced by one rating from `state` reviewed at day `atOffset`
 * (relative to t0), or null when it falls outside the window. */
function ratingOffset(
  state: CardSchedulingState,
  rating: FSRSRating,
  t0: number,
  atOffset: number,
  initialReviewCount: number,
): { offset: number; state: CardSchedulingState } | null {
  const now = t0 + atOffset * DAY_MS;
  const r = scheduleCard(state, rating, initialReviewCount, now);
  const offset = Math.round((r.dueDate - t0) / DAY_MS);
  if (offset <= atOffset || offset >= WORKLOAD_DAYS) return null;
  return {
    offset,
    state: {
      schedulingPhase: r.schedulingPhase,
      preReviewCount: r.preReviewCount,
      dueDate: r.dueDate,
      fsrsState: r.fsrsState,
    },
  };
}

export type ReturnKernels = {
  young: number[];
  mature: number[];
  /** Kernel for a card that already RETURNED once inside the window: its
   * stability is short (fresh graduation / post-lapse) no matter how old
   * the deck is, so later generations echo through this, not through the
   * deck-average mature kernel. */
  rebound: number[];
};

/** Stability (days) of a card re-landed inside the window — post-lapse or
 * freshly graduated, deck age irrelevant. */
const REBOUND_STABILITY_DAYS = 2;

/**
 * SINGLE-GENERATION return kernels: where a card REVIEWED on day k next
 * lands inside the window, per class, as fractional sightings at day-offset
 * Δ (index 0 unused — same-day repeats live in the event multipliers).
 * Higher generations (the re-landed card getting reviewed and landing
 * again) are expanded separately in `expandResponses`, where each further
 * generation follows the REBOUND kernel — a card that just re-landed is on
 * a short stability whatever the deck's mix says. Keeping generations out
 * of the kernels is what makes the composition convergent instead of
 * geometric.
 *
 * young: learning/relearning/ungraduated cards run their remaining learning
 * steps same-day and land the graduation interval (~next day).
 * mature: Review-state cards return inside the window mainly via 'again'
 * (relearn today, land ~tomorrow) and 'hard' on short-stability cards; the
 * kernel runs the real scheduler over the deck's stability mix (observed
 * per-bucket counts via `deriveStabilityMix`, or the young-deck prior), so
 * good/easy on stable cards naturally fall outside the window.
 */
export function deriveReturnKernels(opts: {
  initialReviewCount: number;
  rates: RatingRates;
  /** From `deriveStabilityMix`; defaults to the young-deck prior. */
  stabilityMix?: MatureStabilityMix;
}): ReturnKernels {
  const { initialReviewCount, rates } = opts;
  const stabilityMix = opts.stabilityMix ?? MATURE_STABILITY_MIX;
  const t0 = 0; // scheduleCard only cares about relative time

  const young = new Array<number>(WORKLOAD_DAYS).fill(0);
  const fresh = advanceToFirstDayOut(
    // FSRS-phase card with no state yet ≈ a card mid learning steps.
    { schedulingPhase: 'review', preReviewCount: initialReviewCount, dueDate: t0, fsrsState: null },
    t0,
    initialReviewCount,
  );
  if (fresh.offset < WORKLOAD_DAYS) {
    young[fresh.offset] += 1;
  }

  const reviewKernel = (
    mix: MatureStabilityMix,
  ): number[] => {
    const kernel = new Array<number>(WORKLOAD_DAYS).fill(0);
    for (const { stabilityDays, weight } of mix) {
      const state: CardSchedulingState = {
        schedulingPhase: 'review',
        preReviewCount: initialReviewCount,
        dueDate: t0,
        fsrsState: makeMatureFsrsState(stabilityDays, t0),
      };
      // 'again': relearning steps run out the same day; the graduating
      // interval lands the card back ~next day.
      const againNext = advanceToFirstDayOut(
        applyRating(state, 'again', initialReviewCount, t0),
        t0,
        initialReviewCount,
      );
      if (againNext.offset < WORKLOAD_DAYS) {
        kernel[againNext.offset] += rates.pAgain * weight;
      }
      for (const rating of ['hard', 'good', 'easy'] as const) {
        const p = rates[rating === 'hard' ? 'pHard' : rating === 'good' ? 'pGood' : 'pEasy'];
        if (p <= 0) continue;
        const next = ratingOffset(state, rating, t0, 0, initialReviewCount);
        if (next) kernel[next.offset] += p * weight;
      }
    }
    return kernel;
  };

  const mature = reviewKernel(stabilityMix);
  const rebound = reviewKernel([
    { stabilityDays: REBOUND_STABILITY_DAYS, weight: 1 },
  ]);
  return { young, mature, rebound };
}

/** c[d] = Σ_{i+j=d, j≥1} a[i]·b[j] — window-bounded convolution where `b`
 * describes a NEXT-generation landing (its day-0 entry is never used). */
function convolveWindow(a: number[], b: number[]): number[] {
  const c = new Array<number>(WORKLOAD_DAYS).fill(0);
  for (let i = 0; i < WORKLOAD_DAYS; i++) {
    if (a[i] === 0) continue;
    for (let j = 1; i + j < WORKLOAD_DAYS; j++) {
      c[i + j] += a[i] * b[j];
    }
  }
  return c;
}

const addArrays = (...arrs: number[][]): number[] =>
  arrs.reduce(
    (acc, a) => acc.map((v, i) => v + a[i]),
    new Array<number>(WORKLOAD_DAYS).fill(0),
  );

export type ReturnResponses = { young: number[]; mature: number[] };

/**
 * Expand the single-generation kernels into full within-window responses.
 * A first-generation landing comes from the class kernel (young graduation,
 * or the deck-mix mature kernel); every LATER generation is a card that
 * just re-landed — short stability by construction — so it echoes through
 * the rebound kernel (three self-orders; the kernels sum well below 1, so
 * the truncated tail is a few percent). Decaying by construction, so the
 * day composition can be a plain sum with no recursion.
 */
export function expandResponses(kernels: ReturnKernels): ReturnResponses {
  const r1 = kernels.rebound;
  const reboundResponse = addArrays(
    r1,
    convolveWindow(r1, r1),
    convolveWindow(convolveWindow(r1, r1), r1),
  );
  const mature = addArrays(
    kernels.mature,
    convolveWindow(kernels.mature, reboundResponse),
  );
  const young = addArrays(
    kernels.young,
    convolveWindow(kernels.young, reboundResponse),
  );
  return { young, mature };
}

/**
 * `buildWorkloadForecast` runs on every payload identity change — once a
 * minute via the hook's quantized `now` arg, twice per render with the
 * what-if baseline — but the responses depend only on `initialReviewCount`,
 * the rate distribution, and the deck's stability mix, which change rarely.
 * A single cached entry covers the one home screen / one rate set that
 * exists in practice, so the dozens of real `scheduleCard` runs behind the
 * kernels don't repeat every tick.
 */
let responsesCache: { key: string; responses: ReturnResponses } | null = null;
function memoizedResponses(
  initialReviewCount: number,
  rates: RatingRates,
  stabilityMix: MatureStabilityMix,
): ReturnResponses {
  const mixKey = stabilityMix
    .map((m) => `${m.stabilityDays}:${m.weight}`)
    .join(',');
  const key = `${initialReviewCount}|${rates.pAgain}|${rates.pHard}|${rates.pGood}|${rates.pEasy}|${mixKey}`;
  if (responsesCache?.key !== key) {
    responsesCache = {
      key,
      responses: expandResponses(
        deriveReturnKernels({ initialReviewCount, rates, stabilityMix }),
      ),
    };
  }
  return responsesCache.responses;
}

function applyRating(
  state: CardSchedulingState,
  rating: FSRSRating,
  initialReviewCount: number,
  now: number,
): CardSchedulingState {
  const r = scheduleCard(state, rating, initialReviewCount, now);
  return {
    schedulingPhase: r.schedulingPhase,
    preReviewCount: r.preReviewCount,
    dueDate: r.dueDate,
    fsrsState: r.fsrsState,
  };
}

/** A Review-state ts-fsrs card with the given stability, due exactly now
 * (elapsed = its whole scheduled interval). */
function makeMatureFsrsState(stabilityDays: number, now: number): FsrsCardState {
  return {
    due: now,
    stability: stabilityDays,
    difficulty: 5,
    elapsedDays: stabilityDays,
    scheduledDays: stabilityDays,
    learningSteps: 0,
    reps: 5,
    lapses: 0,
    state: 2, // Review
    lastReview: now - stabilityDays * DAY_MS,
  };
}

/** Assemble the full forecast. Pure; safe to run on every render. */
export function buildWorkloadForecast(
  data: WorkloadForecastData,
  params: WorkloadModelParams,
): WorkloadForecast {
  const addCount = clamp(
    Math.round(params.addCount),
    WHAT_IF_ADD_MIN,
    WHAT_IF_ADD_MAX,
  );
  const { history } = data;
  const rates = deriveRatingRates(history.ratingCounts);
  const secondsPerReview = deriveSecondsPerReview(history, params.reviewMode);
  const stabilityMix = deriveStabilityMix(data.matureStabilityCounts);
  const responses = memoizedResponses(
    data.initialReviewCount,
    rates,
    stabilityMix,
  );
  const addKernel = [...responses.young];
  addKernel[0] = 1; // an added card is studied the day it's added
  const newCardEvents = deriveNewCardEvents(
    params.reviewMode,
    data.initialReviewCount,
    history.ratingCounts,
  );

  const typicalAddsPerDay =
    history.activeDays > 0 ? history.newCards / history.activeDays : 0;

  // The composition loops below index days 0..WORKLOAD_DAYS-1, so the input
  // must span exactly that window even if a stale cached payload was built
  // for a different one: clamp and zero-fill rather than crash the render.
  const futureDays = (
    Array.isArray(data.futureDays) ? data.futureDays : []
  ).slice(0, WORKLOAD_DAYS - 1);
  while (futureDays.length < WORKLOAD_DAYS - 1) {
    futureDays.push(zeroDayCounts());
  }

  // Exact per-day scheduled splits. Day 0 keeps its backlog/later-today
  // structure; future days are their state split.
  const scheduledDays = [
    {
      // Overdue = the pills' merged due rule; available-now 'new' cards are
      // young (see the WorkloadDay field docs). Day-0 total is unchanged by
      // the split — new cards just move between segments.
      backlog: mergedDueCount(data.availableNow),
      young: data.availableNow.new + youngOf(data.laterToday),
      mature: data.laterToday.review,
      // Young/mature across the WHOLE day drive the return composition;
      // the new/learning split prices the same-day events per state bucket.
      dayYoung: youngOf(data.availableNow) + youngOf(data.laterToday),
      dayNew: data.availableNow.new + data.laterToday.new,
      dayLearning:
        data.availableNow.learning +
        data.availableNow.relearning +
        data.laterToday.learning +
        data.laterToday.relearning,
      dayMature: data.availableNow.review + data.laterToday.review,
    },
    ...futureDays.map((c) => ({
      backlog: 0,
      young: youngOf(c),
      mature: c.review,
      dayYoung: youngOf(c),
      dayNew: c.new,
      dayLearning: c.learning + c.relearning,
      dayMature: c.review,
    })),
  ];

  // Adds per day feeding the add-kernel convolution: the stepper's cards
  // today, plus (optionally) the user's typical pace continuing tomorrow on.
  const addsPerDay = scheduledDays.map((_, d) =>
    d === 0 ? addCount : params.includeTypicalAdds ? typicalAddsPerDay : 0,
  );

  // Day composition: every scheduled sighting on day k re-lands later per
  // its class response (all generations already expanded in the responses,
  // so this is a plain sum — no recursion, no blowup). Adds convolve with
  // the full add kernel; k === 0 is the stepper's what-if, later days the
  // typical-pace continuation.
  const returnsF = new Array<number>(WORKLOAD_DAYS).fill(0);
  const whatIfF = new Array<number>(WORKLOAD_DAYS).fill(0);
  const typicalF = new Array<number>(WORKLOAD_DAYS).fill(0);
  for (let d = 0; d < WORKLOAD_DAYS; d++) {
    for (let k = 0; k < d; k++) {
      const delta = d - k;
      returnsF[d] +=
        scheduledDays[k].dayYoung * responses.young[delta] +
        scheduledDays[k].dayMature * responses.mature[delta];
    }
    for (let k = 0; k <= d; k++) {
      const contribution = addsPerDay[k] * addKernel[d - k];
      if (k === 0) whatIfF[d] += contribution;
      else typicalF[d] += contribution;
    }
  }

  const dayEvents = new Array<number>(WORKLOAD_DAYS).fill(0);
  const days: WorkloadDay[] = scheduledDays.map((s, d) => {
    const scheduledTotal = s.backlog + s.young + s.mature;
    const returns = returnsF[d];
    const whatIfAdds = whatIfF[d];
    const typicalAdds = typicalF[d];
    // Same-day grading events, priced by the state bucket each sighting is
    // in when it comes up (see the constant docs): fresh adds are studied
    // as NEW cards on their add day; every estimated return and add echo
    // re-lands GRADUATED, so it costs a mature sighting, not a young one.
    const addsToday = addsPerDay[d];
    const addEchoes = Math.max(0, whatIfAdds + typicalAdds - addsToday);
    const events =
      (s.dayMature + returns + addEchoes) * (1 + rates.pAgain) +
      s.dayLearning * YOUNG_EVENTS_PER_SIGHTING +
      (s.dayNew + addsToday) * newCardEvents;
    dayEvents[d] = events;
    const estimatedReviews = Math.round(events);
    const estimatedMinutes =
      events > 0
        ? Math.max(1, Math.round((events * secondsPerReview) / 60))
        : 0;
    // The stepper's slice of the day, for the bar's hypothetical cap: on
    // day 0 its cards are studied as new adds, later they echo as mature
    // sightings.
    const whatIfEvents =
      d === 0
        ? whatIfAdds * newCardEvents
        : whatIfAdds * (1 + rates.pAgain);
    return {
      offset: d,
      scheduled: {
        backlog: s.backlog,
        young: s.young,
        mature: s.mature,
        total: scheduledTotal,
      },
      estimated: {
        returns: Math.round(returns),
        whatIfAdds: Math.round(whatIfAdds),
        typicalAdds: Math.round(typicalAdds),
        // Sum of the ROUNDED parts (not the rounded raw sum), so a bar
        // built from the displayed segments always adds up to this total.
        total:
          Math.round(returns) + Math.round(whatIfAdds) + Math.round(typicalAdds),
      },
      estimatedReviews,
      estimatedMinutes,
      whatIf: {
        cards: Math.round(whatIfAdds),
        minutes: events > 0 ? (whatIfEvents / events) * estimatedMinutes : 0,
      },
    };
  });

  // Week totals from the UNROUNDED per-day events, rounded once — seven
  // per-day roundings (each floored at a minute) would otherwise guarantee
  // ≥7 min/week for any non-empty deck.
  const weekEvents = dayEvents.reduce((sum, e) => sum + e, 0);

  // Graded (audio + full) reviews only — free play says nothing about
  // review load, and the pace line must compare like with like.
  const gradedReviews =
    history.reviewsByMode.audio + history.reviewsByMode.full;
  const gradedTimeMs = history.timeMsByMode.audio + history.timeMsByMode.full;

  return {
    days,
    rates: {
      ...rates,
      typicalAddsPerDay,
      gradedReviews,
      avgDailyReviews:
        history.activeDays > 0 ? gradedReviews / history.activeDays : 0,
      avgDailyMinutes:
        history.activeDays > 0
          ? gradedTimeMs / history.activeDays / 60_000
          : 0,
      secondsPerReview,
      sampleSize:
        history.ratingCounts.again +
        history.ratingCounts.hard +
        history.ratingCounts.good +
        history.ratingCounts.easy,
    },
    addKernel,
    weekReviews: Math.round(weekEvents),
    weekMinutes:
      weekEvents > 0
        ? Math.max(1, Math.round((weekEvents * secondsPerReview) / 60))
        : 0,
  };
}
