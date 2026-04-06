'use client';

import { useEffect, useRef, useState } from 'react';

type SnapshotData = Record<string, number>;

interface UseStatsSnapshotOptions {
  /** Ms before saving snapshot to localStorage (default: 2500) */
  settleDuration?: number;
  /** When true, snapshot resets at the start of each day (default: false) */
  dateScoped?: boolean;
}

/**
 * Tracks numeric values against a localStorage snapshot for delta animation.
 * Reads the previous snapshot synchronously on mount, compares to current values,
 * and saves the current values after a settle timeout.
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

  // Read snapshot from localStorage synchronously on first render
  const [initialSnap] = useState<SnapshotData>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (dateScoped && parsed.__date !== today) return {};
        const { __date: _, ...rest } = parsed;
        return rest;
      }
    } catch { /* ignore */ }
    return {};
  });

  const prevRef = useRef<SnapshotData>(initialSnap);

  // Detect if any tracked value has changed from the snapshot
  const changed = Object.keys(values).some(
    (k) => values[k] !== (prevRef.current[k] ?? 0),
  );

  // After settling, update the ref and persist to localStorage
  const [, setSettledEpoch] = useState(0);
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
      setSettledEpoch((e) => e + 1);
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
