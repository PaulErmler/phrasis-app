'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Lap colors, Apple-Watch style: each time the user completes another full
 * goal's worth of study the arc starts a new lap in the next color, drawn
 * over a track tinted with the previous lap's color. The ramp mirrors the
 * app's CEFR palette progression (primary blue → warning yellow →
 * accent orange → destructive red) and then wraps back to blue, so a
 * many-lap day keeps cycling instead of pinning on red.
 */
const LAP_COLORS = [
  'var(--primary)',
  'var(--warning)',
  'var(--accent-orange)',
  'var(--destructive)',
] as const;

const lapColor = (lap: number) =>
  LAP_COLORS[((lap % LAP_COLORS.length) + LAP_COLORS.length) % LAP_COLORS.length];

/**
 * rAF-driven ring progress in "laps" (1.0 = one full goal). A plain
 * motion.circle can't switch stroke color discretely at lap boundaries
 * mid-tween, so the sweep is driven manually and lap/arc are derived per
 * frame. Restarts from `from` whenever `replayKey` changes. Duration scales
 * with the number of laps to sweep, capped so a 5× day doesn't animate
 * forever.
 */
function useRingProgress(
  from: number,
  to: number,
  replayKey: number | string,
): number {
  const [progress, setProgress] = React.useState(from);

  React.useEffect(() => {
    let raf: number;
    const laps = Math.max(1, Math.ceil(Math.abs(to - from)));
    const duration = Math.min(1200 + (laps - 1) * 600, 2800);
    const delay = 300;
    const start = performance.now() + delay;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (nowTs: number) => {
      const t = Math.max(0, Math.min(1, (nowTs - start) / duration));
      setProgress(from + (to - from) * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, replayKey]);

  return progress;
}

/**
 * Circular daily-goal progress ring (SVG stroke-dash pattern, cf. the context
 * gauge in components/ai-elements/context.tsx), with multi-lap
 * over-achievement: past 100% the arc keeps circling in the next color of
 * the ramp so a big day is visible at a glance. The entrance sweep replays
 * whenever `replayKey` changes. The homescreen bumps it on every
 * hidden→visible transition of the kept-mounted home view.
 *
 * `fromMs` sets where the sweep starts: pass the previous snapshot value to
 * animate only the delta since the user last looked, or 0 for a full
 * draw-in. An incomplete goal never shows a warning color. The ramp only
 * advances by completing laps.
 */
export function DailyGoalRing({
  goalMinutes,
  todayMs,
  fromMs = 0,
  replayKey = 0,
  size = 40,
  strokeWidth = 3.5,
  className,
  children,
}: {
  goalMinutes: number;
  todayMs: number;
  fromMs?: number;
  replayKey?: number | string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Center content (minutes count, check icon, flame …). */
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const goalMs = goalMinutes * 60_000;
  const toProgress = goalMs > 0 ? Math.max(0, todayMs / goalMs) : 0;
  const fromProgress =
    goalMs > 0 ? Math.min(Math.max(0, fromMs / goalMs), toProgress) : 0;

  const progress = useRingProgress(fromProgress, toProgress, replayKey);

  // Exactly-full laps render as a completed circle of that lap's color, not
  // an empty arc of the next one.
  const rawLap = Math.floor(progress);
  const rawFraction = progress - rawLap;
  const onLapBoundary = rawFraction === 0 && rawLap > 0;
  const lap = onLapBoundary ? rawLap - 1 : rawLap;
  const arcFraction = onLapBoundary ? 1 : rawFraction;

  const arcColor = lapColor(lap);
  const trackColor = lap === 0 ? 'var(--muted)' : lapColor(lap - 1);

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={arcColor}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - arcFraction)}
          style={{ transformOrigin: 'center', transform: 'rotate(-90deg)' }}
        />
      </svg>
      {children != null && (
        <div className="absolute inset-0 flex items-center justify-center leading-none">
          {children}
        </div>
      )}
    </div>
  );
}
