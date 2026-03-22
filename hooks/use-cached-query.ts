import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useQuery } from 'convex/react';
import type { FunctionReference, FunctionArgs, FunctionReturnType } from 'convex/server';

const useBrowserLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useCachedQuery<F extends FunctionReference<'query'>>(
  query: F,
  args: FunctionArgs<F> | 'skip',
  cacheKey: string,
): FunctionReturnType<F> | undefined {
  const live = useQuery(query, args);
  const [cached, setCached] = useState<FunctionReturnType<F> | undefined>(
    undefined,
  );

  // Deferred to a layout effect (not useState initializer) so server and
  // client produce the same initial HTML, avoiding hydration mismatches.
  // useLayoutEffect fires synchronously before paint, so the user never
  // sees the intermediate undefined state.
  useBrowserLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(cacheKey);
      if (stored) setCached(JSON.parse(stored));
    } catch {
      // ignore parse errors from stale/corrupted cache
    }
  }, [cacheKey]);

  const prevLive = useRef(live);
  useEffect(() => {
    if (live !== undefined && live !== prevLive.current) {
      prevLive.current = live;
      setCached(live);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(live));
      } catch {
        // ignore storage errors
      }
    }
  }, [live, cacheKey]);

  return live ?? cached;
}
