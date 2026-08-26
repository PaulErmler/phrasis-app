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
 * The hard rule the UI relies on: `scheduled` numbers are EXACT (straight
 * from the due-date aggregates); everything under `estimated` is a model —
 * same-day repeats, the "second wave" (cards due early in the window that
 * get reviewed and become due again within it), and what-if additions. The
 * two are never blended. Kernels are derived by running the real scheduler
 * (lib/scheduling.ts), so they track FSRS parameter changes automatically,
 * and the per-review history table records the prev→new due transitions
 * that can calibrate them later.
 */

import {
  scheduleCard,
  type CardSchedulingState,
  type FSRSRating,
  type FsrsCardState,
} from './scheduling';

export const WORKLOAD_DAYS = 7;
export const WORKLOAD_HISTORY_WINDOW_DAYS = 14;
export const DEFAULT_WHAT_IF_ADD = 5;
export const WHAT_IF_ADD_MIN = 0;
/** = MAX_CARDS_PER_BATCH — the most that can be added in one go anyway. */
export const WHAT_IF_ADD_MAX = 15;

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
 * Shadowing is listen-and-rate (~15s), Writing types the answer (~35s).
 * Clamped to a sane band either way so one weird window can't produce
 * absurd time estimates.
 */
const SECONDS_PER_REVIEW_PRIOR = { audio: 15, full: 35 } as const;
const SECONDS_PER_REVIEW_MIN = 3;
const SECONDS_PER_REVIEW_MAX = 120;

/**
 * Same-day grading events per card sighting. A mature card costs one event
 * plus its again-loop; a young card (learning/relearning/ungraduated, and
 * every estimated return or fresh add) runs its short learning steps the
 * same day. The young multiplier is a documented constant for now —
 * `reviewHistory` accumulates the data to calibrate it per user later.
 */
const YOUNG_EVENTS_PER_SIGHTING = 1.5;

/** Representative current stabilities (days) for mature cards due inside a
 * 7-day window, used to derive the mature return kernel. Cards due soon skew
 * toward short stabilities, hence the front-loaded weights. */
const MATURE_STABILITY_MIX: Array<{ stabilityDays: number; weight: number }> = [
  { stabilityDays: 2, weight: 0.4 },
  { stabilityDays: 5, weight: 0.35 },
  { stabilityDays: 10, weight: 0.25 },
];

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
    /** Day 0 only: everything already available now (overdue backlog + new). */
    backlog: number;
    /** Ungraduated load: learning + relearning + 'new'-state cards (day 0:
     * from the later-today bucket; future days: the whole day). */
    young: number;
    /** Graduated Review-state cards. */
    mature: number;
    total: number;
  };
  /** ESTIMATED overlay (model output, rendered striped). */
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
   * (min 1 when the day has any load). */
  estimatedMinutes: number;
};

