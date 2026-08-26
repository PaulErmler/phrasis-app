import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const useQueryMock = vi.fn();

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

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

import { useCachedQuery } from '@/hooks/use-cached-query';

describe('useCachedQuery', () => {
  beforeEach(() => {
    installLocalStorage();
    useQueryMock.mockReset();
  });

  it('returns live value when present', () => {
    useQueryMock.mockReturnValue({ hello: 'world' });
    const { result } = renderHook(() => useCachedQuery({} as any, {}, 'ck'));
    expect(result.current).toEqual({ hello: 'world' });
  });

  it('returns cached value when live is undefined', () => {
    localStorage.setItem('ck', JSON.stringify({ cached: true }));
    useQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() => useCachedQuery({} as any, {}, 'ck'));
    // Reads via useLayoutEffect
    expect(result.current).toEqual({ cached: true });
  });

  it('persists live value to localStorage when it changes', async () => {
    useQueryMock.mockReturnValue(undefined);
    const { rerender } = renderHook(() =>
      useCachedQuery({} as any, {}, 'persist'),
    );
    useQueryMock.mockReturnValue({ v: 1 });
    rerender();
    await Promise.resolve();
    const stored = localStorage.getItem('persist');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual({ v: 1 });
  });

  it('returns undefined when nothing cached and live undefined', () => {
    useQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() => useCachedQuery({} as any, {}, 'empty'));
    expect(result.current).toBeUndefined();
  });
});
