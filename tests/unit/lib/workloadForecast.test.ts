import { describe, it, expect } from 'vitest';
import {
  buildWorkloadForecast,
  deriveRatingRates,
  deriveReturnKernels,
  deriveSecondsPerReview,
  isWorkloadForecastData,
  MIN_RATING_SAMPLE,
  WHAT_IF_ADD_MAX,
  WORKLOAD_DAYS,
  type DayStateCounts,
  type WorkloadForecastData,
} from '@/lib/workloadForecast';

const zeroCounts = (): DayStateCounts => ({
  new: 0,
  learning: 0,
  relearning: 0,
  review: 0,
});

const emptyHistory = (): WorkloadForecastData['history'] => ({
  windowDays: 14,
  activeDays: 0,
  reps: 0,
  cardsReviewed: 0,
  newCards: 0,
  timeMs: 0,
  reviewsByMode: { audio: 0, full: 0 },
  timeMsByMode: { audio: 0, full: 0 },
  ratingCounts: {
    stillLearning: 0,
    understood: 0,
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  },
});

function makeData(
  overrides: Partial<WorkloadForecastData> = {},
): WorkloadForecastData {
  return {
    today: '2026-08-26',
    dayStartMs: Date.UTC(2026, 7, 26),
    availableNow: zeroCounts(),
    laterToday: zeroCounts(),
    futureDays: Array.from({ length: 6 }, zeroCounts),
    history: emptyHistory(),
    initialReviewCount: 5,
    startedCards: 50,
    ...overrides,
  };
}

const params = { addCount: 0, includeTypicalAdds: false, reviewMode: 'audio' as const };

describe('deriveRatingRates', () => {
  it('uses priors below the sample floor and never yields NaN', () => {
    const rates = deriveRatingRates(emptyHistory().ratingCounts);
    expect(rates.pAgain).toBeGreaterThan(0);
    expect(rates.pAgain + rates.pHard + rates.pGood + rates.pEasy).toBeCloseTo(1, 6);
  });

  it('uses the observed distribution once the sample is large enough', () => {
    const rates = deriveRatingRates({
      stillLearning: 99, // preReview grades never count toward the sample
      understood: 99,
      again: MIN_RATING_SAMPLE,
      hard: 0,
      good: MIN_RATING_SAMPLE,
      easy: 0,
    });
    expect(rates.pAgain).toBeCloseTo(0.5, 6);
    expect(rates.pGood).toBeCloseTo(0.5, 6);
    expect(rates.pHard).toBe(0);
  });
});

describe('deriveSecondsPerReview', () => {
  it('prefers the per-mode window, falls back to overall, then to priors', () => {
    const h = emptyHistory();
    expect(deriveSecondsPerReview(h, 'audio')).toBe(15);
    expect(deriveSecondsPerReview(h, 'full')).toBe(35);

    h.reps = 10;
    h.timeMs = 100_000; // overall 10s/review
    expect(deriveSecondsPerReview(h, 'full')).toBeCloseTo(10, 6);

    h.reviewsByMode.full = 4;
    h.timeMsByMode.full = 120_000; // full mode 30s/review
    expect(deriveSecondsPerReview(h, 'full')).toBeCloseTo(30, 6);
    expect(deriveSecondsPerReview(h, 'audio')).toBeCloseTo(10, 6);
  });

  it('clamps degenerate windows', () => {
    const h = emptyHistory();
    h.reps = 1;
    h.timeMs = 100_000_000;
    expect(deriveSecondsPerReview(h, 'audio')).toBe(120);
    h.timeMs = 1;
    expect(deriveSecondsPerReview(h, 'audio')).toBe(3);
  });
});

