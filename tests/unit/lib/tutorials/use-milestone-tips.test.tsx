import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Contract of useMilestoneTips (the learning-mode teaching layer that
 * replaced the onboarding tutorial lesson):
 *  - fresh user → the current mode's intro walkthrough fires on the first
 *    card and persists PER CONCEPT on dismissal;
 *  - switching modes replays nothing, only the new mode's own concepts;
 *  - milestone tips fire one at a time at their lifetime-review thresholds;
 *  - veteran users (count far past every threshold) get everything
 *    silently marked instead of shown.
 */

type DriverConfig = {
  steps: Array<{ element?: unknown; popover?: { title?: string } }>;
  onDestroyStarted?: () => void;
};

type MockDriver = {
  drive: () => void;
  destroy: () => void;
  isActive: () => boolean;
  moveNext: () => void;
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
      destroy: vi.fn(() => {
        active = false;
      }),
      isActive: () => active,
      moveNext: vi.fn(),
      // Simulates driver-internal close paths (X / Esc / finishing) which
      // fire onDestroyStarted; the public destroy() does not.
      closeFromUi: () => {
        config.onDestroyStarted?.();
      },
    };
    lastDriver = d;
    return d;
  },
}));

const queryState = vi.hoisted(() => ({
  // `Error` is a real possible value: the lifetime count is read through
  // `useQueries`, which reports a failed query as an Error instead of
  // throwing it into render.
  lifetimeReps: 0 as number | null | Error,
  dbCompleted: [] as string[] | undefined,
}));
const completeMutation = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));

vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server');
  const resolve = (ref: unknown) => {
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    if (name.includes('getLifetimeReviewCount')) return queryState.lifetimeReps;
    if (name.includes('getCompletedTutorials')) return queryState.dbCompleted;
    // Auth user. Must resolve (isLoaded gates on it) so completions bind
    // to the per-user localStorage key, never the device-level fallback.
    return { userId: 'user_test', _id: 'user_test' };
  };
  return {
    useQuery: (ref: unknown, args?: unknown) =>
      args === 'skip' ? undefined : resolve(ref),
    // `useMilestoneTips` reads the lifetime count through `useQueries` so a
    // server error arrives as a VALUE instead of being thrown into render
    // (see the hook). Mirror that here: absent keys mean "not subscribed",
    // and `queryState.lifetimeReps` may itself be an Error.
    useQueries: (queries: Record<string, { query: unknown }>) =>
      Object.fromEntries(
        Object.entries(queries).map(([key, { query }]) => [
          key,
          resolve(query),
        ]),
      ),
    useMutation: () => completeMutation,
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/posthog/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/posthog/events')>(
    '@/lib/posthog/events',
  );
  return { ...actual, capture: vi.fn() };
});

import { TUTORIAL_IDS } from '@/convex/features/tutorialIds';

// Per-user key. Completion state is per USER (the mocked auth user above),
// not per device; the bare un-suffixed key must stay untouched.
const STORAGE_KEY = 'phrasis_completed_tutorials_user_test';
const DEVICE_LEVEL_KEY = 'phrasis_completed_tutorials';
const completedIds = (): string[] =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
const preMark = (ids: string[]) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));

const AUDIO_INTRO_IDS = [
  TUTORIAL_IDS.TIP_CONCEPT_CARD,
  TUTORIAL_IDS.TIP_CONCEPT_REVEAL,
  TUTORIAL_IDS.TIP_CONCEPT_AUDIO_CONTROLS,
  TUTORIAL_IDS.TIP_CONCEPT_RATING_AUDIO,
  TUTORIAL_IDS.TIP_CONCEPT_AUTOADD,
];
const FULL_ONLY_IDS = [
  TUTORIAL_IDS.TIP_CONCEPT_SHOWN_TRANSLATION,
  TUTORIAL_IDS.TIP_CONCEPT_INPUT,
  TUTORIAL_IDS.TIP_CONCEPT_RATING_FULL,
];

// Fresh module per test. The completed-tutorials snapshot is module-level
// and reads localStorage at import time, so tests must seed localStorage
// (preMark) BEFORE calling loadHook().
let useMilestoneTips: (typeof import('@/lib/tutorials/use-milestone-tips'))['useMilestoneTips'];

