'use client';

import { useMemo } from 'react';
import { motion } from 'motion/react';

/**
 * Radial confetti burst with a "mixed" piece set (rect / circle / streamer).
 * Mounts as an absolutely-positioned overlay anchored to its parent. The
 * pieces fan outward from the top-center and fade as they travel.
 *
 * Used both on the in-session celebration (`ProgressDisplay`) and on the
 * onboarding first-lesson intro. Lift here when adding another consumer.
 */

const CONFETTI_COLORS = ['var(--primary)', 'var(--accent-orange)', '#fbbf24'];
const BURST_EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

// Deterministic pseudo-random helpers keyed by piece index, so the burst
// looks scattered without using Math.random (which would break SSR).
const r1 = (i: number) => (((i * 7919) % 100) / 100 - 0.5) * 2; // -1..1
const r2 = (i: number) => ((i * 6151) % 100) / 100; // 0..1

function mixedShape(i: number): React.CSSProperties {
  // Cycle through rect / circle / streamer so the burst reads as varied.
  if (i % 3 === 0) return { width: 7, height: 9 };
  if (i % 3 === 1) return { width: 6, height: 6, borderRadius: 999 };
  return { width: 3, height: 14 };
}

export function ConfettiBurst({ count = 28 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + r1(i) * 0.2;
        const dist = 90 + r2(i) * 70;
        return {
          index: i,
          color: CONFETTI_COLORS[i % 3],
          delay: r2(i) * 0.08,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist + 60,
          rotate: r1(i) * 360,
        };
      }),
    [count],
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
      {pieces.map((p) => (
        <motion.span
          key={p.index}
          className="absolute block rounded-sm"
          style={{ ...mixedShape(p.index), backgroundColor: p.color }}
          initial={{ x: 0, y: 0, rotate: 0, scale: 0.4, opacity: 1 }}
          animate={{ x: p.x, y: p.y, rotate: p.rotate, scale: 1, opacity: 0 }}
          transition={{ duration: 1.1, delay: p.delay, ease: BURST_EASE }}
        />
      ))}
    </div>
  );
}
