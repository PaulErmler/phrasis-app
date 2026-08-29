import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock';

describe('useScreenWakeLock', () => {
  beforeEach(() => {
    // @ts-expect-error test shim
    delete navigator.wakeLock;
  });

  it('no-ops when wakeLock API unavailable', () => {
    const { unmount } = renderHook(() => useScreenWakeLock(true));
    expect(() => unmount()).not.toThrow();
  });

  it('requests wake lock when enabled and API is available', async () => {
    const released = vi.fn();
    const sentinel = {
      released: false,
      release: released,
      addEventListener: vi.fn(),
    };
    const request = vi.fn().mockResolvedValue(sentinel);
    // @ts-expect-error test shim
    navigator.wakeLock = { request };

    const { unmount } = renderHook(() => useScreenWakeLock(true));
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith('screen');
    unmount();
  });

  it('does not request when enabled is false', () => {
    const request = vi.fn();
    // @ts-expect-error test shim
    navigator.wakeLock = { request };
    renderHook(() => useScreenWakeLock(false));
    expect(request).not.toHaveBeenCalled();
  });
});
