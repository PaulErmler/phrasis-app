'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

/**
 * "Customizing your first lesson…" step.
 *
 * Linear progress bar over a fixed duration. The actual course creation
 * happens via `onMountAction` (a thin wrapper the wizard supplies to
 * call `completeOnboarding`) — fired once on mount, idempotent so re-entry
 * after a back-nav doesn't break.
 *
 * Advances automatically when both:
 *   1. The progress animation hits 100%, AND
 *   2. The mount action has resolved (success or known-idempotent skip)
 *
 * The fixed-duration bar gives the user a consistent "settling in" beat
 * instead of a jittery progress that mirrors backend translation/audio
 * readiness (which depends on per-language LLM/TTS queue latency).
 */
interface Props {
  onReady: () => void;
  /** Run once on mount. Returns when the underlying setup is complete or
   *  was previously completed (idempotent). */
  onMountAction?: () => Promise<unknown>;
  durationMs?: number;
  /** Time to hold the bar at exactly 100% before advancing — gives the
   *  user a clear "done" beat instead of snapping forward the instant the
   *  animation finishes. */
  holdMs?: number;
}

const BEAT_COUNT = 5;

export function CustomizingStep({
  onReady,
  onMountAction,
  durationMs = 5000,
  holdMs = 600,
}: Props) {
  const t = useTranslations('Onboarding.customizing');
  const [pct, setPct] = useState(0);
  const [animationDone, setAnimationDone] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const advancedRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  // Fire the mount action once.
  useEffect(() => {
    if (!onMountAction) {
      setActionDone(true);
      return;
    }
    let cancelled = false;
    onMountAction()
      .catch((err) => {
        // Failure here is non-fatal — we still want the bar to finish so the
        // user isn't stuck. Log for visibility.
        console.error('CustomizingStep mount action failed:', err);
      })
      .finally(() => {
        if (!cancelled) setActionDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [onMountAction]);

  // Plain linear fill 0 → 100 over `durationMs`.
  useEffect(() => {
    let raf = 0;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const tick = (now: number) => {
      if (startedAtRef.current === null) startedAtRef.current = now;
      const fraction = Math.min(1, (now - startedAtRef.current) / durationMs);
      setPct(fraction * 100);
      if (fraction < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setPct(100);
        holdTimer = setTimeout(() => setAnimationDone(true), holdMs);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, [durationMs, holdMs]);

  // Advance once both gates are met. Guard with a ref so we never call
  // `onReady` twice (e.g. on a re-render after the animation finishes).
  useEffect(() => {
    if (advancedRef.current) return;
    if (animationDone && actionDone) {
      advancedRef.current = true;
      onReady();
    }
  }, [animationDone, actionDone, onReady]);

  const beatIdx = Math.min(BEAT_COUNT - 1, Math.floor((pct / 100) * BEAT_COUNT));

  return (
    <div
      data-testid="onboarding-step-customizing"
      className="flex flex-col h-full items-center justify-center text-center animate-in fade-in duration-300 px-4"
    >
      <Loader2 className="h-10 w-10 animate-spin text-primary mb-6" />
      <h2 className="text-2xl font-bold mb-2">{t('title')}</h2>
      <p className="text-muted-foreground mb-6 min-h-[1.25rem]">{t(`beats.${beatIdx}`)}</p>
      <div className="w-full max-w-sm h-1.5 rounded-full bg-primary/20 overflow-hidden">
        <div
          className="h-full bg-primary rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
