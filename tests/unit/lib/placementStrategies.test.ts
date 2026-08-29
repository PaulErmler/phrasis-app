import { describe, it, expect } from 'vitest';
import {
  BinaryStrategy,
  StaircaseStrategy,
  StaircaseFromBottomStrategy,
  BayesianStrategy,
  TransformedStaircaseStrategy,
  AnchorVerifyStrategy,
  RampBisectStrategy,
  MIN_LEVEL,
  MAX_LEVEL,
  CURRENT_PLACEMENT_STRATEGY_VERSION,
  createStrategy,
  ogteToCurrentLevel,
  currentLevelToOgte,
  type PlacementStrategy,
} from '@/app/app/onboarding/lib/placementStrategies';

describe('CURRENT_PLACEMENT_STRATEGY_VERSION', () => {
  it('is a positive integer that downstream readers can compare', () => {
    expect(Number.isInteger(CURRENT_PLACEMENT_STRATEGY_VERSION)).toBe(true);
    expect(CURRENT_PLACEMENT_STRATEGY_VERSION).toBeGreaterThan(0);
  });
});

/**
 * Drives a strategy with a synthetic "true level". The user knows everything
 * at or below `trueLevel`, nothing above. Returns the placed level along with
 * the question count.
 */
function driveAgainstTrueLevel(
  strategy: PlacementStrategy,
  trueLevel: number,
  maxQuestions = 30,
): { placed: number; questions: number } {
  let asked = 0;
  while (asked < maxQuestions) {
    const next = strategy.nextQuestionLevel();
    if (next === null) break;
    strategy.recordAnswer(next, next <= trueLevel);
    asked++;
  }
  return { placed: strategy.finalLevel(), questions: asked };
}

describe('BinaryStrategy', () => {
  it('converges within O(log n) for every true level', () => {
    for (let trueLevel = MIN_LEVEL; trueLevel <= MAX_LEVEL; trueLevel++) {
      const s = new BinaryStrategy();
      s.init();
      const { placed, questions } = driveAgainstTrueLevel(s, trueLevel);
      expect(questions).toBeLessThanOrEqual(6); // log2(20) ≈ 4.3, leave headroom
      expect(placed).toBe(trueLevel);
    }
  });

  it('places at MIN_LEVEL when the user knows nothing', () => {
    const s = new BinaryStrategy();
    s.init();
    while (s.nextQuestionLevel() !== null) {
      s.recordAnswer(s.nextQuestionLevel()!, false);
    }
    expect(s.finalLevel()).toBe(MIN_LEVEL);
  });

  it('records every answer in history in order', () => {
    const s = new BinaryStrategy();
    s.init();
    const seq = [
      { level: 10, knew: true },
      { level: 15, knew: false },
      { level: 12, knew: true },
    ];
    for (const a of seq) s.recordAnswer(a.level, a.knew);
    expect(s.history()).toEqual(seq);
  });
});

