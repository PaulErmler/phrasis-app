import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const isNativeAppMock = vi.fn<() => boolean>();

vi.mock('@/lib/native', () => ({
  isNativeApp: () => isNativeAppMock(),
}));

import { useIsNativeApp } from '@/hooks/use-native-app';

/**
 * SSR-safe wrapper around `isNativeApp()`. Store-policy surfaces (pricing,
 * checkout, install CTAs) hide when this is true, so it must faithfully
 * reflect the detector on the client.
 */
describe('useIsNativeApp', () => {
  beforeEach(() => {
    isNativeAppMock.mockReset();
  });

  it('is true inside the Capacitor store shell', () => {
    isNativeAppMock.mockReturnValue(true);
    const { result } = renderHook(() => useIsNativeApp());
    expect(result.current).toBe(true);
  });

  it('is false in the plain web app', () => {
    isNativeAppMock.mockReturnValue(false);
    const { result } = renderHook(() => useIsNativeApp());
    expect(result.current).toBe(false);
  });
});
