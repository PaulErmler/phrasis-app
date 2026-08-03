import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * The tour-completion contract of useTutorial:
 *  - clicking the highlighted element of the FINAL (call-to-action) step
 *    completes the tour — that click usually navigates away and hides the
 *    host, which would otherwise hit the suppress path below and leave the
 *    tour re-running on every visit ("Dashboard tutorial shows up again");
 *  - hiding the host mid-tour (enabled → false on an earlier step) tears
 *    down WITHOUT completing, so the tour re-offers on return.
 */

type DriverConfig = {
  steps: Array<{
    element?: unknown;
    onHighlighted?: (
      el: Element | undefined,
      step: unknown,
      opts: { driver: MockDriver },
    ) => void;
    onDeselected?: () => void;
  }>;
  onDestroyStarted?: () => void;
};

type MockDriver = {
  drive: () => void;
  destroy: () => void;
  moveTo: (i: number) => void;
  hasNextStep: () => boolean;
};

let lastConfig: DriverConfig | null = null;
let lastDriver: MockDriver | null = null;

vi.mock('driver.js', () => ({
  driver: (config: DriverConfig) => {
    lastConfig = config;
    let inHook = false;
    const d: MockDriver = {
      drive: vi.fn(),
      // Real driver.js: destroy() runs onDestroyStarted when configured; the
      // hook then calls destroy() again to actually tear down.
      destroy: vi.fn(() => {
        if (config.onDestroyStarted && !inHook) {
          inHook = true;
          config.onDestroyStarted();
          inHook = false;
        }
      }),
      moveTo: vi.fn(),
      hasNextStep: vi.fn(() => false),
    };
    lastDriver = d;
    return d;
  },
}));

const completeMutation = vi.fn(() => Promise.resolve(null));
vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => undefined),
  useMutation: vi.fn(() => completeMutation),
}));

vi.mock('@/lib/posthog/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/posthog/events')>(
    '@/lib/posthog/events',
  );
  return { ...actual, capture: vi.fn() };
});

import { TUTORIAL_IDS } from '@/convex/features/tutorialIds';

const STORAGE_KEY = 'phrasis_completed_tutorials';
const completedIds = (): string[] =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');

// The hook module caches its completed-tutorials snapshot at module level,
// so each test gets a fresh module instance (vi.resetModules in beforeEach).
let useTutorial: typeof import('@/lib/tutorials/use-tutorial')['useTutorial'];

function renderTour(props: { enabled: boolean }) {
  return renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useTutorial(TUTORIAL_IDS.HOME_TOUR, {
        enabled,
        delayMs: 0,
        stepCompleteOnClickIndex: 2,
        context: { reviewMode: 'audio' },
      }),
    { initialProps: props },
  );
}

async function startTour() {
  await act(async () => {
    vi.advanceTimersByTime(0); // fire the delayMs timer → launchDriver
  });
  expect(lastConfig).not.toBeNull();
}

describe('useTutorial — completion semantics', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    ({ useTutorial } = await import('@/lib/tutorials/use-tutorial'));
    vi.useFakeTimers();
    lastConfig = null;
    lastDriver = null;
    completeMutation.mockClear();
  });
  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    localStorage.clear();
  });

  it('clicking the highlighted element of the FINAL step completes the tour', async () => {
    renderTour({ enabled: true });
    await startTour();

    const steps = lastConfig!.steps;
    const lastStep = steps[steps.length - 1];
    expect(lastStep.onHighlighted, 'final step must carry the click-complete wiring').toBeTypeOf(
      'function',
    );

    // Simulate driver highlighting the closing CTA, then the user clicking it.
    const cta = document.createElement('button');
    document.body.appendChild(cta);
    act(() => {
      lastStep.onHighlighted!(cta, lastStep, { driver: lastDriver! });
    });
    await act(async () => {
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(completedIds()).toContain(TUTORIAL_IDS.HOME_TOUR);
    expect(completeMutation).toHaveBeenCalledWith({
      tutorialId: TUTORIAL_IDS.HOME_TOUR,
    });
    cta.remove();
  });

  it('hiding the host mid-tour suppresses completion so the tour re-offers', async () => {
    const { rerender } = renderTour({ enabled: true });
    await startTour();

    // Host view hides (user navigated away) while the tour is active.
    await act(async () => {
      rerender({ enabled: false });
    });

    expect(completedIds()).not.toContain(TUTORIAL_IDS.HOME_TOUR);
    expect(completeMutation).not.toHaveBeenCalled();
  });

  it('a normal dismissal (driver destroy without suppress) completes', async () => {
    renderTour({ enabled: true });
    await startTour();

    await act(async () => {
      lastDriver!.destroy();
    });

    expect(completedIds()).toContain(TUTORIAL_IDS.HOME_TOUR);
  });
});
