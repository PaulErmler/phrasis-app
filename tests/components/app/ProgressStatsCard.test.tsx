import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { formatTimeMs } from '@/lib/formatTime';

/**
 * The reps and time tiles are each one number over three different
 * activities: graded FSRS reviews, free listening (radio) and free typing
 * (free study). Tapping a tile cycles all → learn → radio → freeStudy and
 * writes the face to its own `userSettings` field (`repsStatFilter` /
 * `timeStatFilter`), so the two can be inspected independently.
 */

const updateUserSettingsMock = vi.fn();
vi.mock('@/hooks/use-update-user-settings', () => ({
  useUpdateUserSettings: () => updateUserSettingsMock,
}));

// usePreloadedQuery just unwraps whatever useAppData handed over.
vi.mock('convex/react', () => ({
  usePreloadedQuery: (preloaded: unknown) => preloaded,
}));

type Face = 'all' | 'learn' | 'radio' | 'freeStudy';
let userSettings: {
  repsStatFilter?: Face;
  timeStatFilter?: Face;
} | null = null;
vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({
    preloadedSettings: userSettings,
    preloadedHomeSummary: null,
    preloadedCourseSettings: null,
  }),
}));

// 100 lifetime reps: 60 graded (40 audio + 20 full), 40 free play
// (30 radio + 10 freeStudy). Today: 10 = 6 graded + 4 free play.
// Time: 60 min lifetime = 50 graded + 6:40 radio + 3:20 free study;
// today 10 min = 6:40 graded + 2:30 radio + 0:50 free study.
const courseStats = {
  totalRepetitions: 100,
  totalTimeMs: 3_600_000,
  totalTimeMsByMode: {
    audio: 2_000_000,
    full: 1_000_000,
    radio: 400_000,
    freeStudy: 200_000,
  },
  totalCards: 250,
  currentStreak: 5,
  streakFreezeCount: 0,
  streakFrozenToday: false,
  streakState: 'active' as const,
  totalWordCount: 400,
  totalReviewsByMode: { audio: 40, full: 20, radio: 30, freeStudy: 10 },
  targetLanguages: ['es'],
  baseLanguages: ['en'],
};
const todayStats = {
  reps: 10,
  newCards: 2,
  timeMs: 600_000,
  reviewsByMode: { audio: 4, full: 2, radio: 3, freeStudy: 1 },
  timeMsByMode: {
    audio: 300_000,
    full: 100_000,
    radio: 150_000,
    freeStudy: 50_000,
  },
};

vi.mock('@/hooks/use-cached-query', () => ({
  useCachedQuery: (_fn: unknown, _args: unknown, cacheKey: string) =>
    cacheKey.startsWith('courseStats') ? courseStats : todayStats,
}));

// The counter animates over 1.5s; the tile's final number is what matters here.
vi.mock('@/hooks/use-animated-counter', () => ({
  useAnimatedCounter: (target: number) => target,
}));

vi.mock('@/components/app/StartLearningButton', () => ({
  StartLearningButton: () => null,
}));
vi.mock('@/components/app/stats/RotatingProjection', () => ({
  RotatingProjection: () => null,
}));
vi.mock('@/components/app/stats/DailyGoalQuickEdit', () => ({
  DailyGoalQuickEdit: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/components/app/stats/DailyGoalRing', () => ({
  DailyGoalRing: () => null,
}));

import { ProgressStatsCard } from '@/components/app/ProgressStatsCard';

const cardElement = () => (
  <ProgressStatsCard
    onStartLearn={vi.fn()}
    onReviewModeChange={vi.fn()}
    courseId="course1"
  />
);

function renderCard() {
  return render(cardElement());
}

const tile = () => screen.getByTestId('reps-stat-column');
const timeTile = () => screen.getByTestId('time-stat-column');
/** The tile's headline (lifetime) number. */
const tileValue = () => Number(tile().querySelector('p')?.textContent);

