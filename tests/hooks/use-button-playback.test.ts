import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useButtonPlayback } from '@/hooks/use-button-playback';

describe('useButtonPlayback', () => {
  it('starts with no active clip', () => {
    const { result } = renderHook(() => useButtonPlayback());
    expect(result.current.active).toBeNull();
  });

  it('sets active on onTimeUpdate', () => {
    const { result } = renderHook(() => useButtonPlayback());
    act(() => result.current.onTimeUpdate('en', 1.2));
    expect(result.current.active).toEqual({ language: 'en', localTime: 1.2 });
  });

  it('updates localTime on subsequent onTimeUpdate for the same language', () => {
    const { result } = renderHook(() => useButtonPlayback());
    act(() => result.current.onTimeUpdate('en', 1.2));
    act(() => result.current.onTimeUpdate('en', 1.5));
    expect(result.current.active).toEqual({ language: 'en', localTime: 1.5 });
  });

  it('replaces active when a different language broadcasts (mutual exclusion)', () => {
    const { result } = renderHook(() => useButtonPlayback());
    act(() => result.current.onTimeUpdate('en', 1.2));
    act(() => result.current.onTimeUpdate('es', 0.1));
    expect(result.current.active).toEqual({ language: 'es', localTime: 0.1 });
  });

  it('clears active when onStop matches the active language', () => {
    const { result } = renderHook(() => useButtonPlayback());
    act(() => result.current.onTimeUpdate('en', 1.2));
    act(() => result.current.onStop('en'));
    expect(result.current.active).toBeNull();
  });

  it('leaves active untouched when onStop is for a different language', () => {
    const { result } = renderHook(() => useButtonPlayback());
    act(() => result.current.onTimeUpdate('en', 1.2));
    act(() => result.current.onStop('es'));
    expect(result.current.active).toEqual({ language: 'en', localTime: 1.2 });
  });

  it('exposes stable callback identities across renders', () => {
    const { result, rerender } = renderHook(() => useButtonPlayback());
    const firstUpdate = result.current.onTimeUpdate;
    const firstStop = result.current.onStop;
    rerender();
    expect(result.current.onTimeUpdate).toBe(firstUpdate);
    expect(result.current.onStop).toBe(firstStop);
    // Callback identity should also survive a state change.
    act(() => result.current.onTimeUpdate('en', 0.5));
    expect(result.current.onTimeUpdate).toBe(firstUpdate);
    expect(result.current.onStop).toBe(firstStop);
  });
});
