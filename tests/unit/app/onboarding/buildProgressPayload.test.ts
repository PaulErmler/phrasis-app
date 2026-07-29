import { describe, it, expect } from 'vitest';
import { buildProgressPayload } from '@/app/app/onboarding/page';
import {
  EMPTY_ONBOARDING_DATA,
  type OnboardingData,
} from '@/app/app/onboarding/types';

/**
 * `buildProgressPayload` is the single source of truth for the
 * `saveOnboardingProgress` payload — all three wizard call sites (debounced
 * `persist`, immediate `advance`, immediate `back`) route through it. These
 * tests pin the empty-vs-populated field mapping so a refactor can't silently
 * start persisting empty arrays / nulls (the Convex validator expects
 * `undefined` for absent optionals).
 */

const FULL_DATA: OnboardingData = {
  reviewMode: 'audio',
  targetLanguages: ['ja'],
  baseLanguages: ['en', 'de'],
  currentLevel: 'intermediate',
  acquisitionSource: 'reddit',
  acquisitionSourceFreeText: 'a podcast',
  learningGoals: ['travel', 'work'],
  learningGoalFreeText: 'business trips',
  dailyTimeGoalMinutes: 20,
  placementTest: {
    strategyVersion: 3,
    strategy: 'ramp-bisect',
    history: [
      { level: 8, knew: true },
      { level: 12, knew: false },
    ],
    finalLevel: 10,
  },
  firstLessonCardsRated: 4,
  firstLessonSessionId: 'session_1',
  firstLessonSummary: {
    cardsRated: 4,
    sessionId: 'session_1',
    dailyReviewsToday: 4,
    dailyTimeMsToday: 60_000,
    dailyNewWordsToday: 7,
  },
  proficiencyBranch: 'test',
};

describe('buildProgressPayload', () => {
  it('maps empty wizard data to step-only: every optional is undefined', () => {
    expect(buildProgressPayload(EMPTY_ONBOARDING_DATA, 1)).toEqual({
      step: 1,
      reviewMode: undefined,
      targetLanguages: undefined,
      baseLanguages: undefined,
      currentLevel: undefined,
      acquisitionSource: undefined,
      acquisitionSourceFreeText: undefined,
      learningGoals: undefined,
      learningGoalFreeText: undefined,
      dailyTimeGoalMinutes: undefined,
      placementTest: undefined,
      firstLessonCardsRated: undefined,
      firstLessonSessionId: undefined,
      firstLessonSummary: undefined,
    });
  });

  it('passes fully-populated wizard data through field-by-field', () => {
    expect(buildProgressPayload(FULL_DATA, 8)).toEqual({
      step: 8,
      reviewMode: 'audio',
      targetLanguages: ['ja'],
      baseLanguages: ['en', 'de'],
      currentLevel: 'intermediate',
      acquisitionSource: 'reddit',
      acquisitionSourceFreeText: 'a podcast',
      learningGoals: ['travel', 'work'],
      learningGoalFreeText: 'business trips',
      dailyTimeGoalMinutes: 20,
      placementTest: FULL_DATA.placementTest,
      firstLessonCardsRated: 4,
      firstLessonSessionId: 'session_1',
      firstLessonSummary: FULL_DATA.firstLessonSummary,
    });
  });

  it('never includes the wizard-only proficiencyBranch field', () => {
    expect(buildProgressPayload(FULL_DATA, 5)).not.toHaveProperty(
      'proficiencyBranch',
    );
  });

  it('drops empty arrays (targetLanguages, baseLanguages, learningGoals)', () => {
    const payload = buildProgressPayload(
      { ...FULL_DATA, targetLanguages: [], baseLanguages: [], learningGoals: [] },
      3,
    );
    expect(payload.targetLanguages).toBeUndefined();
    expect(payload.baseLanguages).toBeUndefined();
    expect(payload.learningGoals).toBeUndefined();
  });

  it('drops firstLessonCardsRated when 0 but keeps positive counts', () => {
    expect(
      buildProgressPayload({ ...FULL_DATA, firstLessonCardsRated: 0 }, 8)
        .firstLessonCardsRated,
    ).toBeUndefined();
    expect(
      buildProgressPayload({ ...FULL_DATA, firstLessonCardsRated: 1 }, 8)
        .firstLessonCardsRated,
    ).toBe(1);
  });

  it('passes the step through unclamped', () => {
    expect(buildProgressPayload(EMPTY_ONBOARDING_DATA, 0).step).toBe(0);
    expect(buildProgressPayload(EMPTY_ONBOARDING_DATA, 13).step).toBe(13);
  });
});