describe('ProgressStatsCard: reps tile filter', () => {
  beforeEach(() => {
    localStorage.clear();
    updateUserSettingsMock.mockReset();
    updateUserSettingsMock.mockResolvedValue(undefined);
    userSettings = null;
  });

  it('shows every rep when the setting is unset', () => {
    renderCard();
    expect(tile()).toHaveTextContent('100');
    expect(tile()).toHaveTextContent('stats.reps');
    expect(tile()).toHaveTextContent('10 stats.today');
  });

  it('shows graded reviews only under the learn face', () => {
    userSettings = { repsStatFilter: 'learn' };
    renderCard();
    expect(tile()).toHaveTextContent('60');
    expect(tile()).toHaveTextContent('stats.repsLearn');
    expect(tile()).toHaveTextContent('6 stats.today');
  });

  it('shows free listening only under the radio face', () => {
    userSettings = { repsStatFilter: 'radio' };
    renderCard();
    expect(tile()).toHaveTextContent('30');
    expect(tile()).toHaveTextContent('stats.repsRadio');
    expect(tile()).toHaveTextContent('3 stats.today');
  });

  it('shows free typing only under the free study face', () => {
    userSettings = { repsStatFilter: 'freeStudy' };
    renderCard();
    expect(tile()).toHaveTextContent('10');
    expect(tile()).toHaveTextContent('stats.repsFreeStudy');
    expect(tile()).toHaveTextContent('1 stats.today');
  });

  it('adds up: learn + radio + freeStudy is the all-modes total', () => {
    const { rerender } = renderCard();
    let sum = 0;
    for (const face of ['learn', 'radio', 'freeStudy'] as const) {
      userSettings = { repsStatFilter: face };
      rerender(cardElement());
      sum += tileValue();
    }
    expect(sum).toBe(courseStats.totalRepetitions);
  });

  it('persists the next face on each tap, wrapping back to all', () => {
    // The mocked useAppData reads `userSettings` on every render, so a
    // rerender is the settings round-trip landing.
    const { rerender } = renderCard();
    fireEvent.click(tile());
    expect(updateUserSettingsMock).toHaveBeenLastCalledWith({
      repsStatFilter: 'learn',
    });

    userSettings = { repsStatFilter: 'learn' };
    rerender(cardElement());
    fireEvent.click(tile());
    expect(updateUserSettingsMock).toHaveBeenLastCalledWith({
      repsStatFilter: 'radio',
    });

    userSettings = { repsStatFilter: 'radio' };
    rerender(cardElement());
    fireEvent.click(tile());
    expect(updateUserSettingsMock).toHaveBeenLastCalledWith({
      repsStatFilter: 'freeStudy',
    });

    userSettings = { repsStatFilter: 'freeStudy' };
    rerender(cardElement());
    fireEvent.click(tile());
    expect(updateUserSettingsMock).toHaveBeenLastCalledWith({
      repsStatFilter: 'all',
    });
  });

  it('reps and time are the interactive stat columns', () => {
    renderCard();
    expect(tile().tagName).toBe('BUTTON');
    expect(tile()).toHaveAttribute(
      'aria-label',
      '100 stats.reps. stats.repsCycleHint',
    );
    expect(timeTile().tagName).toBe('BUTTON');
    expect(timeTile()).toHaveAttribute(
      'aria-label',
      `${formatTimeMs(3_600_000)} stats.time. stats.timeCycleHint`,
    );
    // The other two stat columns stay inert divs.
    for (const label of ['stats.sentences', 'stats.words']) {
      expect(screen.getByText(label).closest('button')).toBeNull();
    }
  });
});

describe('ProgressStatsCard: time tile filter', () => {
  beforeEach(() => {
    localStorage.clear();
    updateUserSettingsMock.mockReset();
    updateUserSettingsMock.mockResolvedValue(undefined);
    userSettings = null;
  });

  it('shows all time when the setting is unset', () => {
    renderCard();
    expect(timeTile()).toHaveTextContent(formatTimeMs(3_600_000));
    expect(timeTile()).toHaveTextContent('stats.time');
    expect(timeTile()).toHaveTextContent(
      `${formatTimeMs(600_000)} stats.today`,
    );
  });

  it('shows one face per free-play mode and graded time under learn', () => {
    const faces = [
      ['learn', 3_000_000, 400_000, 'stats.timeLearn'],
      ['radio', 400_000, 150_000, 'stats.timeRadio'],
      ['freeStudy', 200_000, 50_000, 'stats.timeFreeStudy'],
    ] as const;
    const { rerender } = renderCard();
    for (const [face, total, today, label] of faces) {
      userSettings = { timeStatFilter: face };
      rerender(cardElement());
      expect(timeTile()).toHaveTextContent(formatTimeMs(total));
      expect(timeTile()).toHaveTextContent(label);
      expect(timeTile()).toHaveTextContent(
        `${formatTimeMs(today)} stats.today`,
      );
    }
  });

  it('persists its own setting and leaves the reps face alone', () => {
    userSettings = { repsStatFilter: 'radio' };
    const { rerender } = renderCard();
    fireEvent.click(timeTile());
    expect(updateUserSettingsMock).toHaveBeenLastCalledWith({
      timeStatFilter: 'learn',
    });

    userSettings = { repsStatFilter: 'radio', timeStatFilter: 'learn' };
    rerender(cardElement());
    // Reps still on its own face; time moved on.
    expect(tile()).toHaveTextContent('stats.repsRadio');
    expect(timeTile()).toHaveTextContent('stats.timeLearn');
    fireEvent.click(timeTile());
    expect(updateUserSettingsMock).toHaveBeenLastCalledWith({
      timeStatFilter: 'radio',
    });
  });
});
