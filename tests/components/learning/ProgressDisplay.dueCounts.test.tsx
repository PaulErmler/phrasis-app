import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ProgressDisplay } from '@/components/app/learning/ProgressDisplay';

let userSettingsValue: { hideDueCounts?: boolean } | null = {};

const useQueryMock = vi.fn();
vi.mock('convex/react', () => ({
  useQuery: (query: unknown, args?: unknown) => useQueryMock(query, args),
}));

vi.mock('@/hooks/use-now-minute', () => ({
  useNowMinute: () => 1_755_000_000_000,
}));

vi.mock('@/lib/timezone', () => ({
  getUserTimezone: () => 'UTC',
}));

vi.mock('@/components/effects/ConfettiBurst', () => ({
  ConfettiBurst: () => null,
}));

vi.mock('@/lib/audio/mediaSession', () => ({
  setupMediaSession: () => () => {},
  setMediaSessionPlaybackState: () => {},
}));

vi.mock('motion/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    children ?? null;
  return { motion: new Proxy({}, { get: () => passthrough }) };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

class FakeAudio {
  preload = '';
  ended = false;
  currentTime = 0;
  duration = 1;
  play() {
    return Promise.resolve();
  }
  pause() {}
}

vi.stubGlobal('Audio', FakeAudio);

const cardCounts = {
  new: 3,
  learning: 1,
  relearning: 0,
  review: 4,
};

function renderProgress() {
  return render(
    <ProgressDisplay
      sessionId="session-1"
      dailyReviewsToday={10}
      dailyTimeMsToday={60_000}
      dailyNewWordsToday={2}
      reviewMode="full"
      autoAdvance={false}
      onContinue={() => {}}
      ready
    />,
  );
}

beforeEach(() => {
  userSettingsValue = {};
  useQueryMock.mockReset();
  useQueryMock.mockImplementation((_query: unknown, args?: unknown) => {
    if (args === 'skip') return undefined;
    if (args && typeof args === 'object' && 'now' in args) return cardCounts;
    if (args && typeof args === 'object' && 'sessionId' in args) {
      return { session: [], today: [] };
    }
    // getUserSettings is called with no args.
    return userSettingsValue;
  });
});

describe('ProgressDisplay due-count pills', () => {
  it('shows upcoming cards when hideDueCounts is unset', () => {
    renderProgress();
    expect(screen.getByText('comingUp')).toBeTruthy();
  });

  it('omits upcoming cards and skips the counts query when hideDueCounts is on', () => {
    userSettingsValue = { hideDueCounts: true };
    renderProgress();
    expect(screen.queryByText('comingUp')).toBeNull();
    expect(
      useQueryMock.mock.calls.some((call) => call[1] === 'skip'),
    ).toBe(true);
  });
});
