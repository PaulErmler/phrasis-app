import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WordProjectionStep } from '@/app/app/onboarding/steps/WordProjectionStep';
import { api } from '@/convex/_generated/api';
import type { OnboardingSessionSummary } from '@/app/app/onboarding/components/OnboardingFirstLesson';

// The component reads live data via convex's useQuery — dispatch on the
// query reference so each test can shape the two results independently.
const useQueryMock = vi.fn();
vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

/**
 * Zero-words hardening (the production "you'll know 0 words" screenshot):
 *  - the live celebration query may only ever RAISE the word count over the
 *    persisted lesson snapshot — a resolved-but-empty result (day rollover,
 *    auth blip, no active course) must not zero out earned words;
 *  - if both sources still report zero once the query has resolved, the
 *    step must advance itself instead of rendering a 0-word projection.
 */

const word = (w: string) => ({ language: 'es', display: w });

const summaryWith = (
  overrides: Partial<OnboardingSessionSummary> = {},
): OnboardingSessionSummary => ({
  sessionId: 'session-1',
  cardsRated: 6,
  dailyReviewsToday: 6,
  dailyNewWordsToday: 6,
  dailyTimeMsToday: 180_000,
  ...overrides,
});

function mockQueries({
  todayStats,
  celebrationWords,
}: {
  todayStats: { timeMs: number } | null | undefined;
  celebrationWords:
    | { session: Array<{ language: string; display: string }>; today: Array<{ language: string; display: string }> }
    | undefined;
}) {
  useQueryMock.mockImplementation((query: unknown) =>
    query === api.features.courses.getTodayStats ? todayStats : celebrationWords,
  );
}

function renderStep(summary: OnboardingSessionSummary | null) {
  const onContinue = vi.fn();
  render(
    <WordProjectionStep
      summary={summary}
      dailyTimeGoalMinutes={20}
      onContinue={onContinue}
    />,
  );
  return { onContinue };
}

describe('WordProjectionStep — zero-words hardening', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it('keeps the snapshot word count when the live query resolves empty (day rollover)', () => {
    mockQueries({
      todayStats: null,
      celebrationWords: { session: [], today: [] },
    });
    const { onContinue } = renderStep(summaryWith({ dailyNewWordsToday: 6 }));

    // The Today timeline stop shows newWords — snapshot survives the
    // empty query instead of collapsing to 0.
    expect(screen.getByTestId('projection-timeline')).toHaveTextContent(
      '6 wordsUnit',
    );
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('prefers the live query when it reports more than the snapshot', () => {
    mockQueries({
      todayStats: { timeMs: 200_000 },
      celebrationWords: {
        session: [word('hola'), word('adiós')],
        today: [word('gracias'), word('por'), word('favor')],
      },
    });
    renderStep(summaryWith({ dailyNewWordsToday: 4 }));

    // 2 session + 3 today = 5 > snapshot's 4.
    expect(screen.getByTestId('projection-timeline')).toHaveTextContent(
      '5 wordsUnit',
    );
  });

  it('advances past the step when both sources report zero after the query resolves', () => {
    mockQueries({
      todayStats: null,
      celebrationWords: { session: [], today: [] },
    });
    const { onContinue } = renderStep(null);

    expect(onContinue).toHaveBeenCalledTimes(1);
    // The zero-state must not flash while advancing.
    expect(
      screen.queryByTestId('onboarding-step-word-projection'),
    ).not.toBeInTheDocument();
  });

  it('does not advance while the words query is still loading', () => {
    mockQueries({ todayStats: undefined, celebrationWords: undefined });
    const { onContinue } = renderStep(null);

    expect(onContinue).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('onboarding-step-word-projection'),
    ).toBeInTheDocument();
  });
});
