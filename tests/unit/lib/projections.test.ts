import { describe, it, expect } from 'vitest';
import {
  computeIndicators,
  decayedDailyPace,
  projectFirstSession,
  roundFriendly,
  PACE_DECAY,
  PROJECTION_CAP_WORDS,
  type ProjectionInputs,
  type ProjectionIndicator,
} from '@/lib/projections';
import { addDays } from '@/lib/dateStrings';

const TODAY = '2026-08-02';

/** N active days ending today, `value` per day. */
function recentDays(value: number, days: number, endOffset = 0, base = TODAY) {
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(base, -(i + endOffset)),
    value,
  }));
}

// Steady user: full 90-day window of constant activity on a mature account,
// so every decayed pace equals the constant exactly and expectations below
// can be computed by hand.
function baseInputs(overrides: Partial<ProjectionInputs> = {}): ProjectionInputs {
  return {
    today: TODAY,
    courseAgeDays: 400,
    goalMinutes: 20,
    currentWords: 1200,
    currentSentences: 390,
    totalTimeMs: 58 * 3_600_000,
    todayWords: 0,
    dailyWords: recentDays(20, 90),
    dailyNewCards: recentDays(5, 90),
    dailyMinutes: recentDays(20, 90),
    levels: [
      { code: 'A2.1', totalTexts: 126, cardsAdded: 78, ignoredCount: 2 },
      { code: 'A2.2', totalTexts: 140, cardsAdded: 0, ignoredCount: 0 },
      { code: 'A2.3', totalTexts: 150, cardsAdded: 0, ignoredCount: 0 },
    ],
    activeLevelIndex: 0,
    ...overrides,
  };
}

const byKind = (indicators: ProjectionIndicator[], kind: string) =>
  indicators.find((i) => i.kind === kind);

describe('decayedDailyPace', () => {
  it('constant history returns that constant (mature account)', () => {
    const pace = decayedDailyPace(recentDays(10, 90), TODAY, 400);
    expect(pace).toBeCloseTo(10, 5);
  });

  it('gap days count as zero — a pause lowers the pace', () => {
    const active = decayedDailyPace(recentDays(10, 90), TODAY, 400);
    // Same daily value but only the older half of the window is active.
    const paused = decayedDailyPace(recentDays(10, 45, 45), TODAY, 400);
    expect(paused).toBeLessThan(active / 2);
  });

  it('recent days outweigh old days (decay)', () => {
    const recentHeavy = decayedDailyPace(recentDays(10, 7), TODAY, 400);
    const oldHeavy = decayedDailyPace(recentDays(10, 7, 60), TODAY, 400);
    expect(recentHeavy).toBeGreaterThan(oldHeavy * 5);
  });

  it('young courses are not diluted by phantom days', () => {
    const entries = recentDays(10, 3);
    const young = decayedDailyPace(entries, TODAY, 3);
    const old = decayedDailyPace(entries, TODAY, 400);
    expect(young).toBeCloseTo(10, 5);
    expect(old).toBeLessThan(young);
  });

  it('half-life: a day 15 days ago weighs half of today', () => {
    expect(PACE_DECAY ** 15).toBeCloseTo(0.5, 10);
  });
});

describe('projectFirstSession (onboarding parity)', () => {
  it('matches the historical WordProjectionStep formula', () => {
    // wordsPerMin = 12/6 = 2; linear = 2 * 20 * 30 = 1200; /7 → 171
    expect(projectFirstSession(12, 6, 20, 30)).toBe(171);
    expect(projectFirstSession(0, 0, 20, 30)).toBe(0);
    // Cap applies.
    expect(projectFirstSession(1000, 1, 120, 365)).toBe(PROJECTION_CAP_WORDS);
  });
});

describe('roundFriendly', () => {
  it('rounds by magnitude', () => {
    expect(roundFriendly(47)).toBe(45);
    expect(roundFriendly(48)).toBe(50);
    expect(roundFriendly(447)).toBe(450);
    expect(roundFriendly(2447)).toBe(2450);
    expect(roundFriendly(2424)).toBe(2400);
  });
});