async function loadHook() {
  ({ useMilestoneTips } = await import('@/lib/tutorials/use-milestone-tips'));
}

function renderTips(props: {
  enabled: boolean;
  reviewMode: 'audio' | 'full';
  transcribe?: boolean;
}) {
  return renderHook(
    (p: {
      enabled: boolean;
      reviewMode: 'audio' | 'full';
      transcribe?: boolean;
    }) =>
      useMilestoneTips({
        enabled: p.enabled,
        reviewMode: p.reviewMode,
        transcribe: p.transcribe,
      }),
    { initialProps: props },
  );
}

/** Advance past the intro delay (600ms) and the settle-wait timeout (2s,
 *  with no anchor mounted, jsdom reports no size and the wait falls back to
 *  its timeout). */
async function firePendingTip() {
  await act(async () => {
    vi.advanceTimersByTime(3_000);
  });
}

const STUB_RECT = {
  x: 10,
  y: 10,
  top: 10,
  left: 10,
  right: 110,
  bottom: 30,
  width: 100,
  height: 20,
  toJSON: () => ({}),
} as DOMRect;

/**
 * Mount a tip anchor with a stable, non-zero rect.
 *
 * jsdom gives every element a zero rect, so `whenElementSettled` can never
 * settle on a real element and always falls through to its timeout. That is
 * fine for the intro (its welcome step is unanchored anyway), but a MILESTONE
 * whose anchor never appears now defers instead of mounting an unanchored
 * popover about a control the user cannot see, so any test expecting a
 * milestone to fire has to provide its anchor.
 */
function mountAnchor(attr: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute(attr, value);
  el.getBoundingClientRect = () => STUB_RECT;
  document.body.appendChild(el);
  return el;
}