describe('kernels', () => {
  const rates = deriveRatingRates(emptyHistory().ratingCounts);

  it('add kernel starts at 1 today and spreads a graduation echo into days 1..6', () => {
    // The kernel ships on the forecast itself (makeData uses the same
    // priors and initialReviewCount: 5 this test used to pass directly).
    const kernel = buildWorkloadForecast(makeData(), params).addKernel;
    expect(kernel).toHaveLength(WORKLOAD_DAYS);
    expect(kernel[0]).toBe(1);
    const echo = kernel.slice(1).reduce((a, b) => a + b, 0);
    expect(echo).toBeGreaterThan(0.5); // the card comes back within the week
    expect(echo).toBeLessThan(2.5); // bounded: one branch + one second-order term
    expect(kernel.every((v) => v >= 0)).toBe(true);
  });

  it('return kernels: young echoes early, mature scales with the again rate', () => {
    const { young, mature } = deriveReturnKernels({ initialReviewCount: 5, rates });
    expect(young[0]).toBe(0); // same-day repeats live in the event multipliers
    expect(young.slice(1).reduce((a, b) => a + b, 0)).toBeGreaterThan(0.5);

    const lapsy = deriveReturnKernels({
      initialReviewCount: 5,
      rates: { pAgain: 0.4, pHard: 0.1, pGood: 0.4, pEasy: 0.1 },
    });
    const sum = (k: number[]) => k.reduce((a, b) => a + b, 0);
    expect(sum(lapsy.mature)).toBeGreaterThan(sum(mature));
  });
});

describe('isWorkloadForecastData', () => {
  it('accepts a full payload and rejects malformed cached shapes', () => {
    expect(isWorkloadForecastData(makeData())).toBe(true);

    expect(isWorkloadForecastData(null)).toBe(false);
    expect(isWorkloadForecastData('{}')).toBe(false);
    expect(
      isWorkloadForecastData(makeData({ futureDays: [zeroCounts()] })),
    ).toBe(false);
    const noHistory = { ...makeData() } as Record<string, unknown>;
    delete noHistory.history;
    expect(isWorkloadForecastData(noHistory)).toBe(false);
    // A payload cached before startedCards existed must be discarded, not
    // rendered with an undefined gate value.
    const preGate = { ...makeData() } as Record<string, unknown>;
    delete preGate.startedCards;
    expect(isWorkloadForecastData(preGate)).toBe(false);
    const badCounts = makeData();
    (badCounts.availableNow as Record<string, unknown>).review = 'many';
    expect(isWorkloadForecastData(badCounts)).toBe(false);
  });
});

