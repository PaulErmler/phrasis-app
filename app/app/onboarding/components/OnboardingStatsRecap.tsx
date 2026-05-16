'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen,
  TrendingUp,
  Clock,
  RotateCcw,
  Flame,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * End-of-first-lesson stats recap — multi-step layout.
 *
 * Step 1 mirrors the in-session `ProgressDisplay` celebration: a hero count
 * (words just learned), a 3-cell stats row (reviews / time / new), and the
 * actual word list integrated underneath. This makes the recap feel like a
 * scaled-up version of the celebration the user already saw mid-session.
 *
 * Step 2 shows the long-term projection (1mo / 6mo / 1yr).
 * Step 3 is a "ready" pat-on-the-back with the streak/return CTA.
 */

interface Props {
  wordsLearned: number;
  sessionMinutes: number;
  dailyTimeGoalMinutes: number;
  reps?: number;
  words?: string[];
  /** Called when the user finishes the last step. */
  onComplete?: () => void;
}

function project(
  wordsLearned: number,
  sessionMinutes: number,
  dailyTimeGoalMinutes: number,
  days: number,
): number {
  if (sessionMinutes <= 0) return 0;
  const wordsPerMin = wordsLearned / sessionMinutes;
  const linear = wordsPerMin * dailyTimeGoalMinutes * days;
  return Math.round(linear * Math.min(1, 30 / Math.max(1, days) + 0.5));
}

const MILESTONES = [
  { label: '1 month', days: 30, Icon: BookOpen },
  { label: '6 months', days: 180, Icon: TrendingUp },
  { label: '1 year', days: 365, Icon: Sparkles },
] as const;

export function OnboardingStatsRecap({
  wordsLearned,
  sessionMinutes,
  dailyTimeGoalMinutes,
  reps,
  words = [],
  onComplete,
}: Props) {
  const [step, setStep] = useState(0);
  const totalSteps = 3;

  const next = () => {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else if (onComplete) {
      onComplete();
    }
  };
  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden animate-in fade-in duration-300">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="max-w-md mx-auto w-full">
          {step === 0 ? (
            <StepHero
              wordsLearned={wordsLearned}
              sessionMinutes={sessionMinutes}
              reps={reps ?? 0}
              words={words}
            />
          ) : step === 1 ? (
            <StepProjection
              wordsLearned={wordsLearned}
              sessionMinutes={sessionMinutes}
              dailyTimeGoalMinutes={dailyTimeGoalMinutes}
            />
          ) : (
            <StepReady dailyTimeGoalMinutes={dailyTimeGoalMinutes} />
          )}
        </div>
      </div>

      <div className="shrink-0 border-t bg-background py-3 px-4">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={step === 0}
            onClick={prev}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSteps }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted',
                )}
              />
            ))}
          </div>
          <Button size="sm" onClick={next} className="gap-1">
            {step === totalSteps - 1 ? 'Continue' : 'Next'}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Hero (mirrors in-session ProgressDisplay) ──────────────────────

const CONTAINER_VARIANTS = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
  },
};
const CHILD_VARIANTS = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
};

function StepHero({
  wordsLearned,
  sessionMinutes,
  reps,
  words,
}: {
  wordsLearned: number;
  sessionMinutes: number;
  reps: number;
  words: string[];
}) {
  return (
    <motion.div
      className="flex flex-col items-stretch gap-6"
      initial="hidden"
      animate="visible"
      variants={CONTAINER_VARIANTS}
    >
      {/* Hero count — mirrors ProgressDisplay's text-6xl primary numeral */}
      <motion.div className="flex flex-col items-center gap-2 text-center" variants={CHILD_VARIANTS}>
        <p className="text-6xl font-bold tabular-nums text-primary leading-none">
          +{wordsLearned}
        </p>
        <p className="text-sm text-muted-foreground">new words this session</p>
      </motion.div>

      {/* 3-cell stats row — mirrors ProgressDisplay's card-surface stats grid */}
      <motion.div className="card-surface p-4" variants={CHILD_VARIANTS}>
        <div className="grid grid-cols-3 gap-4">
          <StatCell
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            label="reviews"
            value={reps.toLocaleString()}
          />
          <StatCell
            icon={<Clock className="h-3.5 w-3.5" />}
            label="time"
            value={`${sessionMinutes.toFixed(0)}m`}
          />
          <StatCell
            icon={<BookOpen className="h-3.5 w-3.5" />}
            label="new"
            value={`+${wordsLearned}`}
          />
        </div>
      </motion.div>

      {/* Word list integrated into the hero step (per request) */}
      {words.length > 0 ? (
        <motion.div className="card-surface p-4 space-y-2" variants={CHILD_VARIANTS}>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Words you just learned
          </div>
          <div className="flex flex-wrap gap-1.5">
            {words.map((w) => (
              <Badge key={w} variant="secondary" className="text-xs font-normal">
                {w}
              </Badge>
            ))}
          </div>
        </motion.div>
      ) : null}
    </motion.div>
  );
}

function StatCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-muted-foreground">{icon}</div>
      <span className="text-lg font-bold tabular-nums leading-none">{value}</span>
      <span className="text-muted-xs leading-none">{label}</span>
    </div>
  );
}

// ─── Step 2: Projection (1mo / 6mo / 1yr) ───────────────────────────────────

function StepProjection({
  wordsLearned,
  sessionMinutes,
  dailyTimeGoalMinutes,
}: {
  wordsLearned: number;
  sessionMinutes: number;
  dailyTimeGoalMinutes: number;
}) {
  return (
    <div className="space-y-4">
      <div className="text-center py-3">
        <h3 className="text-lg font-bold">At this pace, you&apos;ll know</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {dailyTimeGoalMinutes} min/day · linear projection
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        {MILESTONES.map(({ label, days, Icon }) => {
          const projected = project(wordsLearned, sessionMinutes, dailyTimeGoalMinutes, days);
          return (
            <div key={label} className="card-surface p-3 md:p-4 text-center space-y-1">
              <Icon className="h-4 w-4 md:h-5 md:w-5 mx-auto" style={{ color: 'var(--primary)' }} />
              <div className="text-muted-xs">{label}</div>
              <div className="text-xl md:text-2xl font-bold tabular-nums">
                {projected.toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">words</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 3: Ready (streak + CTA) ───────────────────────────────────────────

function StepReady({ dailyTimeGoalMinutes }: { dailyTimeGoalMinutes: number }) {
  return (
    <div className="card-surface p-6 text-center space-y-3">
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-streak-active/15 mx-auto">
        <Flame className="h-6 w-6" style={{ color: 'var(--streak-active)' }} />
      </div>
      <div className="text-lg font-semibold">Day 1 done</div>
      <div className="text-sm text-muted-foreground">
        Keep this streak alive — come back tomorrow for {dailyTimeGoalMinutes} more minutes.
      </div>
    </div>
  );
}