describe('useMilestoneTips', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.useFakeTimers();
    lastConfig = null;
    lastDriver = null;
    completeMutation.mockClear();
    queryState.lifetimeReps = 0;
    queryState.dbCompleted = [];
  });
  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('fires the full audio intro for a fresh user and persists every concept on dismissal', async () => {
    await loadHook();
    renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();

    expect(lastConfig).not.toBeNull();
    // welcome + 5 audio concepts
    expect(lastConfig!.steps).toHaveLength(1 + AUDIO_INTRO_IDS.length);

    await act(async () => {
      lastDriver!.closeFromUi();
    });
    for (const id of AUDIO_INTRO_IDS) {
      expect(completedIds()).toContain(id);
    }
    // Mode-specific concepts of the OTHER mode stay unseen.
    for (const id of FULL_ONLY_IDS) {
      expect(completedIds()).not.toContain(id);
    }
  });

  it('switching modes shows only the new mode-specific concepts (no re-explaining)', async () => {
    preMark(AUDIO_INTRO_IDS);
    await loadHook();
    const { rerender } = renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();
    // Audio intro fully seen → nothing fires.
    expect(lastConfig).toBeNull();

    await act(async () => {
      rerender({ enabled: true, reviewMode: 'full' });
    });
    await firePendingTip();

    expect(lastConfig).not.toBeNull();
    // "Switched to Writing" welcome + input + full-mode rating ONLY.
    // card/autoAdd were taught in audio mode and must not repeat.
    expect(lastConfig!.steps).toHaveLength(1 + FULL_ONLY_IDS.length);

    await act(async () => {
      lastDriver!.closeFromUi();
    });
    for (const id of FULL_ONLY_IDS) {
      expect(completedIds()).toContain(id);
    }
  });

  it('skips the shown-translation concept in the Transcribe writing style without persisting it', async () => {
    await loadHook();
    renderTips({ enabled: true, reviewMode: 'full', transcribe: true });
    await firePendingTip();

    expect(lastConfig).not.toBeNull();
    // welcome + full concepts minus shown-translation (doesn't exist in
    // Transcribe, the shown target would BE the answer).
    expect(lastConfig!.steps).toHaveLength(1 + FULL_ONLY_IDS.length + 2 - 1);

    await act(async () => {
      lastDriver!.closeFromUi();
    });
    // Not persisted: switching to the Translate style later must still
    // explain the shown translation.
    expect(completedIds()).not.toContain(
      TUTORIAL_IDS.TIP_CONCEPT_SHOWN_TRANSLATION,
    );
    expect(completedIds()).toContain(TUTORIAL_IDS.TIP_CONCEPT_INPUT);
  });

  it('fires milestone tips one at a time, lowest threshold first', async () => {
    preMark(AUDIO_INTRO_IDS);
    mountAnchor('data-coachmark-anchor', 'card-actions');
    mountAnchor('data-tutorial', 'chat-button');
    queryState.lifetimeReps = 15; // several tips eligible at once
    await loadHook();
    renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();

    // Only the lowest-threshold tip shows; the rest wait for later reviews.
    expect(lastConfig).not.toBeNull();
    expect(lastConfig!.steps).toHaveLength(1);
    await act(async () => {
      lastDriver!.closeFromUi();
    });
    expect(completedIds()).toContain(TUTORIAL_IDS.TIP_CARD_ACTIONS);
    expect(completedIds()).not.toContain(TUTORIAL_IDS.TIP_CHAT);
  });

  it('does not chain the next milestone off the previous one closing', async () => {
    // Regression: `completed` used to be a dependency of the milestone
    // effect, so persisting a dismissed tip re-ran it and immediately fired
    // the next eligible one. At 15 lifetime reviews EVERY threshold is met
    // (and the veteran guard doesn't apply below 50), so the user got every
    // remaining milestone popover back-to-back on a single card. Both anchors are mounted,
    // so only the dependency change can keep the second tip from showing.
    preMark(AUDIO_INTRO_IDS);
    mountAnchor('data-coachmark-anchor', 'card-actions');
    mountAnchor('data-tutorial', 'chat-button');
    queryState.lifetimeReps = 15;
    await loadHook();
    renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();
    expect(lastConfig).not.toBeNull();

    await act(async () => {
      lastDriver!.closeFromUi();
    });
    lastConfig = null;
    // The review count has NOT advanced, no card transition happened.
    await firePendingTip();

    expect(lastConfig, 'second tip fired on the same card').toBeNull();
    expect(completedIds()).not.toContain(TUTORIAL_IDS.TIP_CHAT);
  });

  it('fires the next milestone tip when the review count advances', async () => {
    preMark([...AUDIO_INTRO_IDS, TUTORIAL_IDS.TIP_CARD_ACTIONS]);
    mountAnchor('data-tutorial', 'chat-button');
    queryState.lifetimeReps = 4;
    await loadHook();
    const { rerender } = renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();
    expect(lastConfig).toBeNull(); // card-actions done, chat needs 5

    queryState.lifetimeReps = 5;
    await act(async () => {
      rerender({ enabled: true, reviewMode: 'audio' });
    });
    await firePendingTip();

    expect(lastConfig).not.toBeNull();
    await act(async () => {
      lastDriver!.closeFromUi();
    });
    expect(completedIds()).toContain(TUTORIAL_IDS.TIP_CHAT);
  });

  it('defers a milestone whose anchor never renders instead of burning it', async () => {
    // Regression: the word-tap anchor only exists in the card state that
    // renders clickable words. Without an anchor the settle wait used to hit
    // its timeout and mount the popover unanchored, pointing at nothing,
    // and marked completed on dismissal, so the tip was lost for good.
    preMark([
      ...AUDIO_INTRO_IDS,
      TUTORIAL_IDS.TIP_CARD_ACTIONS,
      TUTORIAL_IDS.TIP_CHAT,
    ]);
    queryState.lifetimeReps = 8; // word-tap is the next eligible tip
    await loadHook();
    const { rerender } = renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();

    expect(lastConfig, 'unanchored popover mounted').toBeNull();
    expect(completedIds()).not.toContain(TUTORIAL_IDS.TIP_WORD_TAP);

    // Still claimable: once the anchor exists, the next review shows it.
    mountAnchor('data-coachmark-anchor', 'word-tap');
    queryState.lifetimeReps = 9;
    await act(async () => {
      rerender({ enabled: true, reviewMode: 'audio' });
    });
    await firePendingTip();

    expect(lastConfig).not.toBeNull();
    await act(async () => {
      lastDriver!.closeFromUi();
    });
    expect(completedIds()).toContain(TUTORIAL_IDS.TIP_WORD_TAP);
  });

  it('a failed lifetime-count query shows no tip and releases the audio gates', async () => {
    // Regression (2026-08-18): the count was read with `useQuery`, which
    // THROWS a server error into render. `getLifetimeReviewCount` is three
    // indexed reads, but the 1s query budget is wall-clock, so a saturated
    // backend times it out, and the throw unwound past LearnView's
    // ViewErrorBoundary to app/error.tsx, blanking the whole app shell.
    // Now the error arrives as a value; with the user's progress unknown we
    // teach nothing, and critically must not leave `introPending` true,
    // which would gate card autoplay for the rest of the session waiting on
    // an intro that can never start.
    queryState.lifetimeReps = new Error('Function execution timed out');
    await loadHook();
    const view = renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();

    expect(lastConfig, 'no popover when the count is unknown').toBeNull();
    expect(view.result.current.isActive).toBe(false);
    expect(view.result.current.introPending).toBe(false);
    expect(completedIds(), 'a failure must not retire tips').toEqual([]);
  });

  it('veteran guard: a count far past the thresholds retires every unseen tip silently', async () => {
    queryState.lifetimeReps = 100;
    await loadHook();
    renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();

    expect(lastConfig, 'no popover for veterans').toBeNull();
    for (const id of [
      ...AUDIO_INTRO_IDS,
      ...FULL_ONLY_IDS,
      TUTORIAL_IDS.TIP_CARD_ACTIONS,
      TUTORIAL_IDS.TIP_CHAT,
      TUTORIAL_IDS.TIP_WORD_TAP,
      TUTORIAL_IDS.TIP_MODE_SWITCH,
      TUTORIAL_IDS.TIP_SETTINGS,
    ]) {
      expect(completedIds()).toContain(id);
    }
  });

  it('still fires under React StrictMode double-mount (dev), and audio gates release', async () => {
    // Regression: StrictMode's simulated unmount ran the unmount cleanup on
    // the same component instance, latching `unmountedRef` true forever,
    // no tip ever mounted, while `isActive` stayed stuck true, which froze
    // audio autoplay/auto-advance ("no tutorials + auto-advance broken").
    const { StrictMode } = await import('react');
    await loadHook();
    const view = renderHook(
      () => useMilestoneTips({ enabled: true, reviewMode: 'audio' }),
      {
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      },
    );
    await firePendingTip();

    expect(
      lastConfig,
      'intro must mount despite the double-mount',
    ).not.toBeNull();
    expect(view.result.current.isActive).toBe(true);

    await act(async () => {
      lastDriver!.closeFromUi();
    });
    expect(view.result.current.isActive).toBe(false);
    for (const id of AUDIO_INTRO_IDS) {
      expect(completedIds()).toContain(id);
    }
  });

  it('persists to the per-user localStorage key, never the device-level fallback', async () => {
    await loadHook();
    renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();
    await act(async () => {
      lastDriver!.closeFromUi();
    });

    expect(completedIds().length).toBeGreaterThan(0);
    expect(localStorage.getItem(DEVICE_LEVEL_KEY)).toBeNull();
    // And the Convex mutation carries it to userSettings (per user, cross
    // device).
    expect(completeMutation).toHaveBeenCalledWith({
      tutorialId: TUTORIAL_IDS.TIP_CONCEPT_CARD,
    });
  });

  it('disabling the host mid-intro hides without persisting, so it re-offers', async () => {
    await loadHook();
    const { rerender } = renderTips({ enabled: true, reviewMode: 'audio' });
    await firePendingTip();
    expect(lastConfig).not.toBeNull();

    await act(async () => {
      rerender({ enabled: false, reviewMode: 'audio' });
    });
    expect(completedIds()).toHaveLength(0);

    // Coming back re-offers the intro.
    lastConfig = null;
    await act(async () => {
      rerender({ enabled: true, reviewMode: 'audio' });
    });
    await firePendingTip();
    expect(lastConfig).not.toBeNull();
  });
});
