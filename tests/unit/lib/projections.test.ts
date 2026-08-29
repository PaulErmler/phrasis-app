import { describe, it, expect } from 'vitest';
import {
  computeIndicators,
  decayedDailyPace,
  projectFirstSession,
  roundFriendly,
  MAX_LEVEL_JUMP_YEAR_END,
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
function baseInputs(
  overrides: Partial<ProjectionInputs> = {},
): ProjectionInputs {
  const base = {
    today: TODAY,
    courseAgeDays: 400,
    goalMinutes: 20,
    currentWords: 1200,
    currentSentences: 390,
    totalTimeMs: 58 * 3_600_000,
    todayWords: 0,
    dailyWords: recentDays(20, 90),
    dailyNewCards: recentDays(5, 90),
    curriculumShare: 1,
    dailyMinutes: recentDays(20, 90),
    levels: [
      { code: 'A2.1', totalTexts: 126, cardsAdded: 78, ignoredCount: 2 },
      { code: 'A2.2', totalTexts: 140, cardsAdded: 0, ignoredCount: 0 },
      { code: 'A2.3', totalTexts: 150, cardsAdded: 0, ignoredCount: 0 },
    ],
    activeLevelIndex: 0,
    ...overrides,
  };
  return {
    ...base,
    // All-curriculum unless a test says otherwise, and derived from whatever
    // `dailyNewCards` ended up being so that overriding one series can't leave
    // the other silently stale. Every expectation below that doesn't pass
    // `dailyCurriculumCards` therefore doubles as an assertion that a user with
    // no custom content sees exactly the ETAs they saw before the split existed.
    dailyCurriculumCards: overrides.dailyCurriculumCards ?? base.dailyNewCards,
  };
}

const byKind = (indicators: ProjectionIndicator[], kind: string) =>
  indicators.find((i) => i.kind === kind);

describe('decayedDailyPace', () => {
  it('constant history returns that constant (mature account)', () => {
    const pace = decayedDailyPace(recentDays(10, 90), TODAY, 400);
    expect(pace).toBeCloseTo(10, 5);
  });

  it('gap days count as zero, a pause lowers the pace', () => {
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

  // The ceiling is on the projected GAIN, so it sits at currentWords + CAP.
  it('caps the projected gain at 10,000+ words above the current count', () => {
    const { indicators } = computeIndicators(
      baseInputs({ dailyWords: recentDays(200, 30), currentWords: 5000 }),
    );
    const year = byKind(indicators, 'oneYearWords') as {
      words: number;
      capped: boolean;
    };
    expect(year.words).toBe(5000 + PROJECTION_CAP_WORDS);
    expect(year.capped).toBe(true);
  });

  // Regression: capping the TOTAL showed a user who already knows more than
  // the cap a "target" BELOW their current count.
  it('never projects fewer words than the user already knows', () => {
    const currentWords = 12_000;
    const { indicators } = computeIndicators(
      baseInputs({ currentWords, dailyWords: recentDays(10, 30) }),
    );
    for (const kind of [
      'endOfMonthWords',
      'endOfYearWords',
      'oneYearWords',
    ] as const) {
      const frame = byKind(indicators, kind) as { words: number } | undefined;
      if (!frame) continue;
      expect(
        frame.words,
        `${kind} must not regress below currentWords`,
      ).toBeGreaterThanOrEqual(currentWords);
    }
  });

  it('flags a clamped end-of-month value so it renders "+" not "~"', () => {
    const { indicators } = computeIndicators(
      baseInputs({ dailyWords: recentDays(5000, 30), currentWords: 100 }),
    );
    const eom = byKind(indicators, 'endOfMonthWords') as
      | { words: number; capped: boolean }
      | undefined;
    expect(eom).toBeDefined();
    expect(eom!.words).toBe(100 + PROJECTION_CAP_WORDS);
    expect(eom!.capped).toBe(true);
  });

  it('leaves an uncapped end-of-month value unflagged', () => {
    const { indicators } = computeIndicators(baseInputs());
    const eom = byKind(indicators, 'endOfMonthWords') as
      | { capped: boolean }
      | undefined;
    expect(eom).toBeDefined();
    expect(eom!.capped).toBe(false);
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
        levels: [
          { code: 'C2.4', totalTexts: 126, cardsAdded: 78, ignoredCount: 2 },
        ],
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

  /**
   * The reported bug: the level ETA divided a PREMADE-only remaining count by
   * an all-origin pace, so anyone adding their own sentences was promised the
   * next level sooner than the curriculum could actually be finished.
   */
  describe('curriculum vs custom pace', () => {
    it('custom cards no longer shorten the level ETA', () => {
      // Same 5 cards/day overall. Left: all curriculum. Right: 1 curriculum
      // and 4 custom. Before the split both read as 5 premade cards/day.
      const allCurriculum = computeIndicators(
        baseInputs({ dailyNewCards: recentDays(5, 90) }),
      );
      const mostlyCustom = computeIndicators(
        baseInputs({
          dailyNewCards: recentDays(5, 90),
          dailyCurriculumCards: recentDays(1, 90),
        }),
      );
      const a = byKind(allCurriculum.indicators, 'nextLevel') as {
        etaDays: number;
      };
      const b = byKind(mostlyCustom.indicators, 'nextLevel') as {
        etaDays: number;
      };
      // 126 - 78 - 2 = 46 remaining. At 5/day → 10 days; at 1/day → 46.
      expect(a.etaDays).toBe(10);
      expect(b.etaDays).toBe(46);
    });

    it('reports both paces, with custom as the remainder', () => {
      const r = computeIndicators(
        baseInputs({
          dailyNewCards: recentDays(5, 90),
          dailyCurriculumCards: recentDays(1, 90),
        }),
      );
      expect(r.cardsPerDay).toBeCloseTo(5, 5);
      expect(r.curriculumCardsPerDay).toBeCloseTo(1, 5);
      expect(r.customCardsPerDay).toBeCloseTo(4, 5);
    });

    it('the year-end level walk spends the curriculum pace only', () => {
      // 46 + 140 + 150 = 336 premade texts left, and ~360 days of budget from
      // early January. All-origin 5/day clears the ladder to the
      // MAX_LEVEL_JUMP_YEAR_END cap; a 0.5/day curriculum pace buys 180, which
      // clears A2.1's 46 but stalls 6 short of A2.2's 140.
      const early = { today: '2026-01-05', courseAgeDays: 400 };
      const allCurriculum = computeIndicators(
        baseInputs({
          ...early,
          dailyNewCards: recentDays(5, 90, 0, '2026-01-05'),
        }),
      );
      const mostlyCustom = computeIndicators(
        baseInputs({
          ...early,
          dailyNewCards: recentDays(5, 90, 0, '2026-01-05'),
          dailyCurriculumCards: recentDays(0.5, 90, 0, '2026-01-05'),
        }),
      );
      const a = byKind(allCurriculum.indicators, 'levelByYearEnd') as {
        code: string;
      };
      const b = byKind(mostlyCustom.indicators, 'levelByYearEnd') as {
        code: string;
      };
      expect(a.code).toBe('A2.3');
      expect(b.code).toBe('A2.2');
    });

    it('hides the level ETAs when only the CUSTOM pace is meaningful', () => {
      // 5 cards/day would clear the level in 10 days, but none of them are
      // curriculum cards, so there is nothing honest to promise.
      const { indicators } = computeIndicators(
        baseInputs({
          dailyNewCards: recentDays(5, 90),
          dailyCurriculumCards: recentDays(0, 90),
        }),
      );
      expect(byKind(indicators, 'nextLevel')).toBeUndefined();
      expect(byKind(indicators, 'levelByYearEnd')).toBeUndefined();
      // The all-origin sentence indicators are unaffected: those project the
      // whole deck, which legitimately includes custom sentences.
      expect(byKind(indicators, 'endOfYearSentences')).toBeDefined();
      expect(byKind(indicators, 'sentencesPerHour')).toBeDefined();
    });

    it('goal basis scales the curriculum pace by curriculumShare', () => {
      // No recent activity, so there is no window to split; the deck's
      // standing composition stands in for it.
      const paused = {
        dailyWords: [],
        dailyNewCards: [],
        dailyCurriculumCards: [],
        dailyMinutes: [],
      };
      const full = computeIndicators(
        baseInputs({ ...paused, curriculumShare: 1 }),
      );
      const partial = computeIndicators(
        baseInputs({ ...paused, curriculumShare: 0.25 }),
      );
      expect(full.basis).toBe('goal');
      expect(partial.basis).toBe('goal');
      expect(full.cardsPerDay).toBeCloseTo(partial.cardsPerDay, 5);
      expect(partial.curriculumCardsPerDay).toBeCloseTo(
        full.curriculumCardsPerDay * 0.25,
        5,
      );
    });
  });

  it('no premade level active → no level indicators', () => {
    const { indicators } = computeIndicators(
      baseInputs({ activeLevelIndex: -1 }),
    );
    expect(byKind(indicators, 'nextLevel')).toBeUndefined();
    expect(byKind(indicators, 'levelByYearEnd')).toBeUndefined();
  });

  it('nextWordMilestone targets the next round thousand', () => {
    const { indicators } = computeIndicators(
      baseInputs({ currentWords: 2980 }),
    );
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
    // wordsPerDay = 30 words / 1 active day / 7. The goal no longer scales
    // the pace; the average actual minutes per active day do.
    const oneYear = byKind(indicators, 'oneYearWords') as { words: number };
    expect(oneYear).toBeDefined();
    expect(oneYear.words).toBeLessThan(30 + ((30 / 10) * 20 * 365) / 2);
    // Rate stats need observed basis.
    expect(byKind(indicators, 'sentencesPerHour')).toBeUndefined();
    expect(byKind(indicators, 'counterfactualWords')).toBeUndefined();
  });

  /**
   * The regression this exists for: the first-session pace was scaled to the
   * DAILY GOAL before the ÷7 dampener. A user with a 5-minute goal who
   * studied 17.5 minutes (27 sentences) had today's output cut 3.5× by the
   * goal scaling and 7× by the dampener. "A1.1 in ~124 days" rendered next
   * to a day that alone covered a sixth of the level. Pace now extrapolates
   * from the average actual minutes per active day.
   */
  it('firstSession pace uses average actual study time, not the daily goal', () => {
    const { basis, indicators } = computeIndicators(
      baseInputs({
        courseAgeDays: 1,
        goalMinutes: 5,
        dailyWords: recentDays(47, 1),
        dailyNewCards: recentDays(27, 1),
        dailyMinutes: recentDays(17.45, 1),
        currentWords: 47,
        currentSentences: 27,
        totalTimeMs: 17.45 * 60_000,
        levels: [
          { code: 'Pre-A1', totalTexts: 163, cardsAdded: 27, ignoredCount: 0 },
          { code: 'A1.1', totalTexts: 150, cardsAdded: 0, ignoredCount: 0 },
        ],
        activeLevelIndex: 0,
      }),
    );
    expect(basis).toBe('firstSession');
    const nl = byKind(indicators, 'nextLevel') as { etaDays: number };
    expect(nl).toBeDefined();
    // cardsPerDay = 27/day ÷ 7 ≈ 3.86 → 136 remaining ≈ 36 days (was ~124
    // when the 5-minute goal scaled the rate down first).
    expect(nl.etaDays).toBe(36);
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

  /**
   * The regression these exist for: the goal basis took the raw all-time
   * words-per-minute, for a user who studied 15 minutes and stopped, that is
   * a first-session rate without the first-session dampener, so once the pace
   * window emptied they were promised "10,000+ words in one year" and the
   * ladder walk crowned them C2 by December.
   */
  describe('goal basis with a tiny lifetime history', () => {
    // 45 words / 20 sentences in 15 lifetime minutes, then a long pause.
    const tinyHistory = () =>
      baseInputs({
        dailyWords: [],
        dailyNewCards: [],
        dailyMinutes: [],
        currentWords: 45,
        currentSentences: 20,
        totalTimeMs: 15 * 60_000,
        goalMinutes: 20,
        // Mid-year so the year-end indicators are in play.
        today: '2026-06-01',
      });

    it('dampens the all-time rate like a first session', () => {
      const { basis, indicators } = computeIndicators(tinyHistory());
      expect(basis).toBe('goal');
      const oneYear = byKind(indicators, 'oneYearWords') as {
        words: number;
        capped: boolean;
      };
      // Undampened: 45 + (45/15)*20*365 ≈ 21,945 → capped "10,000+".
      // Dampened (~÷6.7): ≈ 3,300. Plausible, and far below the cap.
      expect(oneYear).toBeDefined();
      expect(oneYear.capped).toBe(false);
      expect(oneYear.words).toBeLessThan(5000);
    });

    it('does not dampen a long real history', () => {
      // 58 lifetime hours: trust is full, rate is taken as-is.
      const { indicators } = computeIndicators(
        baseInputs({ dailyWords: [], dailyNewCards: [], dailyMinutes: [] }),
      );
      const oneYear = byKind(indicators, 'oneYearWords') as { words: number };
      // 1200 words / 3480 min ≈ 0.345 wpm × 20 min × 365 ≈ +2,517.
      expect(oneYear.words).toBeGreaterThan(3000);
    });

    it('caps the year-end level walk at MAX_LEVEL_JUMP_YEAR_END levels', () => {
      const manyLevels = Array.from({ length: 12 }, (_, i) => ({
        code: `L${i}`,
        totalTexts: 10,
        cardsAdded: 0,
        ignoredCount: 0,
      }));
      const { indicators } = computeIndicators(
        baseInputs({
          // Huge card pace so the uncapped walk would eat the whole ladder.
          dailyNewCards: recentDays(50, 90),
          levels: manyLevels,
          activeLevelIndex: 0,
        }),
      );
      const lv = byKind(indicators, 'levelByYearEnd') as { code: string };
      expect(lv.code).toBe(`L${MAX_LEVEL_JUMP_YEAR_END}`);
    });
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