describe('StaircaseStrategy', () => {
  it('honours the userGuess as the starting level', () => {
    const s = new StaircaseStrategy();
    s.init({ userGuess: 13 });
    expect(s.nextQuestionLevel()).toBe(13);
  });

  it('clamps an out-of-range userGuess', () => {
    const high = new StaircaseStrategy();
    high.init({ userGuess: 999 });
    expect(high.nextQuestionLevel()).toBe(MAX_LEVEL);

    const low = new StaircaseStrategy();
    low.init({ userGuess: -3 });
    expect(low.nextQuestionLevel()).toBe(MIN_LEVEL);
  });

  it('terminates within the budget and places near the true level when seeded close', () => {
    // Staircase is biased toward the starting guess. With userGuess=8 it can
    // only converge accurately for true levels within walking distance.
    for (const trueLevel of [7, 8, 9, 10]) {
      const s = new StaircaseStrategy();
      s.init({ userGuess: 8 });
      const { placed, questions } = driveAgainstTrueLevel(s, trueLevel);
      expect(questions).toBeLessThanOrEqual(12);
      expect(Math.abs(placed - trueLevel)).toBeLessThanOrEqual(2);
    }
  });

  it('terminates within the budget for far-away true levels', () => {
    for (const trueLevel of [1, 3, 17, 20]) {
      const s = new StaircaseStrategy();
      s.init({ userGuess: 8 });
      const { placed, questions } = driveAgainstTrueLevel(s, trueLevel);
      expect(questions).toBeLessThanOrEqual(12);
      expect(placed).toBeGreaterThanOrEqual(MIN_LEVEL);
      expect(placed).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });

  it('stops via the budget if no reversals appear', () => {
    // Sequence with no reversal (all "yes") should hit the 6-question fallback.
    const s = new StaircaseStrategy();
    s.init({ userGuess: 5 });
    for (let i = 0; i < 10 && s.nextQuestionLevel() !== null; i++) {
      s.recordAnswer(s.nextQuestionLevel()!, true);
    }
    expect(s.nextQuestionLevel()).toBeNull();
  });
});

describe('BayesianStrategy', () => {
  it('places near the true level within the question budget', () => {
    for (const trueLevel of [2, 7, 11, 16]) {
      const s = new BayesianStrategy();
      s.init();
      const { placed, questions } = driveAgainstTrueLevel(s, trueLevel);
      expect(questions).toBeLessThanOrEqual(10);
      expect(placed).toBeGreaterThanOrEqual(Math.max(MIN_LEVEL, trueLevel - 2));
      expect(placed).toBeLessThanOrEqual(Math.min(MAX_LEVEL, trueLevel + 2));
    }
  });

  it('asks at least BAYESIAN_MIN_QUESTIONS before terminating', () => {
    const s = new BayesianStrategy();
    s.init();
    let asked = 0;
    while (s.nextQuestionLevel() !== null && asked < 4) {
      s.recordAnswer(s.nextQuestionLevel()!, true);
      asked++;
    }
    expect(asked).toBe(4);
  });
});

describe('TransformedStaircaseStrategy', () => {
  it('uses the 2-down/1-up rule (needs two correct in a row to step up)', () => {
    const s = new TransformedStaircaseStrategy();
    s.init({ userGuess: 10 });
    expect(s.nextQuestionLevel()).toBe(10);

    s.recordAnswer(10, true);
    // One correct, still at 10.
    expect(s.nextQuestionLevel()).toBe(10);

    s.recordAnswer(10, true);
    // Two correct. Step up to 11.
    expect(s.nextQuestionLevel()).toBe(11);
  });

  it('steps down on a single wrong', () => {
    const s = new TransformedStaircaseStrategy();
    s.init({ userGuess: 10 });
    s.recordAnswer(10, false);
    expect(s.nextQuestionLevel()).toBe(9);
  });

  it('terminates and produces a valid placement', () => {
    for (const trueLevel of [1, 4, 10, 16, 20]) {
      const s = new TransformedStaircaseStrategy();
      s.init({ userGuess: 8 });
      const { placed, questions } = driveAgainstTrueLevel(s, trueLevel);
      expect(questions).toBeLessThanOrEqual(14);
      expect(placed).toBeGreaterThanOrEqual(MIN_LEVEL);
      expect(placed).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });
});

describe('AnchorVerifyStrategy', () => {
  it('asks the anchor 3 times in the coarse phase', () => {
    const s = new AnchorVerifyStrategy();
    s.init({ userGuess: 8 });
    for (let i = 0; i < 3; i++) {
      const next = s.nextQuestionLevel();
      expect(next).toBe(8);
      s.recordAnswer(next!, true);
    }
    // After three at the anchor + 3/3 yes, the strategy jumps up (level 11).
    expect(s.nextQuestionLevel()).toBe(11);
  });

  it('terminates within the hard cap', () => {
    for (const trueLevel of [3, 9, 15]) {
      const s = new AnchorVerifyStrategy();
      s.init({ userGuess: 8 });
      const { questions } = driveAgainstTrueLevel(s, trueLevel);
      expect(questions).toBeLessThanOrEqual(12);
    }
  });
});

describe('StaircaseFromBottomStrategy', () => {
  it('starts at MIN_LEVEL regardless of how it was initialised', () => {
    const s = new StaircaseFromBottomStrategy();
    s.init();
    expect(s.nextQuestionLevel()).toBe(MIN_LEVEL);
  });

  it('steps up on a correct answer and down on a wrong one', () => {
    const s = new StaircaseFromBottomStrategy();
    s.init();
    s.recordAnswer(1, true);
    expect(s.nextQuestionLevel()).toBe(2);
    s.recordAnswer(2, false);
    expect(s.nextQuestionLevel()).toBe(1);
  });

  it('terminates as soon as one level has been visited three times', () => {
    const s = new StaircaseFromBottomStrategy();
    s.init();
    // True level 2: oscillates between 2 (knew) and 3 (didn\'t know).
    // Sequence: 1↑ → 2↑ → 3↓ → 2↑ → 3↓ → 2 (3rd visit). Place at 2.
    const trueLevel = 2;
    let asked = 0;
    while (s.nextQuestionLevel() !== null && asked < 20) {
      const next = s.nextQuestionLevel()!;
      s.recordAnswer(next, next <= trueLevel);
      asked++;
    }
    expect(s.finalLevel()).toBe(2);
    expect(asked).toBe(6);
  });

  it('places at MIN_LEVEL when the user misses every question (3× at floor)', () => {
    const s = new StaircaseFromBottomStrategy();
    s.init();
    s.recordAnswer(1, false);
    expect(s.nextQuestionLevel()).toBe(1);
    s.recordAnswer(1, false);
    expect(s.nextQuestionLevel()).toBe(1);
    s.recordAnswer(1, false);
    expect(s.nextQuestionLevel()).toBeNull();
    expect(s.finalLevel()).toBe(MIN_LEVEL);
  });

  it('places at MAX_LEVEL when the user knows everything (3× at ceiling)', () => {
    const s = new StaircaseFromBottomStrategy();
    s.init();
    // Walk up: levels 1..20, each "knew" → 19 steps, then 2 more "knew" at
    // MAX_LEVEL get clamped to MAX_LEVEL. Third visit terminates.
    let asked = 0;
    while (s.nextQuestionLevel() !== null && asked < 25) {
      s.recordAnswer(s.nextQuestionLevel()!, true);
      asked++;
    }
    expect(s.finalLevel()).toBe(MAX_LEVEL);
    // 20 climbing asks (1..20) + 2 extra at the ceiling = 22 total.
    expect(asked).toBe(22);
  });

  it('stays within the safety cap across the level range', () => {
    for (let trueLevel = MIN_LEVEL; trueLevel <= MAX_LEVEL; trueLevel++) {
      const s = new StaircaseFromBottomStrategy();
      s.init();
      const { placed, questions } = driveAgainstTrueLevel(s, trueLevel, 30);
      // Worst case is trueLevel=19: climb 1..19 (19 asks) + oscillate
      // [19,20,19,20,19] (4 more asks) = 23 asks before locking at 19.
      expect(questions).toBeLessThanOrEqual(23);
      expect(placed).toBeGreaterThanOrEqual(MIN_LEVEL);
      expect(placed).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });
});

describe('RampBisectStrategy', () => {
  it('starts at level 1', () => {
    const s = new RampBisectStrategy();
    s.init();
    expect(s.nextQuestionLevel()).toBe(1);
  });

  it('walks the ramp 1→2→3→5→8→12→17→20 when every answer is "knew"', () => {
    const s = new RampBisectStrategy();
    s.init();
    const expected = [1, 2, 3, 5, 8, 12, 17, 20];
    const asked: number[] = [];
    for (let i = 0; i < expected.length; i++) {
      const next = s.nextQuestionLevel();
      asked.push(next!);
      s.recordAnswer(next!, true);
    }
    expect(asked).toEqual(expected);
    // After answering all 8 correctly, the test is done at MAX_LEVEL.
    expect(s.nextQuestionLevel()).toBeNull();
    expect(s.finalLevel()).toBe(MAX_LEVEL);
  });

  it('exits the ramp on the first "didn\'t know" and bisects', () => {
    const s = new RampBisectStrategy();
    s.init();
    // Knew 1, 2, 3, 5; didn't know 8. Should now bisect [6, 7].
    for (const lvl of [1, 2, 3, 5]) {
      const next = s.nextQuestionLevel();
      expect(next).toBe(lvl);
      s.recordAnswer(next!, true);
    }
    const askedHigh = s.nextQuestionLevel();
    expect(askedHigh).toBe(8);
    s.recordAnswer(8, false);
    // Now bisect [6, 7]. Mid = 6.
    const bisect1 = s.nextQuestionLevel();
    expect(bisect1).toBe(6);
  });

  it('handles "didn\'t know on level 1" by placing at MIN_LEVEL', () => {
    const s = new RampBisectStrategy();
    s.init();
    s.recordAnswer(1, false);
    expect(s.nextQuestionLevel()).toBeNull();
    expect(s.finalLevel()).toBe(MIN_LEVEL);
  });

  it('terminates within a small question budget across the level range', () => {
    for (let trueLevel = MIN_LEVEL; trueLevel <= MAX_LEVEL; trueLevel++) {
      const s = new RampBisectStrategy();
      s.init();
      const { placed, questions } = driveAgainstTrueLevel(s, trueLevel);
      // Worst case: 7 ramp asks + 3 bisect asks = 10.
      expect(questions).toBeLessThanOrEqual(10);
      // Placement is exact (last "knew" level).
      expect(placed).toBe(trueLevel);
    }
  });
});

describe('createStrategy factory', () => {
  it('returns the correct concrete strategy by name', () => {
    expect(createStrategy('binary').name).toBe('binary');
    expect(createStrategy('staircase').name).toBe('staircase');
    expect(createStrategy('bayesian').name).toBe('bayesian');
    expect(createStrategy('transformed-staircase').name).toBe(
      'transformed-staircase',
    );
    expect(createStrategy('anchor-verify').name).toBe('anchor-verify');
    expect(createStrategy('ramp-bisect').name).toBe('ramp-bisect');
    expect(createStrategy('staircase-from-bottom').name).toBe(
      'staircase-from-bottom',
    );
  });
});

describe('ogteToCurrentLevel', () => {
  it('maps each OGTE band to the expected CurrentLevel bucket', () => {
    expect(ogteToCurrentLevel(1)).toBe('beginner');
    expect(ogteToCurrentLevel(2)).toBe('beginner');
    expect(ogteToCurrentLevel(3)).toBe('elementary');
    expect(ogteToCurrentLevel(5)).toBe('elementary');
    expect(ogteToCurrentLevel(6)).toBe('intermediate');
    expect(ogteToCurrentLevel(8)).toBe('intermediate');
    expect(ogteToCurrentLevel(9)).toBe('upper_intermediate');
    expect(ogteToCurrentLevel(11)).toBe('upper_intermediate');
    expect(ogteToCurrentLevel(12)).toBe('advanced');
    expect(ogteToCurrentLevel(14)).toBe('advanced');
    expect(ogteToCurrentLevel(15)).toBe('proficient');
    expect(ogteToCurrentLevel(20)).toBe('proficient');
  });
});

describe('currentLevelToOgte', () => {
  it('is a left-inverse of ogteToCurrentLevel for representative levels', () => {
    expect(ogteToCurrentLevel(currentLevelToOgte('beginner'))).toBe('beginner');
    expect(ogteToCurrentLevel(currentLevelToOgte('elementary'))).toBe(
      'elementary',
    );
    expect(ogteToCurrentLevel(currentLevelToOgte('intermediate'))).toBe(
      'intermediate',
    );
    expect(ogteToCurrentLevel(currentLevelToOgte('upper_intermediate'))).toBe(
      'upper_intermediate',
    );
    expect(ogteToCurrentLevel(currentLevelToOgte('advanced'))).toBe('advanced');
    expect(ogteToCurrentLevel(currentLevelToOgte('proficient'))).toBe(
      'proficient',
    );
  });
});
