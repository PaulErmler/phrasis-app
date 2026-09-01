import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PixelModule = typeof import('@/lib/openai-pixel');

/**
 * The pixel id is read into a module constant at import time, so every case
 * that needs a different configuration re-imports a fresh module.
 */
async function load(pixelId: string | undefined): Promise<PixelModule> {
  vi.resetModules();
  if (pixelId === undefined) vi.stubEnv('NEXT_PUBLIC_OPENAI_PIXEL_ID', '');
  else vi.stubEnv('NEXT_PUBLIC_OPENAI_PIXEL_ID', pixelId);
  return import('@/lib/openai-pixel');
}

/** The buffered commands as plain arrays, oldest first. */
function queued(): unknown[][] {
  return (window.oaiq?.q ?? []).map((args) => Array.from(args));
}

function scriptTags(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll('script'));
}

describe('openai-pixel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.oaiq;
    document.head.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('is a no-op in a build without a pixel id', async () => {
    const pixel = await load(undefined);
    pixel.loadOpenAIPixel();
    pixel.syncOpenAIPixelConsent(true);
    expect(pixel.isOpenAIPixelLoaded()).toBe(false);
    expect(window.oaiq).toBeUndefined();
    expect(scriptTags()).toHaveLength(0);
    expect(
      pixel.measureConversion('registration_completed', {
        type: 'customer_action',
      }),
    ).toBe(false);
  });

  it('grants consent before init and injects the SDK once', async () => {
    const pixel = await load('pix_test');
    pixel.syncOpenAIPixelConsent(true);
    pixel.syncOpenAIPixelConsent(true);

    expect(pixel.isOpenAIPixelLoaded()).toBe(true);
    const commands = queued();
    expect(commands[0]).toEqual(['consent', true]);
    expect(commands[1]?.[0]).toBe('init');
    expect(commands[1]?.[1]).toMatchObject({ pixelId: 'pix_test' });
    // Second grant re-affirms consent to an already-loaded SDK, no re-init.
    expect(commands[2]).toEqual(['consent', true]);
    expect(commands.filter((c) => c[0] === 'init')).toHaveLength(1);

    const scripts = scriptTags();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(pixel.OPENAI_PIXEL_SDK_URL);
    expect(scripts[0].async).toBe(true);
  });

  it('measures only after load and forwards the event_id option', async () => {
    const pixel = await load('pix_test');
    expect(
      pixel.measureConversion('subscription_created', {
        type: 'plan_enrollment',
        plan_id: 'pro',
      }),
    ).toBe(false);

    pixel.loadOpenAIPixel();
    const sent = pixel.measureConversion(
      'subscription_created',
      { type: 'plan_enrollment', plan_id: 'pro' },
      { event_id: 'subscription:u1:pro' },
    );
    expect(sent).toBe(true);
    expect(queued().at(-1)).toEqual([
      'measure',
      'subscription_created',
      { type: 'plan_enrollment', plan_id: 'pro' },
      { event_id: 'subscription:u1:pro' },
    ]);
  });

  it('deny before any load writes nothing', async () => {
    const pixel = await load('pix_test');
    pixel.syncOpenAIPixelConsent(false);
    expect(window.oaiq).toBeUndefined();
    expect(window.localStorage.length).toBe(0);
  });

  it('deny after load tells the SDK and sweeps this module’s storage', async () => {
    const pixel = await load('pix_test');
    pixel.loadOpenAIPixel();
    pixel.markFired('registration:u1');
    pixel.markCheckoutStarted('pro');
    window.localStorage.setItem('unrelated', 'keep');

    pixel.syncOpenAIPixelConsent(false);

    expect(queued().at(-1)).toEqual(['consent', false]);
    expect(pixel.hasFired('registration:u1')).toBe(false);
    expect(pixel.readCheckoutMarker()).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('keep');
  });

  it('dedupes fired event ids and bounds the list', async () => {
    const pixel = await load('pix_test');
    expect(pixel.hasFired('a')).toBe(false);
    pixel.markFired('a');
    pixel.markFired('a');
    expect(pixel.hasFired('a')).toBe(true);
    for (let i = 0; i < 30; i++) pixel.markFired(`evt-${i}`);
    // The oldest entry ages out; the newest stays.
    expect(pixel.hasFired('a')).toBe(false);
    expect(pixel.hasFired('evt-29')).toBe(true);
  });

  it('checkout marker: only after load, round-trips, expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    const pixel = await load('pix_test');

    // Before consent nothing may be written to the device.
    pixel.markCheckoutStarted('pro');
    expect(pixel.readCheckoutMarker()).toBeNull();

    pixel.loadOpenAIPixel();
    pixel.markCheckoutStarted('pro');
    expect(pixel.readCheckoutMarker()).toBe('pro');

    vi.advanceTimersByTime(pixel.CHECKOUT_MARKER_TTL_MS + 1);
    expect(pixel.readCheckoutMarker()).toBeNull();

    pixel.markCheckoutStarted('basic');
    pixel.clearCheckoutMarker();
    expect(pixel.readCheckoutMarker()).toBeNull();
  });
});
