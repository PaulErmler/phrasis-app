'use client';

import { useEffect, useRef, useState } from 'react';

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

  useEffect(() => {
    if (!enabled || target === from) {
      setValue(target);
      return;
    }

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
        setValue(Math.round(from + eased * (target - from)));

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, from, durationMs, delay, enabled, easing]);

  return value;
}
