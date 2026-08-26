'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Flame,
  RotateCcw,
  Clock,
  TrendingUp,
  BookOpen,
  Zap,
  MessageSquare,
} from 'lucide-react';
import { LandingSquircleIcon } from '@/components/landing/landing-squircle-icon';
import { LandingWordCloud } from '@/components/landing/LandingWordCloud';
import { cn } from '@/lib/utils';
import { fadeInUp } from './animations';

/* ── Seeded random for deterministic mock data ── */

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ── Mock data ── */

type TimeRange = 'week' | 'month' | 'year';

// Pre-generate a full year of daily word counts (365 days) with realistic patterns
const DAILY_WORDS = (() => {
  const rand = seededRandom(42);
  const data: number[] = [];
  for (let i = 0; i < 365; i++) {
    const dayOfWeek = i % 7;
    const weekendFactor = dayOfWeek >= 5 ? 0.6 : 1;
    // Gradual improvement over the year
    const trend = 8 + (i / 365) * 6;
    const noise = rand() * trend * 0.6;
    // Some rest days
    const isRest = rand() < 0.06;
    data.push(isRest ? 0 : Math.round((trend + noise) * weekendFactor));
  }
  return data;
})();

function getWordData(range: TimeRange): { labels: string[]; values: number[] } {
  if (range === 'week') {
    const slice = DAILY_WORDS.slice(-7);
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let cum = 720;
    return {
      labels: dayNames,
      values: slice.map((v) => {
        cum += v;
        return cum;
      }),
    };
  }
  if (range === 'month') {
    const slice = DAILY_WORDS.slice(-30);
    let cum = 580;
    return {
      labels: slice.map((_, i) => (i % 5 === 0 ? String(i + 1) : '')),
      values: slice.map((v) => {
        cum += v;
        return cum;
      }),
    };
  }
  // year: aggregate into 12 months
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthly: number[] = [];
  for (let m = 0; m < 12; m++) {
    const start = Math.floor((m / 12) * 365);
    const end = Math.floor(((m + 1) / 12) * 365);
    monthly.push(DAILY_WORDS.slice(start, end).reduce((a, b) => a + b, 0));
  }
  let cum = 0;
  return {
    labels: months,
    values: monthly.map((v) => {
      cum += v;
      return cum;
    }),
  };
}

/* ── SVG helpers ── */

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
  }
  return d;
}

function dataToPoints(
  values: number[],
  w: number,
  h: number,
  padY = 0.05,
): { x: number; y: number }[] {
  const min = Math.min(...values) * (1 - padY);
  const max = Math.max(...values) * (1 + padY);
  const range = max - min || 1;
  return values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: h - ((v - min) / range) * h,
  }));
}

/* ── Mini visual components ── */

const CHART_H = 110;
const CHART_W = 300;

function MiniChart({ range }: { range: TimeRange }) {
  const { values } = useMemo(() => getWordData(range), [range]);
  const points = dataToPoints(values, CHART_W, CHART_H);
  const line = buildSmoothPath(points);
  const area = `${line} L${CHART_W},${CHART_H} L0,${CHART_H} Z`;
  const total = values[values.length - 1];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs text-muted-foreground">Words learned</span>
        <motion.span
          key={`${range}-${total}`}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm font-semibold text-primary tabular-nums"
        >
          {total.toLocaleString()}
        </motion.span>
      </div>
      <AnimatePresence mode="wait">
        <motion.svg
          key={range}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full h-auto"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="landing-chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
              <stop
                offset="100%"
                stopColor="var(--primary)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#landing-chart-fill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </AnimatePresence>
    </div>
  );
}

const PROJECTION_FACT_KEYS = [
  'projectionFacts.wordsByYearEnd',
  'projectionFacts.nextLevel',
  'projectionFacts.wordsPerSession',
] as const;

const PROJECTION_INTERVAL_MS = 3500;

/**
 * Mini replica of the in-app rotating forecast slot: cycles three static
 * demo facts with a vertical slide+fade. No auto-cycle under
 * prefers-reduced-motion (the first fact stays put).
 */
