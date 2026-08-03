'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DAILY_TIME_PRESETS } from '@/lib/constants/dailyGoal';
import {
  PROJECTION_CAP_WORDS,
  projectFirstSession,
  roundFriendly,
} from '@/lib/projections';

/**
 * Prototype: the onboarding "At this pace, you'll know" step rebuilt on the
 * home-screen projection framing — "in the next 30 days" and "by the end of
 * the year" instead of the generic 1mo/6mo/1y triple. Three presentation
 * variants over identical math (lib/projections.projectFirstSession, same
 * dampener/cap as the home screen). The goal picker below feeds all three
 * live, exactly like the real step will.
 */

const MOCK_NEW_WORDS = 9;
const MOCK_SESSION_MINUTES = 5;

function daysToYearEnd(): number {
  const now = new Date();
  const end = new Date(now.getFullYear(), 11, 31);
  return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

interface Frames {
  in30Days: number;
  in30Capped: boolean;
  endOfYear: number;
  endOfYearCapped: boolean;
  yearEndDays: number;
  perSession: number;
}

function useFrames(goal: number): Frames {
  return useMemo(() => {
    const yearEndDays = daysToYearEnd();
    const in30Raw = projectFirstSession(MOCK_NEW_WORDS, MOCK_SESSION_MINUTES, goal, 30);
    const eoyRaw = projectFirstSession(
      MOCK_NEW_WORDS,
      MOCK_SESSION_MINUTES,
      goal,
      yearEndDays,
    );
    return {
      in30Days: roundFriendly(in30Raw),
      in30Capped: in30Raw >= PROJECTION_CAP_WORDS,
      endOfYear: roundFriendly(eoyRaw),
      endOfYearCapped: eoyRaw >= PROJECTION_CAP_WORDS,
      yearEndDays,
      perSession: Math.max(
        1,
        projectFirstSession(MOCK_NEW_WORDS, MOCK_SESSION_MINUTES, goal, 1),
      ),
    };
  }, [goal]);
}

export default function ProjectionStepPrototypes() {
  const [goal, setGoal] = useState<number>(DAILY_TIME_PRESETS[2]);
  const frames = useFrames(goal);

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">
          &quot;At this pace&quot; step — home-screen projection framing
        </h1>
        <p className="text-sm text-muted-foreground">
          Mock session: {MOCK_NEW_WORDS} new words in {MOCK_SESSION_MINUTES} minutes. Same
          math for all variants; the goal picker drives them live.
        </p>
        <div className="flex items-center gap-1.5 pt-2">
          {DAILY_TIME_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setGoal(m)}
              className={cn(
                'flex h-9 w-12 items-center justify-center rounded-md border text-xs font-medium tabular-nums transition-colors',
                goal === m
                  ? 'border-primary/30 bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {m}
            </button>
          ))}
          <span className="text-muted-xs pl-1">min/day</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 items-start">
        <VariantFrame
          title="1 — Two statement cards"
          note="Closest to today's layout: one card per promise, full sentences instead of bare milestone labels. Optional per-session line under the headline."
        >
          <VariantCards frames={frames} goal={goal} />
        </VariantFrame>
        <VariantFrame
          title="2 — Rotating big number"
          note="One frame at a time, auto-advances like the home screen's projection slot — tap to flip. Introduces the exact element users later see on home."
        >
          <VariantRotating frames={frames} />
        </VariantFrame>
        <VariantFrame
          title="3 — Timeline"
          note="Today → +30 days → Dec 31 down a vertical rail; emphasizes growth as a path rather than isolated numbers."
        >
          <VariantTimeline frames={frames} />
        </VariantFrame>
      </div>
    </div>
  );
}

function VariantFrame({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <div className="text-center space-y-1 pb-4">
          <p className="text-xs text-muted-foreground">
            You just learned {MOCK_NEW_WORDS} words in {MOCK_SESSION_MINUTES} minutes
          </p>
          <h3 className="text-lg font-bold">At this pace, you&apos;ll know</h3>
        </div>
        {children}
      </div>
    </div>
  );
}

function num(n: number, capped: boolean) {
  return `${n.toLocaleString()}${capped ? '+' : ''}`;
}

// ─── Variant 1: two statement cards ─────────────────────────────────────────

function VariantCards({ frames, goal }: { frames: Frames; goal: number }) {
  return (
    <div className="space-y-2">
      <div className="card-surface p-4 flex items-center gap-3">
        <BookOpen className="h-5 w-5 shrink-0" style={{ color: 'var(--primary)' }} />
        <div>
          <div className="text-xs text-muted-foreground">In the next 30 days</div>
          <div className="text-xl font-bold tabular-nums">
            {num(frames.in30Days, frames.in30Capped)}{' '}
            <span className="text-sm font-normal text-muted-foreground">words</span>
          </div>
        </div>
      </div>
      <div className="card-surface p-4 flex items-center gap-3">
        <Sparkles className="h-5 w-5 shrink-0" style={{ color: 'var(--primary)' }} />
        <div>
          <div className="text-xs text-muted-foreground">By the end of the year</div>
          <div className="text-xl font-bold tabular-nums">
            {num(frames.endOfYear, frames.endOfYearCapped)}{' '}
            <span className="text-sm font-normal text-muted-foreground">words</span>
          </div>
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground pt-1">
        ≈ {frames.perSession} new words per {goal}-minute day
      </p>
    </div>
  );
}

// ─── Variant 2: rotating big number (home-screen projection slot style) ────

function VariantRotating({ frames }: { frames: Frames }) {
  const slides = [
    {
      big: num(frames.in30Days, frames.in30Capped),
      label: 'words known in the next 30 days',
    },
    {
      big: num(frames.endOfYear, frames.endOfYearCapped),
      label: 'words known by the end of the year',
    },
    { big: String(frames.perSession), label: 'new words from every session' },
  ];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % slides.length), 4000);
    return () => clearInterval(id);
  }, [slides.length]);

  return (
    <button
      type="button"
      onClick={() => setIdx((i) => (i + 1) % slides.length)}
      className="w-full space-y-2 py-4 text-center"
    >
      <div
        key={idx}
        className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-1"
      >
        <div className="text-4xl font-bold tabular-nums">{slides[idx].big}</div>
        <div className="text-xs text-muted-foreground">{slides[idx].label}</div>
      </div>
      <div className="flex items-center justify-center gap-1 pt-2">
        {slides.map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 w-1.5 rounded-full transition-colors',
              i === idx ? 'bg-primary' : 'bg-muted',
            )}
          />
        ))}
      </div>
    </button>
  );
}

// ─── Variant 3: vertical timeline ───────────────────────────────────────────

function VariantTimeline({ frames }: { frames: Frames }) {
  const stops = [
    {
      Icon: BookOpen,
      when: 'Today',
      value: `${MOCK_NEW_WORDS} words`,
      sub: 'your first session',
    },
    {
      Icon: CalendarDays,
      when: 'In 30 days',
      value: `${num(frames.in30Days, frames.in30Capped)} words`,
      sub: 'a month of your daily goal',
    },
    {
      Icon: Sparkles,
      when: 'Dec 31',
      value: `${num(frames.endOfYear, frames.endOfYearCapped)} words`,
      sub: `${frames.yearEndDays} days from now`,
    },
  ];
  return (
    <div className="relative ml-3 space-y-6 py-2">
      <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" aria-hidden />
      {stops.map(({ Icon, when, value, sub }) => (
        <div key={when} className="relative flex items-start gap-4">
          <span className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-background">
            <Icon className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />
          </span>
          <div className="-mt-0.5">
            <div className="text-xs text-muted-foreground">{when}</div>
            <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
