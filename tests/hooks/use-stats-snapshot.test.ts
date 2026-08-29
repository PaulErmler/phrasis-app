import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Install a clean in-memory localStorage shim BEFORE importing the hook
function installLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: ls,
  });
  return ls;
}

import { useStatsSnapshot } from '@/hooks/use-stats-snapshot';

describe('useStatsSnapshot', () => {
  beforeEach(() => {
    installLocalStorage();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zero prev values on first render with no storage', () => {
    const { result } = renderHook(() =>
      useStatsSnapshot('k', { reviews: 5, streak: 3 }),
    );
    expect(result.current.prev).toEqual({ reviews: 0, streak: 0 });
    expect(result.current.changed).toBe(true);
  });

  it('loads previous snapshot from localStorage', () => {
    localStorage.setItem('k', JSON.stringify({ reviews: 2, streak: 1 }));
    const { result } = renderHook(() =>
      useStatsSnapshot('k', { reviews: 5, streak: 1 }),
    );
    expect(result.current.prev).toEqual({ reviews: 2, streak: 1 });
    expect(result.current.changed).toBe(true);
  });

  it('reports no change when values match snapshot', () => {
    localStorage.setItem('k', JSON.stringify({ a: 3 }));
    const { result } = renderHook(() => useStatsSnapshot('k', { a: 3 }));
    expect(result.current.changed).toBe(false);
  });

  it('persists values to localStorage after settle', () => {
    const { rerender } = renderHook(
      ({ v }) => useStatsSnapshot('mystat', v, { settleDuration: 100 }),
      { initialProps: { v: { a: 1 } } },
    );
    rerender({ v: { a: 2 } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const stored = JSON.parse(localStorage.getItem('mystat') ?? '{}');
    expect(stored.a).toBe(2);
  });

  it('honors dateScoped, ignores stale date', () => {
    localStorage.setItem(
      'k',
      JSON.stringify({ __date: '2000-01-01', reviews: 10 }),
    );
    const { result } = renderHook(() =>
      useStatsSnapshot('k', { reviews: 3 }, { dateScoped: true }),
    );
    expect(result.current.prev).toEqual({ reviews: 0 });
  });

  it('dateScoped, stale multi-period snapshot zeroes all keys (NumbersRow shape)', () => {
    // Mirrors the stats-page `statsPage_periods` snapshot crossing a day
    // boundary: yesterday's day/week totals must not become the animation's
    // "from" value.
    localStorage.setItem(
      'statsPage_periods',
      JSON.stringify({ __date: '2000-01-01', dayReps: 99, weekReps: 50 }),
    );
    const { result } = renderHook(() =>
      useStatsSnapshot(
        'statsPage_periods',
        { dayReps: 3, weekReps: 12 },
        { dateScoped: true },
      ),
    );
    expect(result.current.prev).toEqual({ dayReps: 0, weekReps: 0 });
  });

  it('does not persist when all values are zero', () => {
    const { rerender } = renderHook(
      ({ v }) => useStatsSnapshot('zero', v, { settleDuration: 50 }),
      { initialProps: { v: { a: 0 } } },
    );
    rerender({ v: { a: 0 } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(localStorage.getItem('zero')).toBeNull();
  });
});
