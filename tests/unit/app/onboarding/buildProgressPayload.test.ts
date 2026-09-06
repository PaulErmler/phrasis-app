import { describe, it, expect } from 'vitest';
import { buildProgressPayload } from '@/app/app/onboarding/page';
import {
  EMPTY_ONBOARDING_DATA,
  type OnboardingData,
} from '@/app/app/onboarding/types';

/**
 * `buildProgressPayload` is the single source of truth for the
 * `saveOnboardingProgress` payload. All three wizard call sites (debounced
 * `persist`, immediate `advance`, immediate `back`) route through it. These
 * tests pin the empty-vs-populated field mapping so a refactor can't silently
 * start persisting empty arrays / nulls (the Convex validator expects
 * `undefined` for absent optionals).
 */

const FULL_DATA: OnboardingData = {
  reviewMode: 'full',
  writingInputMode: 'transcribe',
  targetLanguages: ['ja'],
  baseLanguages: ['en', 'de'],
  currentLevel: 'intermediate',
  acquisitionSource: 'reddit',
  acquisitionSourceFreeText: 'a podcast',
  learningGoals: ['travel', 'work'],
  learningGoalFreeText: 'business trips',
  priorApps: ['anki', 'other'],
  priorAppsFreeText: 'Memrise',
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
  proficiencyBranch: 'test',
};

describe('buildProgressPayload', () => {
  it('maps empty wizard data to step-only: every optional is undefined', () => {
    expect(buildProgressPayload(EMPTY_ONBOARDING_DATA, 1)).toEqual({
      step: 1,
      reviewMode: undefined,
      // The one field that stays null rather than collapsing. Null is what
      // CLEARS a previously saved writing style on the server.
      writingInputMode: null,
      targetLanguages: undefined,
      baseLanguages: undefined,
      currentLevel: undefined,
      acquisitionSource: undefined,
      acquisitionSourceFreeText: undefined,
      learningGoals: undefined,
      learningGoalFreeText: undefined,
      priorApps: undefined,
      priorAppsFreeText: undefined,
      dailyTimeGoalMinutes: undefined,
      placementTest: undefined,
    });
  });

  it('passes fully-populated wizard data through field-by-field', () => {
    expect(buildProgressPayload(FULL_DATA, 7)).toEqual({
      step: 7,
      reviewMode: 'full',
      writingInputMode: 'transcribe',
      targetLanguages: ['ja'],
      baseLanguages: ['en', 'de'],
      currentLevel: 'intermediate',
      acquisitionSource: 'reddit',
      acquisitionSourceFreeText: 'a podcast',
      learningGoals: ['travel', 'work'],
      learningGoalFreeText: 'business trips',
      priorApps: ['anki', 'other'],
      priorAppsFreeText: 'Memrise',
      dailyTimeGoalMinutes: 20,
      placementTest: FULL_DATA.placementTest,
    });
  });

  it('never includes the wizard-only proficiencyBranch field', () => {
    expect(buildProgressPayload(FULL_DATA, 5)).not.toHaveProperty(
      'proficiencyBranch',
    );
  });

  it('drops empty arrays (targetLanguages, baseLanguages, learningGoals, priorApps)', () => {
    const payload = buildProgressPayload(
      {
        ...FULL_DATA,
        targetLanguages: [],
        baseLanguages: [],
        learningGoals: [],
        priorApps: [],
      },
      3,
    );
    expect(payload.targetLanguages).toBeUndefined();
    expect(payload.baseLanguages).toBeUndefined();
    expect(payload.learningGoals).toBeUndefined();
    expect(payload.priorApps).toBeUndefined();
  });

  it('keeps a null writingInputMode (audio pick) as an explicit null', () => {
    // Regression: this used to collapse to `undefined`, which the Convex
    // client strips from the args, so a previously saved 'transcribe' was
    // never cleared, `completeOnboarding` copied it onto courseSettings, and
    // the user landed in Transcribe the first time they opened Writing mode.
    // `null` is the wire signal that clears the stored style.
    expect(
      buildProgressPayload(
        { ...FULL_DATA, reviewMode: 'audio', writingInputMode: null },
        7,
      ).writingInputMode,
    ).toBeNull();
  });

  it('passes the step through unclamped', () => {
    expect(buildProgressPayload(EMPTY_ONBOARDING_DATA, 0).step).toBe(0);
    expect(buildProgressPayload(EMPTY_ONBOARDING_DATA, 13).step).toBe(13);
  });
});