describe('buildWorkloadForecast', () => {
  it('empty data yields all-zero days without NaN or negative values', () => {
    const f = buildWorkloadForecast(makeData(), params);
    expect(f.days).toHaveLength(WORKLOAD_DAYS);
    for (const d of f.days) {
      expect(d.scheduled.total).toBe(0);
      expect(d.estimated.total).toBe(0);
      expect(d.estimatedReviews).toBe(0);
      expect(d.estimatedMinutes).toBe(0);
    }
    expect(f.weekMinutes).toBe(0);
    expect(Number.isFinite(f.rates.secondsPerReview)).toBe(true);
    expect(f.rates.typicalAddsPerDay).toBe(0);
  });

  it('splits day 0 into backlog and later-today, future days into young/mature', () => {
    const f = buildWorkloadForecast(
      makeData({
        availableNow: { new: 3, learning: 4, relearning: 1, review: 4 },
        laterToday: { new: 0, learning: 2, relearning: 0, review: 6 },
        futureDays: [
          { new: 0, learning: 5, relearning: 1, review: 8 },
          ...Array.from({ length: 5 }, zeroCounts),
        ],
      }),
      params,
    );
    // Backlog follows the pills' mergedDueCount rule (learning + relearning
    // + review); the 3 available-now new cards count as young instead.
    expect(f.days[0].scheduled).toEqual({
      backlog: 9,
      young: 5,
      mature: 6,
      total: 20,
    });
    expect(f.days[1].scheduled).toEqual({
      backlog: 0,
      young: 6,
      mature: 8,
      total: 14,
    });
  });

  it('never counts never-studied cards as overdue backlog', () => {
    const f = buildWorkloadForecast(
      makeData({
        availableNow: { new: 50, learning: 0, relearning: 0, review: 0 },
      }),
      params,
    );
    expect(f.days[0].scheduled.backlog).toBe(0);
    expect(f.days[0].scheduled.young).toBe(50);
    expect(f.days[0].scheduled.total).toBe(50);
  });

  it('today’s young cards inflate tomorrow via the second wave, decaying after', () => {
    const f = buildWorkloadForecast(
      makeData({
        availableNow: { new: 0, learning: 10, relearning: 0, review: 0 },
      }),
      params,
    );
    expect(f.days[0].estimated.returns).toBe(0); // nothing earlier to return
    expect(f.days[1].estimated.returns).toBeGreaterThan(3);
    expect(f.days[1].estimated.returns).toBeGreaterThanOrEqual(
      f.days[3].estimated.returns,
    );
  });

  it('what-if adds land today with a decaying echo; clamped to the max', () => {
    const base = buildWorkloadForecast(makeData(), params);
    expect(base.days.every((d) => d.estimated.whatIfAdds === 0)).toBe(true);

    const withAdds = buildWorkloadForecast(makeData(), {
      ...params,
      addCount: 5,
    });
    expect(withAdds.days[0].estimated.whatIfAdds).toBe(5);
    expect(withAdds.days[1].estimated.whatIfAdds).toBeGreaterThan(0);

    const clamped = buildWorkloadForecast(makeData(), {
      ...params,
      addCount: 999,
    });
    expect(clamped.days[0].estimated.whatIfAdds).toBe(WHAT_IF_ADD_MAX);
  });

  it('estimatedReviews and minutes are monotone in addCount', () => {
    const data = makeData({
      availableNow: { new: 2, learning: 3, relearning: 0, review: 7 },
    });
    let prevReviews = -1;
    let prevMinutes = -1;
    for (const addCount of [0, 5, 10, 15]) {
      const f = buildWorkloadForecast(data, { ...params, addCount });
      expect(f.weekReviews).toBeGreaterThanOrEqual(prevReviews);
      expect(f.weekMinutes).toBeGreaterThanOrEqual(prevMinutes);
      prevReviews = f.weekReviews;
      prevMinutes = f.weekMinutes;
    }
  });

  it('typical adds continue on future days only when enabled', () => {
    const history = emptyHistory();
    history.activeDays = 10;
    history.newCards = 30; // 3/day
    const off = buildWorkloadForecast(makeData({ history }), params);
    expect(off.days.every((d) => d.estimated.typicalAdds === 0)).toBe(true);

    const on = buildWorkloadForecast(makeData({ history }), {
      ...params,
      includeTypicalAdds: true,
    });
    expect(on.days[0].estimated.typicalAdds).toBe(0); // day 0 is the stepper's
    expect(on.days[1].estimated.typicalAdds).toBeGreaterThan(0);
    expect(on.rates.typicalAddsPerDay).toBeCloseTo(3, 6);
  });

  it('a young-heavy day costs more minutes than a count-equal mature day', () => {
    const young = buildWorkloadForecast(
      makeData({
        availableNow: { new: 0, learning: 10, relearning: 0, review: 0 },
      }),
      params,
    );
    const mature = buildWorkloadForecast(
      makeData({
        availableNow: { new: 0, learning: 0, relearning: 0, review: 10 },
      }),
      params,
    );
    expect(young.days[0].estimatedMinutes).toBeGreaterThan(
      mature.days[0].estimatedMinutes,
    );
  });

  it('writing mode uses its own (slower) pace', () => {
    const data = makeData({
      availableNow: { new: 0, learning: 0, relearning: 0, review: 10 },
    });
    const audio = buildWorkloadForecast(data, params);
    const full = buildWorkloadForecast(data, {
      ...params,
      reviewMode: 'full',
    });
    expect(full.days[0].estimatedMinutes).toBeGreaterThan(
      audio.days[0].estimatedMinutes,
    );
  });

  it('tolerates a truncated futureDays array (stale cached payload) by zero-padding', () => {
    const data = makeData({
      availableNow: { new: 0, learning: 3, relearning: 0, review: 2 },
      // Only 2 future days instead of WORKLOAD_DAYS - 1 — the shape an old
      // cached payload could have after a window-size change.
      futureDays: [
        { new: 0, learning: 1, relearning: 0, review: 4 },
        zeroCounts(),
      ],
    });
    const f = buildWorkloadForecast(data, params);
    expect(f.days).toHaveLength(WORKLOAD_DAYS);
    expect(f.days[1].scheduled.total).toBe(5);
    for (const d of f.days.slice(3)) {
      expect(d.scheduled.total).toBe(0);
    }
  });

  it('repeatFactor clamps to [1, 3] and pace averages derive from active days', () => {
    const history = emptyHistory();
    history.activeDays = 5;
    history.reps = 100;
    history.cardsReviewed = 10; // raw factor 10 → clamped 3
    history.timeMs = 25 * 60_000;
    const f = buildWorkloadForecast(makeData({ history }), params);
    expect(f.rates.repeatFactor).toBe(3);
    expect(f.rates.avgDailyReviews).toBeCloseTo(20, 6);
    expect(f.rates.avgDailyMinutes).toBeCloseTo(5, 6);
  });
});