export type WorkloadForecast = {
  days: WorkloadDay[];
  rates: RatingRates & {
    /** Observed grading events per unique card in the window (≥1). */
    repeatFactor: number;
    typicalAddsPerDay: number;
    avgDailyReviews: number;
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
const totalOf = (c: DayStateCounts) => youngOf(c) + c.review;

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

/** Average seconds per grading event in the given mode: per-mode window data
 * first, overall window second, mode prior last — always clamped. */
export function deriveSecondsPerReview(
  history: WorkloadForecastData['history'],
  reviewMode: 'audio' | 'full',
): number {
  const modeReviews = history.reviewsByMode[reviewMode];
  const modeTimeMs = history.timeMsByMode[reviewMode];
  const raw =
    modeReviews > 0 && modeTimeMs > 0
      ? modeTimeMs / modeReviews / 1000
      : history.reps > 0 && history.timeMs > 0
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

export type ReturnKernels = { young: number[]; mature: number[] };

/**
 * SINGLE-GENERATION return kernels: where a card REVIEWED on day k next
 * lands inside the window, per class, as fractional sightings at day-offset
 * Δ (index 0 unused — same-day repeats live in the event multipliers).
 * Higher generations (the re-landed card getting reviewed and landing
 * again) are expanded separately in `expandResponses`, where each further
 * generation follows the MATURE kernel — a returned young card has
 * graduated by then. Keeping generations out of the kernels is what makes
 * the composition convergent instead of geometric.
 *
 * young: learning/relearning/ungraduated cards run their remaining learning
 * steps same-day and land the graduation interval (~next day).
 * mature: Review-state cards return inside the window mainly via 'again'
 * (relearn today, land ~tomorrow) and 'hard' on short-stability cards; the
 * kernel runs the real scheduler over a representative stability mix, so
 * good/easy on stable cards naturally fall outside the window.
 */
export function deriveReturnKernels(opts: {
  initialReviewCount: number;
  rates: RatingRates;
}): ReturnKernels {
  const { initialReviewCount, rates } = opts;
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

  const mature = new Array<number>(WORKLOAD_DAYS).fill(0);
  for (const { stabilityDays, weight } of MATURE_STABILITY_MIX) {
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
      mature[againNext.offset] += rates.pAgain * weight;
    }
    for (const rating of ['hard', 'good', 'easy'] as const) {
      const p = rates[rating === 'hard' ? 'pHard' : rating === 'good' ? 'pGood' : 'pEasy'];
      if (p <= 0) continue;
      const next = ratingOffset(state, rating, t0, 0, initialReviewCount);
      if (next) mature[next.offset] += p * weight;
    }
  }
  return { young, mature };
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
 * Expand the single-generation kernels into full within-window responses:
 * a mature sighting echoes matureK, whose landings echo matureK again
 * (three orders — matureK sums well below 1, so the tail is a few percent);
 * a young sighting lands once via youngK and every later generation is
 * mature. Decaying by construction, so the day composition can be a plain
 * sum with no recursion.
 */
export function expandResponses(kernels: ReturnKernels): ReturnResponses {
  const m1 = kernels.mature;
  const m2 = convolveWindow(m1, m1);
  const m3 = convolveWindow(m2, m1);
  const mature = addArrays(m1, m2, m3);
  const young = addArrays(kernels.young, convolveWindow(kernels.young, mature));
  return { young, mature };
}

/**
 * Where the load of ONE card added (and studied) today lands over the next
 * WORKLOAD_DAYS, as fractional card-sightings per day. kernel[0] = 1: the
 * card is studied today (its same-day pre-review/learning repeats live in
 * the per-class event multipliers, not the kernel); the rest is the young
 * response — graduation landing plus its mature-generation echoes.
 */
export function deriveAddKernel(opts: {
  initialReviewCount: number;
  rates: RatingRates;
}): number[] {
  const responses = expandResponses(deriveReturnKernels(opts));
  const kernel = [...responses.young];
  kernel[0] = 1;
  return kernel;
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
  const responses = expandResponses(
    deriveReturnKernels({ initialReviewCount: data.initialReviewCount, rates }),
  );
  const addKernel = [...responses.young];
  addKernel[0] = 1; // an added card is studied the day it's added

  const typicalAddsPerDay =
    history.activeDays > 0 ? history.newCards / history.activeDays : 0;
  const repeatFactor = clamp(
    history.cardsReviewed > 0 ? history.reps / history.cardsReviewed : 1,
    1,
    3,
  );

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
      backlog: totalOf(data.availableNow),
      young: youngOf(data.laterToday),
      mature: data.laterToday.review,
      // Young/mature across the WHOLE day drive the return composition.
      dayYoung: youngOf(data.availableNow) + youngOf(data.laterToday),
      dayMature: data.availableNow.review + data.laterToday.review,
    },
    ...futureDays.map((c) => ({
      backlog: 0,
      young: youngOf(c),
      mature: c.review,
      dayYoung: youngOf(c),
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

  const days: WorkloadDay[] = scheduledDays.map((s, d) => {
    const scheduledTotal = s.backlog + s.young + s.mature;
    const returns = returnsF[d];
    const whatIfAdds = whatIfF[d];
    const typicalAdds = typicalF[d];
    const estTotal = returns + whatIfAdds + typicalAdds;
    // Same-day grading events: mature sightings loop on 'again'; young ones
    // (incl. every estimated sighting — returns and adds re-land young) run
    // their learning steps.
    const youngSightings = s.dayYoung + estTotal;
    const matureSightings = s.dayMature;
    const events =
      matureSightings * (1 + rates.pAgain) +
      youngSightings * YOUNG_EVENTS_PER_SIGHTING;
    const estimatedReviews = Math.round(events);
    const estimatedMinutes =
      events > 0
        ? Math.max(1, Math.round((events * secondsPerReview) / 60))
        : 0;
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
        total: Math.round(estTotal),
      },
      estimatedReviews,
      estimatedMinutes,
    };
  });

  return {
    days,
    rates: {
      ...rates,
      repeatFactor,
      typicalAddsPerDay,
      avgDailyReviews:
        history.activeDays > 0 ? history.reps / history.activeDays : 0,
      avgDailyMinutes:
        history.activeDays > 0
          ? history.timeMs / history.activeDays / 60_000
          : 0,
      secondsPerReview,
      sampleSize:
        history.ratingCounts.again +
        history.ratingCounts.hard +
        history.ratingCounts.good +
        history.ratingCounts.easy,
    },
    addKernel,
    weekReviews: days.reduce((s, d) => s + d.estimatedReviews, 0),
    weekMinutes: days.reduce((s, d) => s + d.estimatedMinutes, 0),
  };
}
