import {useState, useEffect, useRef } from 'react';
import { useBrowserLayoutEffect } from '@/hooks/use-isomorphic-layout-effect';
import { useQuery } from 'convex/react';
import type { FunctionReference, FunctionArgs, FunctionReturnType } from 'convex/server';

export function useCachedQuery<F extends FunctionReference<'query'>>(
  query: F,
  args: FunctionArgs<F> | 'skip',
  cacheKey: string,
  // Applied to localStorage payloads only — live results are shape-guaranteed
  // by the query's `returns` validator, but a cached payload can predate a
  // deploy that changed the shape. Rejected payloads are treated as absent.
  validate?: (value: unknown) => boolean,
): FunctionReturnType<F> | undefined {
  const live = useQuery(query, args);
  const [cached, setCached] = useState<FunctionReturnType<F> | undefined>(
    undefined,
  );

  // Ref so the mount-time effect below always sees the current validator
  // without needing it (a possibly per-render function) in its deps.
  const validateRef = useRef(validate);
  validateRef.current = validate;

  // Deferred to a layout effect (not useState initializer) so server and
  // client produce the same initial HTML, avoiding hydration mismatches.
  // useLayoutEffect fires synchronously before paint, so the user never
  // sees the intermediate undefined state.
  useBrowserLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(cacheKey);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (validateRef.current && !validateRef.current(parsed)) return;
      setCached(parsed);
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
