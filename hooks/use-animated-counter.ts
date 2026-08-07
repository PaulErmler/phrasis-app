'use client';

import { useRef, useState } from 'react';
import { useBrowserLayoutEffect } from '@/hooks/use-isomorphic-layout-effect';

export type CounterEasing = 'easeOut' | 'linear' | ((t: number) => number);

const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);
const LINEAR = (t: number) => t;

/**
 * Animate a number from `from` to `target` over `durationMs`.
 *
 * `easing` defaults to `'easeOut'` (cubic) for a satisfying "fast-then-settle"
 * feel — good for solo counters and for supporting cells that should settle
 * early. Use `'linear'` when integer ticks must land uniformly across the
 * full duration: ease-out compresses most value change into the first half,
 * so a small-target counter hits its final integer at ~54 % and sits idle.
 */
export function useAnimatedCounter(
  target: number,
  from = 0,
  durationMs = 1500,
  delay = 0,
  enabled = true,
  easing: CounterEasing = 'easeOut',
): number {
  const [value, setValue] = useState(enabled ? from : target);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  // Where the sweep currently sits, so a re-run (live `target` update while
  // home is open) continues from the displayed value instead of snapping
  // back to `from` and holding there for `delay` ms.
  const valueRef = useRef(value);
  const hasRunRef = useRef(false);
  const prevFromRef = useRef(from);

  // Layout effect (not passive) so a `from` that only becomes known after
  // mount — e.g. a localStorage snapshot read in another layout effect —
  // is painted as the animation's starting value rather than flashing the
  // mount-time value for `delay` ms first.
  useBrowserLayoutEffect(() => {
    if (!enabled || target === from) {
      valueRef.current = target;
      setValue(target);
      return;
    }

    // A fresh animation starts at `from` after `delay`; that covers the
    // first run and any run where `from` itself changed (the late-known
    // snapshot case above). Everything else — typically `target` moving
    // because live stats landed mid-sweep — continues from the currently
    // displayed value with no delay, so the counter never visibly resets.
    const isFresh = !hasRunRef.current || from !== prevFromRef.current;
    hasRunRef.current = true;
    prevFromRef.current = from;
    const start = isFresh ? from : valueRef.current;
    const effectiveDelay = isFresh ? delay : 0;

    // Park on the start value until the (possibly zero-)delayed sweep
    // takes over.
    valueRef.current = start;
    setValue(start);

    const easeFn =
      typeof easing === 'function'
        ? easing
        : easing === 'linear'
          ? LINEAR
          : EASE_OUT_CUBIC;

    const timeout = setTimeout(() => {
      startTimeRef.current = null;

      const animate = (timestamp: number) => {
        if (startTimeRef.current === null) startTimeRef.current = timestamp;
        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / durationMs, 1);
        const eased = easeFn(progress);
        const next = Math.round(start + eased * (target - start));
        valueRef.current = next;
        setValue(next);

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    }, effectiveDelay);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, from, durationMs, delay, enabled, easing]);

  return value;
}
