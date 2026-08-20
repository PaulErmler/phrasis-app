import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { AppUpdateGate, useReloadBlock } from '@/components/app/AppUpdateGate';

/**
 * AppUpdateGate is the only thing that gets a long-lived /app session off a
 * stale bundle, and it does so by reloading the page out from under the user,
 * so both directions are costly. Reloading too eagerly destroys an in-progress
 * review, a half-typed card, or a streaming chat response (all of which live in
 * component state only). Not reloading at all leaves an installed PWA running
 * week-old JS against a moved-on Convex backend.
 *
 * The cases below pin the four conditions that gate the silent reload. A real
 * mismatch, a long enough absence, no registered blocker, and no recent failed
 * attempt, plus the escalation and chunk-error fallbacks.
 */

const reloadMock = vi.fn();
const toastInfoMock = vi.fn();

vi.mock('sonner', () => ({
  toast: { info: (...args: unknown[]) => toastInfoMock(...args) },
}));

const NOW = new Date('2026-07-27T12:00:00Z').getTime();
const MINUTE = 60_000;

/** Matches the component's own defaults (no dev overrides set under vitest). */
const HIDDEN_LONG_ENOUGH_MS = 10 * MINUTE;
const ESCALATE_AFTER_MS = 60 * MINUTE;

/** What the bundle compiles to when NEXT_PUBLIC_BUILD_ID is unset. */
const CURRENT_BUILD = 'dev';
const NEWER_BUILD = 'newer-build';

