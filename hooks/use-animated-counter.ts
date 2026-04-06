'use client';

import { useEffect, useRef, useState } from 'react';

export function useAnimatedCounter(
  target: number,
  from = 0,
  durationMs = 1500,
  delay = 0,
  enabled = true,
): number {
  const [value, setValue] = useState(enabled ? from : target);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || target === from) {
      setValue(target);
      return;
    }

    const timeout = setTimeout(() => {
      startTimeRef.current = null;

      const animate = (timestamp: number) => {
        if (startTimeRef.current === null) startTimeRef.current = timestamp;
        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
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
  }, [target, from, durationMs, delay, enabled]);

  return value;
}
