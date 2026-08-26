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
  // Convex returns a fresh payload identity on every re-subscription (e.g.
  // a minute-quantized `now` arg) even when the content is unchanged, so
  // remember what was last written and skip byte-identical writes — the
  // forecast payload is the largest thing going through this hook.
  const lastWritten = useRef<{ key: string; json: string } | null>(null);
  useEffect(() => {
    if (live !== undefined && live !== prevLive.current) {
      prevLive.current = live;
      setCached(live);
      try {
        const json = JSON.stringify(live);
        if (
          lastWritten.current?.key !== cacheKey ||
          lastWritten.current.json !== json
        ) {
          lastWritten.current = { key: cacheKey, json };
          localStorage.setItem(cacheKey, json);
        }
      } catch {
        // ignore storage errors
      }
    }
  }, [live, cacheKey]);

  return live ?? cached;
}
