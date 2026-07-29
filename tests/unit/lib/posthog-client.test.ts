import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Locks the load-bearing `posthog.init` options. Each of these flags encodes a
 * decision that is invisible at runtime when it regresses:
 *
 * - `opt_out_capturing_by_default` — without it the SDK silently drops every
 *   event while the banner is unanswered (pending ≠ rejected to the SDK).
 * - `cookieless_mode: 'on_reject'` — decliners stay measurable without storage.
 * - `autocapture: false` / `capture_heatmaps: false` — the cost decisions.
 * - `person_profiles: 'identified_only'` — anonymous traffic gets no profile.
 *
 * `lib/posthog/hosts.ts` reads the env at module scope and `client.ts` keeps
 * an `initialized` flag, so each case re-imports with a fresh module registry.
 */

const initMock = vi.hoisted(() => vi.fn());

vi.mock('posthog-js', () => ({
  default: { init: initMock },
}));

async function loadClient(key?: string) {
  if (key === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  else process.env.NEXT_PUBLIC_POSTHOG_KEY = key;
  vi.resetModules();
  return import('@/lib/posthog/client');
}

const previousKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  else process.env.NEXT_PUBLIC_POSTHOG_KEY = previousKey;
  initMock.mockClear();
});

describe('initPostHogClient', () => {
  it('does not init without a project key', async () => {
    const { initPostHogClient, isPostHogReady } = await loadClient(undefined);
    initPostHogClient();
    expect(initMock).not.toHaveBeenCalled();
    expect(isPostHogReady()).toBe(false);
  });

  it('inits once with the consent and cost flags this integration depends on', async () => {
    const { initPostHogClient, isPostHogReady } = await loadClient('phc_test');
    initPostHogClient();
    initPostHogClient();

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(isPostHogReady()).toBe(true);

    const [key, options] = initMock.mock.calls[0];
    expect(key).toBe('phc_test');
    expect(options).toMatchObject({
      api_host: '/ph-relay',
      cookieless_mode: 'on_reject',
      // Pending (banner unanswered) captures cookieless instead of dropping.
      opt_out_capturing_by_default: true,
      person_profiles: 'identified_only',
      autocapture: false,
      capture_heatmaps: false,
      capture_exceptions: true,
      capture_pageview: 'history_change',
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '[data-ph-mask]',
        blockSelector: '[data-ph-block]',
      },
    });
  });
});
