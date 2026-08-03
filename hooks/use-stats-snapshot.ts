'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const useBrowserLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type SnapshotData = Record<string, number>;

interface UseStatsSnapshotOptions {
  /** Ms before saving snapshot to localStorage (default: 2500) */
  settleDuration?: number;
  /** When true, snapshot resets at the start of each day (default: false) */
  dateScoped?: boolean;
}

/**
 * Tracks numeric values against a localStorage snapshot for delta animation.
 * Reads the previous snapshot before the first paint, compares to current
 * values, and saves the current values after a settle timeout.
 *
 * Used by both ProgressStatsCard (homescreen) and NumbersRow (stats page) to
 * animate only the delta since the user last saw the values.
 */
export function useStatsSnapshot(
  storageKey: string,
  values: SnapshotData,
  options?: UseStatsSnapshotOptions,
) {
  const { settleDuration = 2500, dateScoped = false } = options ?? {};

  const today = dateScoped
    ? new Intl.DateTimeFormat('en-CA', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).format(new Date())
    : null;

  // Starts empty on both server and client so the first client render
  // reproduces the server HTML exactly — reading localStorage in a useState
  // initializer would make the SSR pass (no snapshot) and hydration pass
  // (snapshot present) disagree, and every counter/ring seeded from `prev`
  // would render a different number. The read is deferred to a layout
  // effect instead: it fires synchronously before paint, so the snapshot is
  // in place for the first frame the user actually sees. Same trick as
  // hooks/use-cached-query.ts.
  const prevRef = useRef<SnapshotData>({});
  const [, bumpEpoch] = useState(0);
  const hydratedKeyRef = useRef<string | null>(null);

  useBrowserLayoutEffect(() => {
    if (hydratedKeyRef.current === storageKey) return;
    hydratedKeyRef.current = storageKey;
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (dateScoped && parsed.__date !== today) return;
      const { __date: _, ...rest } = parsed;
      prevRef.current = rest;
      bumpEpoch((e) => e + 1);
    } catch { /* ignore */ }
  }, [storageKey, dateScoped, today]);

  // Detect if any tracked value has changed from the snapshot
  const changed = Object.keys(values).some(
    (k) => values[k] !== (prevRef.current[k] ?? 0),
  );

  const valuesJson = JSON.stringify(values);

  useEffect(() => {
    const vals: SnapshotData = JSON.parse(valuesJson);
    const hasNonZero = Object.values(vals).some((v) => v > 0);
    if (!changed || !hasNonZero) return;

    const timer = setTimeout(() => {
      prevRef.current = vals;
      try {
        const toStore = dateScoped ? { __date: today, ...vals } : vals;
        localStorage.setItem(storageKey, JSON.stringify(toStore));
      } catch { /* ignore */ }
      bumpEpoch((e) => e + 1);
    }, settleDuration);

    return () => clearTimeout(timer);
     
  }, [valuesJson, changed, storageKey, settleDuration, dateScoped, today]);

  // Return prev values keyed the same as input (default 0 for missing keys)
  const prev: SnapshotData = {};
  for (const k of Object.keys(values)) {
    prev[k] = prevRef.current[k] ?? 0;
  }

  return { prev, changed };
}