function mockVersionResponse(buildId: string) {
  return {
    ok: true,
    json: async () => ({ buildId }),
  } as unknown as Response;
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Renders, then flushes the mount-time version check. */
async function renderGate(children?: React.ReactNode) {
  const result = render(<AppUpdateGate>{children}</AppUpdateGate>);
  await act(async () => {});
  return result;
}

/** Hides the tab, waits `awayMs`, and brings it back. */
async function goAwayAndReturn(awayMs: number) {
  await act(async () => {
    setVisibility('hidden');
  });
  await act(async () => {
    vi.setSystemTime(Date.now() + awayMs);
    setVisibility('visible');
  });
}

function Blocker({ active }: { active: boolean }) {
  useReloadBlock(active);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  reloadMock.mockClear();
  toastInfoMock.mockClear();
  sessionStorage.clear();
  setVisibility('visible');

  // jsdom's Location methods are non-configurable, so the whole object has to
  // be swapped rather than the reload method spied on.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, reload: reloadMock },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AppUpdateGate', () => {
  it('does nothing while the deployed build matches the running one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(CURRENT_BUILD)),
    );

    await renderGate();
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);
    await act(async () => {
      vi.advanceTimersByTime(ESCALATE_AFTER_MS + MINUTE);
    });

    expect(reloadMock).not.toHaveBeenCalled();
    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it('reloads silently when a long-hidden tab returns to a newer build', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    await renderGate();
    // The mount-time check finds the update but must not act on it. The user
    // is right there, looking at the page.
    expect(reloadMock).not.toHaveBeenCalled();

    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it('does not reload when the tab was only away briefly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    await renderGate();
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS - MINUTE);

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('does not reload while something is registered as in flight', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    await renderGate(<Blocker active />);
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('reloads once the blocker clears and the tab goes away again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    const { rerender } = await renderGate(<Blocker active />);
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);
    expect(reloadMock).not.toHaveBeenCalled();

    await act(async () => {
      rerender(
        <AppUpdateGate>
          <Blocker active={false} />
        </AppUpdateGate>,
      );
    });
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a toast once the update has gone unclaimed long enough', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    await renderGate();
    expect(toastInfoMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(ESCALATE_AFTER_MS);
    });

    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    expect(toastInfoMock.mock.calls[0][1]).toMatchObject({
      id: 'app-update',
      duration: Infinity,
    });
  });

  it('does not resurrect the toast on later re-renders', async () => {
    // The gate sits near the root, so it re-renders often. A dismissed toast
    // must stay dismissed.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    const { rerender } = await renderGate();
    await act(async () => {
      vi.advanceTimersByTime(ESCALATE_AFTER_MS);
    });
    expect(toastInfoMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(<AppUpdateGate>{null}</AppUpdateGate>);
      vi.advanceTimersByTime(ESCALATE_AFTER_MS);
    });

    expect(toastInfoMock).toHaveBeenCalledTimes(1);
  });

  it('fails open when the version endpoint is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await renderGate();
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);
    await act(async () => {
      vi.advanceTimersByTime(ESCALATE_AFTER_MS + MINUTE);
    });

    expect(reloadMock).not.toHaveBeenCalled();
    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it('fails open on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response),
    );

    await renderGate();
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it('stops auto-reloading if an attempt at the same build did not stick', async () => {
    // Simulates coming back from a reload still running the old bundle. The
    // signal that something upstream is serving a stale document. Reloading
    // again would loop, and no amount of elapsed time makes a retry sensible,
    // so the guard is one-shot per build rather than time-windowed.
    sessionStorage.setItem('app-update:reload-attempt', NEWER_BUILD);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    await renderGate();
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);
    expect(reloadMock).not.toHaveBeenCalled();

    // Long enough later that any plausible cooldown would have lapsed.
    await goAwayAndReturn(6 * 60 * MINUTE);
    expect(reloadMock).not.toHaveBeenCalled();

    // ...and escalates to the toast instead, so the user is not left stranded.
    await act(async () => {
      vi.advanceTimersByTime(ESCALATE_AFTER_MS);
    });
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
  });

  it('reloads for a different build even after one attempt did not stick', async () => {
    sessionStorage.setItem('app-update:reload-attempt', 'some-older-build');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(NEWER_BUILD)),
    );

    await renderGate();
    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('checks again when connectivity returns, without reloading the visible tab', async () => {
    // Mount happens offline, so the gate learns nothing. Coming back online is
    // the retry signal, but the user never left, so hiddenForMs is 0 and the
    // update may only arm the toast, never yank the page.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(mockVersionResponse(NEWER_BUILD));
    vi.stubGlobal('fetch', fetchMock);

    await renderGate();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reloadMock).not.toHaveBeenCalled();

    // The update found via the online check still escalates on schedule.
    await act(async () => {
      vi.advanceTimersByTime(ESCALATE_AFTER_MS);
    });
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('goes fully quiet after unmount', async () => {
    // The gate wraps the /app shell, which can unmount on sign-out. Its
    // document/window listeners and the escalation timer must die with it.
    // A reload or toast fired by a dead gate would hit whatever replaced it.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockVersionResponse(NEWER_BUILD));
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = await renderGate();
    const checksWhileMounted = fetchMock.mock.calls.length;

    unmount();

    await goAwayAndReturn(HIDDEN_LONG_ENOUGH_MS);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(ESCALATE_AFTER_MS + MINUTE);
    });

    expect(fetchMock.mock.calls.length).toBe(checksWhileMounted);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it('recovers from a chunk load failure exactly once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(CURRENT_BUILD)),
    );

    await renderGate();

    const fire = () => {
      const event = new Event('unhandledrejection') as PromiseRejectionEvent;
      Object.defineProperty(event, 'reason', {
        value: new Error('ChunkLoadError: Loading chunk 42 failed'),
      });
      window.dispatchEvent(event);
    };

    await act(async () => fire());
    expect(reloadMock).toHaveBeenCalledTimes(1);

    // A genuinely broken asset must surface as an error, not a reload loop.
    await act(async () => fire());
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated runtime errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockVersionResponse(CURRENT_BUILD)),
    );

    await renderGate();

    await act(async () => {
      const event = new Event('unhandledrejection') as PromiseRejectionEvent;
      Object.defineProperty(event, 'reason', {
        value: new Error('Convex query failed'),
      });
      window.dispatchEvent(event);
    });

    expect(reloadMock).not.toHaveBeenCalled();
  });
});