describe('computeIndicators', () => {
  it('observed basis produces the full indicator set for a steady user', () => {
    const { basis, indicators } = computeIndicators(baseInputs());
    expect(basis).toBe('observed');
    const kinds = indicators.map((i) => i.kind);
    expect(kinds).toContain('endOfYearWords');
    expect(kinds).toContain('oneYearWords');
    expect(kinds).toContain('endOfMonthWords');
    expect(kinds).toContain('sessionYield');
    expect(kinds).toContain('endOfYearSentences');
    expect(kinds).toContain('sentencesPerHour');
    expect(kinds).toContain('nextLevel');
    expect(kinds).toContain('levelByYearEnd');
    expect(kinds).toContain('nextWordMilestone');
    expect(kinds).toContain('studyTimeMilestone');
    expect(kinds).not.toContain('empty');
  });

  it('projects words linearly at the observed pace', () => {
    // 20 words/day steady → pace 20. Aug 2 → Dec 31 = 151 days.
    const { indicators } = computeIndicators(baseInputs());
    const eoy = byKind(indicators, 'endOfYearWords') as { words: number };
    expect(eoy.words).toBe(roundFriendly(1200 + 20 * 151));
  });

  it('caps long projections at 10,000+ words', () => {
    const { indicators } = computeIndicators(
      baseInputs({ dailyWords: recentDays(200, 30), currentWords: 5000 }),
    );
    const year = byKind(indicators, 'oneYearWords') as {
      words: number;
      capped: boolean;
    };
    expect(year.words).toBe(PROJECTION_CAP_WORDS);
    expect(year.capped).toBe(true);
  });

  it('counterfactual appears only on a strong day and only positively', () => {
    const weak = computeIndicators(baseInputs({ todayWords: 10 }));
    expect(byKind(weak.indicators, 'counterfactualWords')).toBeUndefined();

    const strong = computeIndicators(baseInputs({ todayWords: 60 }));
    const cf = byKind(strong.indicators, 'counterfactualWords') as {
      boostedWords: number;
      baselineWords: number;
    };
    expect(cf).toBeDefined();
    expect(cf.boostedWords).toBeGreaterThan(cf.baselineWords);
  });

  it('sessionYield is "+words per goal-length session"', () => {
    // 20 words/day over 20 min/day → 1 word/min → 20 words per 20-min session.
    const { indicators } = computeIndicators(baseInputs());
    const sy = byKind(indicators, 'sessionYield') as {
      words: number;
      goalMinutes: number;
    };
    expect(sy.goalMinutes).toBe(20);
    expect(sy.words).toBe(20);
  });

  it('nextLevel uses remaining = totalTexts − cardsAdded − ignoredCount', () => {
    const { indicators } = computeIndicators(baseInputs());
    const nl = byKind(indicators, 'nextLevel') as {
      nextCode: string | null;
      etaDays: number;
    };
    // remaining = 126 − 78 − 2 = 46 at 5 cards/day → 10 days.
    expect(nl.etaDays).toBe(Math.ceil(46 / 5));
    expect(nl.nextCode).toBe('A2.2');
  });

  it('nextLevel at the top level reports nextCode null', () => {
    const { indicators } = computeIndicators(
      baseInputs({
        levels: [{ code: 'C2.4', totalTexts: 126, cardsAdded: 78, ignoredCount: 2 }],
        activeLevelIndex: 0,
      }),
    );
    const nl = byKind(indicators, 'nextLevel') as { nextCode: string | null };
    expect(nl.nextCode).toBeNull();
  });

  it('levelByYearEnd walks multiple levels with the year budget', () => {
    // 5 cards/day × 151 days = 755 budget; A2.1 needs 46, A2.2 needs 140 →
    // finishes both, lands in A2.3.
    const { indicators } = computeIndicators(baseInputs());
    const lv = byKind(indicators, 'levelByYearEnd') as { code: string };
    expect(lv.code).toBe('A2.3');
  });

  it('hides level ETAs when the pace is negligible', () => {
    const { indicators } = computeIndicators(
      baseInputs({ dailyNewCards: recentDays(0.01, 30) }),
    );
    expect(byKind(indicators, 'nextLevel')).toBeUndefined();
    expect(byKind(indicators, 'levelByYearEnd')).toBeUndefined();
  });

  it('no premade level active → no level indicators', () => {
    const { indicators } = computeIndicators(baseInputs({ activeLevelIndex: -1 }));
    expect(byKind(indicators, 'nextLevel')).toBeUndefined();
    expect(byKind(indicators, 'levelByYearEnd')).toBeUndefined();
  });

  it('nextWordMilestone targets the next round thousand', () => {
    const { indicators } = computeIndicators(baseInputs({ currentWords: 2980 }));
    const m = byKind(indicators, 'nextWordMilestone') as {
      milestone: number;
      etaDays: number;
    };
    expect(m.milestone).toBe(3000);
    expect(m.etaDays).toBe(1);
  });

  it('studyTimeMilestone picks the next hour milestone', () => {
    // 58h studied → next milestone 100h; 20 min/day → 42h = 2520 min → 126 days.
    const { indicators } = computeIndicators(baseInputs());
    const st = byKind(indicators, 'studyTimeMilestone') as {
      hours: number;
      etaDays: number;
    };
    expect(st.hours).toBe(100);
    expect(st.etaDays).toBe(126);
  });

  it('fresh account (1-2 active days) uses the dampened firstSession basis', () => {
    const { basis, indicators } = computeIndicators(
      baseInputs({
        courseAgeDays: 1,
        dailyWords: recentDays(30, 1),
        dailyNewCards: recentDays(8, 1),
        dailyMinutes: recentDays(10, 1),
        currentWords: 30,
        currentSentences: 8,
        totalTimeMs: 10 * 60_000,
      }),
    );
    expect(basis).toBe('firstSession');
    // wordsPerDay = (30/10) × 20 / 7 = 8.57 → floor of the extraction formula.
    const oneYear = byKind(indicators, 'oneYearWords') as { words: number };
    expect(oneYear).toBeDefined();
    expect(oneYear.words).toBeLessThan(30 + ((30 / 10) * 20 * 365) / 2);
    // Rate stats need observed basis.
    expect(byKind(indicators, 'sentencesPerHour')).toBeUndefined();
    expect(byKind(indicators, 'counterfactualWords')).toBeUndefined();
  });

  it('paused user (no recent activity, real history) falls to goal basis', () => {
    const { basis, indicators } = computeIndicators(
      baseInputs({
        dailyWords: [],
        dailyNewCards: [],
        dailyMinutes: [],
      }),
    );
    expect(basis).toBe('goal');
    expect(byKind(indicators, 'oneYearWords')).toBeDefined();
    expect(byKind(indicators, 'sentencesPerHour')).toBeUndefined();
  });

  it('zero history returns empty', () => {
    const { basis, indicators } = computeIndicators(
      baseInputs({
        dailyWords: [],
        dailyNewCards: [],
        dailyMinutes: [],
        currentWords: 0,
        currentSentences: 0,
        totalTimeMs: 0,
      }),
    );
    expect(basis).toBe('empty');
    expect(indicators).toEqual([{ kind: 'empty' }]);
  });

  it('suppresses demotivating tiny projections', () => {
    const { indicators } = computeIndicators(
      baseInputs({
        dailyWords: recentDays(0.2, 30),
        dailyNewCards: recentDays(0.05, 30),
      }),
    );
    expect(byKind(indicators, 'endOfYearWords')).toBeUndefined();
    expect(byKind(indicators, 'endOfMonthWords')).toBeUndefined();
  });

  it('endOfYear horizon is suppressed close to New Year', () => {
    const december = '2026-12-20';
    const { indicators } = computeIndicators(
      baseInputs({
        today: december,
        dailyWords: recentDays(20, 90, 0, december),
        dailyNewCards: recentDays(5, 90, 0, december),
        dailyMinutes: recentDays(20, 90, 0, december),
      }),
    );
    expect(byKind(indicators, 'endOfYearWords')).toBeUndefined();
    // oneYear (rolling horizon) still present.
    expect(byKind(indicators, 'oneYearWords')).toBeDefined();
  });
});
