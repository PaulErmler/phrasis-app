import { describe, it, expect } from 'vitest';
import {
  STAT_FILTER_CYCLE,
  REPS_FILTER_LABEL_KEYS,
  TIME_FILTER_LABEL_KEYS,
  nextStatFilter,
  statForFilter,
  type StatFilter,
  type ReviewsByMode,
} from '@/lib/statFilter';

describe('nextStatFilter', () => {
  it('cycles all -> learn -> radio -> freeStudy and wraps back to all', () => {
    expect(nextStatFilter('all')).toBe('learn');
    expect(nextStatFilter('learn')).toBe('radio');
    expect(nextStatFilter('radio')).toBe('freeStudy');
    expect(nextStatFilter('freeStudy')).toBe('all');
  });

  it('returns to the starting face after one full lap', () => {
    let filter: StatFilter = STAT_FILTER_CYCLE[0];
    for (let i = 0; i < STAT_FILTER_CYCLE.length; i++) {
      filter = nextStatFilter(filter);
    }
    expect(filter).toBe(STAT_FILTER_CYCLE[0]);
  });
});

describe('label key maps', () => {
  it('name a distinct label for every face of each tile', () => {
    const reps = STAT_FILTER_CYCLE.map((f) => REPS_FILTER_LABEL_KEYS[f]);
    expect(reps).toEqual([
      'stats.reps',
      'stats.repsLearn',
      'stats.repsRadio',
      'stats.repsFreeStudy',
    ]);
    const time = STAT_FILTER_CYCLE.map((f) => TIME_FILTER_LABEL_KEYS[f]);
    expect(time).toEqual([
      'stats.time',
      'stats.timeLearn',
      'stats.timeRadio',
      'stats.timeFreeStudy',
    ]);
    expect(new Set([...reps, ...time]).size).toBe(2 * STAT_FILTER_CYCLE.length);
  });
});

describe('statForFilter', () => {
  // 60 graded (40 audio + 20 full) + 40 free play (30 radio + 10 freeStudy)
  const byMode: ReviewsByMode = {
    audio: 40,
    full: 20,
    radio: 30,
    freeStudy: 10,
  };

  it('applies to time the same way (ms totals + timeMsByMode)', () => {
    const timeByMode: ReviewsByMode = {
      audio: 2_000_000,
      full: 1_000_000,
      radio: 400_000,
      freeStudy: 200_000,
    };
    expect(statForFilter(3_600_000, timeByMode, 'learn')).toBe(3_000_000);
    expect(statForFilter(3_600_000, timeByMode, 'radio')).toBe(400_000);
    expect(statForFilter(3_600_000, timeByMode, 'freeStudy')).toBe(200_000);
  });

  it('splits a full breakdown into learn, radio and freeStudy', () => {
    expect(statForFilter(100, byMode, 'all')).toBe(100);
    expect(statForFilter(100, byMode, 'learn')).toBe(60);
    expect(statForFilter(100, byMode, 'radio')).toBe(30);
    expect(statForFilter(100, byMode, 'freeStudy')).toBe(10);
  });

  it('keeps free listening and free typing apart', () => {
    const listeningOnly: ReviewsByMode = { audio: 40, full: 20, radio: 30 };
    expect(statForFilter(90, listeningOnly, 'radio')).toBe(30);
    expect(statForFilter(90, listeningOnly, 'freeStudy')).toBe(0);
    expect(statForFilter(90, listeningOnly, 'learn')).toBe(60);
  });

  it('sends rows with no breakdown entirely to learn', () => {
    expect(statForFilter(100, undefined, 'all')).toBe(100);
    expect(statForFilter(100, undefined, 'learn')).toBe(100);
    expect(statForFilter(100, undefined, 'radio')).toBe(0);
    expect(statForFilter(100, undefined, 'freeStudy')).toBe(0);
  });

  it('treats missing free-play buckets as zero', () => {
    const preFreePlay: ReviewsByMode = { audio: 40, full: 20 };
    expect(statForFilter(60, preFreePlay, 'learn')).toBe(60);
    expect(statForFilter(60, preFreePlay, 'radio')).toBe(0);
    expect(statForFilter(60, preFreePlay, 'freeStudy')).toBe(0);
  });

  it('always keeps learn + radio + freeStudy equal to all', () => {
    const cases: Array<[number, ReviewsByMode | undefined]> = [
      [100, byMode],
      [60, { audio: 40, full: 20 }],
      [0, { audio: 0, full: 0, radio: 0, freeStudy: 0 }],
      [100, undefined],
      // Partially written row: buckets claim more than the merged total.
      [10, byMode],
    ];
    for (const [total, mode] of cases) {
      expect(
        statForFilter(total, mode, 'learn') +
          statForFilter(total, mode, 'radio') +
          statForFilter(total, mode, 'freeStudy'),
      ).toBe(statForFilter(total, mode, 'all'));
    }
  });

  it('clamps instead of going negative when buckets exceed the total', () => {
    // radio (30) alone already exceeds the 10 total: it takes everything,
    // freeStudy and learn get nothing rather than a negative learn.
    expect(statForFilter(10, byMode, 'learn')).toBe(0);
    expect(statForFilter(10, byMode, 'radio')).toBe(10);
    expect(statForFilter(10, byMode, 'freeStudy')).toBe(0);
    // radio fits, freeStudy is what's left.
    expect(statForFilter(35, byMode, 'radio')).toBe(30);
    expect(statForFilter(35, byMode, 'freeStudy')).toBe(5);
    expect(statForFilter(35, byMode, 'learn')).toBe(0);
  });
});