function MiniProjection() {
  const t = useTranslations('LandingPage.analytics');
  const reducedMotion = useReducedMotion();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(
      () => setIdx((i) => (i + 1) % PROJECTION_FACT_KEYS.length),
      PROJECTION_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [reducedMotion]);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-2.5">
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {t('projectionLabel')}
      </span>
      <div className="relative h-4 min-w-0 flex-1 overflow-hidden text-right">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={idx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="block truncate text-xs font-semibold text-primary tabular-nums leading-4"
          >
            {t(PROJECTION_FACT_KEYS[idx])}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

function MiniSessionSnapshot() {
  const stats = [
    { icon: RotateCcw, label: 'Reps', value: '847', today: '24 today' },
    { icon: MessageSquare, label: 'Sentences', value: '312', today: '+3 new' },
    { icon: Clock, label: 'Time', value: '14h', today: '8m today' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex flex-col items-center gap-0.5">
          <div
            className="flex items-center justify-center h-9 w-9 rounded-xl"
            style={{
              backgroundColor:
                'color-mix(in srgb, var(--streak-active) 15%, transparent)',
            }}
          >
            <Flame
              className="h-4 w-4"
              style={{ color: 'var(--streak-active)' }}
            />
          </div>
          <span
            className="text-base font-bold tabular-nums"
            style={{ color: 'var(--streak-active)' }}
          >
            24
          </span>
          <span className="text-[10px] text-muted-foreground">Streak</span>
        </div>
        <div className="w-px self-stretch bg-border/60" />
        <div className="flex-1 grid grid-cols-3 gap-1">
          {stats.map(({ icon: Icon, label, value, today }) => (
            <div
              key={label}
              className="flex flex-col items-center text-center gap-0.5"
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-base font-semibold tabular-nums leading-tight">
                {value}
              </span>
              <span className="text-[10px] text-muted-foreground leading-none">
                {label}
              </span>
              <span className="text-[10px] font-medium text-primary tabular-nums leading-none mt-0.5">
                {today}
              </span>
            </div>
          ))}
        </div>
      </div>
      <MiniProjection />
    </div>
  );
}

/* ── Time range selector ── */

function TimeRangeSelector({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (r: TimeRange) => void;
}) {
  const ranges: TimeRange[] = ['week', 'month', 'year'];
  const labels: Record<TimeRange, string> = {
    week: 'Week',
    month: 'Month',
    year: 'Year',
  };
  return (
    <div className="flex gap-2 text-xs">
      {ranges.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={cn(
            'transition-colors',
            r === value ? 'text-primary font-medium' : 'text-muted-foreground',
          )}
        >
          {labels[r]}
        </button>
      ))}
    </div>
  );
}

/* ── Card definitions ── */

type CardDef = {
  icon: typeof TrendingUp;
  titleKey: string;
  bodyKey: string;
  visual: (range: TimeRange) => React.ReactNode;
  hasTimeRange?: boolean;
};

const ALL_CARDS: CardDef[] = [
  {
    icon: TrendingUp,
    titleKey: 'progressTitle',
    bodyKey: 'progressBody',
    hasTimeRange: true,
    visual: (range) => <MiniChart range={range} />,
  },
  {
    icon: BookOpen,
    titleKey: 'activityTitle',
    bodyKey: 'activityBody',
    visual: () => <LandingWordCloud />,
  },
  {
    icon: Zap,
    titleKey: 'insightsTitle',
    bodyKey: 'insightsBody',
    visual: () => <MiniSessionSnapshot />,
  },
];

function AnalyticsCard({
  card,
  index,
  t,
}: {
  card: CardDef;
  index: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const [range, setRange] = useState<TimeRange>('month');
  const Icon = card.icon;

  return (
    <motion.div
      {...fadeInUp}
      transition={{
        duration: 0.6,
        delay: 0.1 + index * 0.04,
        ease: 'easeOut' as const,
      }}
      className="ent-bento-card relative flex flex-col rounded-2xl border border-border/40 bg-card p-7 md:p-8"
    >
      <div className="flex items-start justify-between mb-5">
        <LandingSquircleIcon>
          <Icon className="h-6 w-6 text-white" />
        </LandingSquircleIcon>
        {card.hasTimeRange && (
          <TimeRangeSelector value={range} onChange={setRange} />
        )}
      </div>
      <h3 className="text-lg md:text-xl font-semibold mb-2">
        {t(card.titleKey)}
      </h3>
      <p className="text-sm md:text-base text-muted-foreground leading-relaxed mb-6">
        {t(card.bodyKey)}
      </p>
      <div className="mt-auto rounded-xl bg-muted/30 border border-border/30 p-4">
        {card.visual(range)}
      </div>
    </motion.div>
  );
}

export function AnalyticsSection() {
  const t = useTranslations('LandingPage.analytics');

  return (
    <section className="relative py-20 md:py-32 px-4 sm:px-6 border-t border-border/40">
      <div className="max-w-7xl mx-auto">
        <motion.div {...fadeInUp} className="mb-14 md:mb-20 max-w-2xl">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-5">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('lead')}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
          {ALL_CARDS.map((card, index) => (
            <AnalyticsCard
              key={card.titleKey}
              card={card}
              index={index}
              t={t}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
