import { describe, expect, it } from 'vitest';

/**
 * `lib/posthog/hosts.ts` reads `NEXT_PUBLIC_POSTHOG_HOST` at module scope, so
 * each case re-imports with a fresh module registry rather than mutating a
 * cached binding.
 */
async function loadHosts(host?: string) {
  const previous = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (host === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
  else process.env.NEXT_PUBLIC_POSTHOG_HOST = host;

  const { resetModules } = await import('vitest').then((m) => ({
    resetModules: m.vi.resetModules,
  }));
  resetModules();
  const mod = await import('@/lib/posthog/hosts');

  if (previous === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
  else process.env.NEXT_PUBLIC_POSTHOG_HOST = previous;
  return mod;
}

describe('posthog hosts', () => {
  it('defaults to EU cloud', async () => {
    const { POSTHOG_INGEST_HOST } = await loadHosts(undefined);
    expect(POSTHOG_INGEST_HOST).toBe('https://eu.i.posthog.com');
  });

  it('derives the assets origin from the ingest origin', async () => {
    const { POSTHOG_ASSETS_HOST } = await loadHosts('https://eu.i.posthog.com');
    expect(POSTHOG_ASSETS_HOST).toBe('https://eu-assets.i.posthog.com');
  });

  it('derives the assets origin for the US region too', async () => {
    const { POSTHOG_ASSETS_HOST } = await loadHosts('https://us.i.posthog.com');
    expect(POSTHOG_ASSETS_HOST).toBe('https://us-assets.i.posthog.com');
  });

  it('leaves a self-hosted origin untouched rather than mangling it', async () => {
    const { POSTHOG_ASSETS_HOST } = await loadHosts('https://ph.example.com');
    expect(POSTHOG_ASSETS_HOST).toBe('https://ph.example.com');
  });

  it('points the UI host at the app origin, not the ingest origin', async () => {
    const { POSTHOG_UI_HOST } = await loadHosts('https://eu.i.posthog.com');
    expect(POSTHOG_UI_HOST).toBe('https://eu.posthog.com');
  });

  it('serves events from a first-party path an ad blocker will not match', async () => {
    const { POSTHOG_API_HOST, POSTHOG_PROXY_PATH } = await loadHosts(undefined);
    expect(POSTHOG_API_HOST).toBe(POSTHOG_PROXY_PATH);
    expect(POSTHOG_PROXY_PATH).not.toMatch(/analytics|track|telemetry|posthog/i);
  });
});
