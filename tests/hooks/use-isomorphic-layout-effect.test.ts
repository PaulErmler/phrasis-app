import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEffect, useLayoutEffect } from 'react';
import { useBrowserLayoutEffect } from '@/hooks/use-isomorphic-layout-effect';

/**
 * The hook is a compile-time pick between the two React effects, so the
 * contract is identity: layout effect in the browser (no pre-paint flash),
 * plain effect on the server (no SSR warning).
 */
describe('useBrowserLayoutEffect', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('is useLayoutEffect in the browser (jsdom)', () => {
    expect(useBrowserLayoutEffect).toBe(useLayoutEffect);
  });

  it('falls back to useEffect when window is absent (SSR)', async () => {
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    const fresh = await import('@/hooks/use-isomorphic-layout-effect');
    expect(fresh.useBrowserLayoutEffect).toBe(useEffect);
    expect(fresh.useBrowserLayoutEffect).not.toBe(useLayoutEffect);
  });
});
