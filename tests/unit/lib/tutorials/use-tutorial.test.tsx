import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * The tour-completion contract of useTutorial:
 *  - clicking the highlighted element of the FINAL (call-to-action) step
 *    completes the tour: that click usually navigates away and hides the
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
  isActive: () => boolean;
  moveNext: () => void;
  /** Test-only: simulate a driver-internal close (`g(true)`). Not part of the real API. */
  closeFromUi: () => void;
};

let lastConfig: DriverConfig | null = null;
let lastDriver: MockDriver | null = null;

vi.mock('driver.js', () => ({
  driver: (config: DriverConfig) => {
    lastConfig = config;
    let active = true;
    const d: MockDriver = {
      drive: vi.fn(),
      // Real driver.js 1.4.0: the public `destroy()` is `g(false)`, which tears
      // down and deliberately SKIPS `onDestroyStarted` (dist/driver.js.mjs:594-604
      // Only `g(true)` fires the hook, and it returns early without tearing
      // down). An earlier version of this mock had destroy() call the hook,
      // which is the inverse of reality and hid a real bug: completion
      // bookkeeping hung off the hook never ran for app-initiated teardowns.
      destroy: vi.fn(() => {
        active = false;
      }),
      closeFromUi: () => {
        config.onDestroyStarted?.();
      },
      moveTo: vi.fn(),
      hasNextStep: vi.fn(() => false),
      isActive: () => active,
      moveNext: vi.fn(),
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
let useTutorial: (typeof import('@/lib/tutorials/use-tutorial'))['useTutorial'];

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

describe('useTutorial: completion semantics', () => {
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
    expect(
      lastStep.onHighlighted,
      'final step must carry the click-complete wiring',
    ).toBeTypeOf('function');

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

  it('a normal dismissal (user closes the driver) completes', async () => {
    renderTour({ enabled: true });
    await startTour();

    await act(async () => {
      lastDriver!.closeFromUi();
    });

    expect(completedIds()).toContain(TUTORIAL_IDS.HOME_TOUR);
    // The hook must perform the real teardown itself. driver.js will not.
    expect(lastDriver!.destroy).toHaveBeenCalled();
  });

  it('the CTA click tears the driver down, so no overlay is left behind', async () => {
    renderTour({ enabled: true });
    await startTour();

    const steps = lastConfig!.steps;
    const lastStep = steps[steps.length - 1];
    const cta = document.createElement('button');
    document.body.appendChild(cta);
    act(() => {
      lastStep.onHighlighted!(cta, lastStep, { driver: lastDriver! });
    });
    await act(async () => {
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(lastDriver!.destroy).toHaveBeenCalled();
    cta.remove();
  });

  it('a completed tour does not relaunch when the host hides and shows again', async () => {
    const { rerender } = renderTour({ enabled: true });
    await startTour();

    // User clicks the closing CTA. This both completes the tour and (usually)
    // navigates away, which hides the host.
    const steps = lastConfig!.steps;
    const lastStep = steps[steps.length - 1];
    const cta = document.createElement('button');
    document.body.appendChild(cta);
    act(() => {
      lastStep.onHighlighted!(cta, lastStep, { driver: lastDriver! });
    });
    await act(async () => {
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(completedIds()).toContain(TUTORIAL_IDS.HOME_TOUR);

    // HomeView stays mounted and merely toggles `enabled`; coming back must
    // NOT re-offer the tour ("Dashboard tutorial shows up again").
    lastConfig = null;
    await act(async () => {
      rerender({ enabled: false });
    });
    await act(async () => {
      rerender({ enabled: true });
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(lastConfig, 'tour must not relaunch after completion').toBeNull();
    cta.remove();
  });

  it('a hide-mid-tour does not suppress the NEXT run’s completion', async () => {
    const { rerender } = renderTour({ enabled: true });
    await startTour();

    // Hide mid-tour: does not persist, so the tour is offered again.
    await act(async () => {
      rerender({ enabled: false });
    });
    expect(completedIds()).not.toContain(TUTORIAL_IDS.HOME_TOUR);

    // Return to Home. The tour relaunches, and this time the user finishes it.
    await act(async () => {
      rerender({ enabled: true });
    });
    await startTour();
    await act(async () => {
      lastDriver!.closeFromUi();
    });

    expect(completedIds()).toContain(TUTORIAL_IDS.HOME_TOUR);
  });

  it('Enter advances the tour instead of dismissing it', async () => {
    renderTour({ enabled: true });
    await startTour();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

    expect(lastDriver!.moveNext).toHaveBeenCalledOnce();
    expect(completedIds()).not.toContain(TUTORIAL_IDS.HOME_TOUR);
  });

  it('drops the workload step when the forecast card is not on screen, and keeps it when it is', async () => {
    // The forecast card is gated on minimum activity and its own setting,
    // so at launch it may simply not be mounted. The tour must proceed
    // without its step instead of floating a popover over nothing.
    renderTour({ enabled: true });
    await startTour();
    const withoutCard = lastConfig!.steps.map((s) => s.element);
    expect(withoutCard.length).toBeGreaterThan(0);
    expect(withoutCard).not.toContain('[data-tutorial="workload-forecast"]');

    // Re-run with the card mounted (jsdom rects are all zero, so visibility
    // needs a stubbed non-zero rect) — the step must survive the filter.
    vi.resetModules();
    localStorage.clear();
    ({ useTutorial } = await import('@/lib/tutorials/use-tutorial'));
    lastConfig = null;
    const el = document.createElement('div');
    el.setAttribute('data-tutorial', 'workload-forecast');
    el.getBoundingClientRect = () =>
      ({ width: 100, height: 40, top: 0, left: 0 }) as DOMRect;
    document.body.appendChild(el);
    try {
      renderTour({ enabled: true });
      await startTour();
      // resolveStepAnchors swaps a found selector for its DOM element, so
      // assert by identity: the mounted card is among the step anchors.
      expect(lastConfig!.steps.map((s) => s.element)).toContain(el);
      expect(lastConfig!.steps.length).toBe(withoutCard.length + 1);
    } finally {
      el.remove();
    }
  });
});
