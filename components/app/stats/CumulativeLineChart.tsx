'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Area, AreaChart, Line, LineChart, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import { formatTimeMs } from '@/lib/formatTime';

type Metric = 'words' | 'reviews' | 'sentences' | 'time';
type TimeRange = 'week' | 'month' | 'year';

interface DailyPoint {
  date: string;
  reps: number;
  newCards: number;
  timeMs: number;
}

interface MonthlyPoint {
  month: string;
  totalRepetitions: number;
  totalNewCards: number;
  totalTimeMs: number;
}

interface WeeklyPoint {
  week: string; // "YYYY-Www"
  totalRepetitions: number;
  totalNewCards: number;
  totalTimeMs: number;
}

interface LanguageDailyPoint {
  date: string;
  language: string;
  newWordsCount: number;
}

interface CumulativeLineChartProps {
  dailyData: DailyPoint[];
  monthlyData: MonthlyPoint[];
  weeklyData?: WeeklyPoint[];
  languageDailyData?: LanguageDailyPoint[];
}

const METRICS: Metric[] = ['words', 'reviews', 'sentences', 'time'];
const TIME_RANGES: TimeRange[] = ['week', 'month', 'year'];

// Colors for per-language lines (blue, orange, yellow)
const LANGUAGE_COLORS = [
  'var(--primary)',
  'var(--accent-orange)',
  'var(--streak-active)',
];

function getDailyValue(point: DailyPoint, metric: Metric): number {
  switch (metric) {
  case 'words': return point.newCards;
  case 'reviews': return point.reps;
  case 'sentences': return point.newCards;
  case 'time': return point.timeMs;
  }
}

function getMonthlyValue(point: MonthlyPoint, metric: Metric): number {
  switch (metric) {
  case 'words': return point.totalNewCards;
  case 'reviews': return point.totalRepetitions;
  case 'sentences': return point.totalNewCards;
  case 'time': return point.totalTimeMs;
  }
}

function getWeeklyValue(point: WeeklyPoint, metric: Metric): number {
  switch (metric) {
  case 'words': return point.totalNewCards;
  case 'reviews': return point.totalRepetitions;
  case 'sentences': return point.totalNewCards;
  case 'time': return point.totalTimeMs;
  }
}

/** Convert "YYYY-Www" to the Monday date of that ISO week, formatted as "MM-DD". */
function weekToDateLabel(week: string): string {
  const [yearStr, wStr] = week.split('-W');
  const year = parseInt(yearStr, 10);
  const weekNum = parseInt(wStr, 10);
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
  const mm = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/** Convert a "YYYY-MM-DD" date string to ISO week "YYYY-Www". */
function dateToISOWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function formatValue(value: number, metric: Metric): string {
  if (metric === 'time') return formatTimeMs(value);
  return value.toLocaleString();
}

function formatTooltipDate(label: string): string {
  // label is always "MM-DD" now (daily, weekly, or monthly views all use this format)
  const now = new Date();
  const [mm, dd] = label.split('-');
  if (!dd) return label; // fallback
  const monthNum = parseInt(mm, 10);
  const currentMonth = now.getMonth() + 1;
  const year = monthNum > currentMonth ? now.getFullYear() - 1 : now.getFullYear();
  return `${mm}-${dd}-${String(year).slice(2)}`;
}

export function CumulativeLineChart({ dailyData, monthlyData, weeklyData, languageDailyData }: CumulativeLineChartProps) {
  const t = useTranslations('StatsPage');
  const [metric, setMetric] = useState<Metric>('words');
  const [range, setRange] = useState<TimeRange>('month');

  // Detect unique languages from language data
  const languages = useMemo(() => {
    if (!languageDailyData?.length) return [];
    const set = new Set(languageDailyData.map((d) => d.language));
    return Array.from(set).sort();
  }, [languageDailyData]);

  const isWordsByLanguage = metric === 'words' && languages.length > 0;

  // Standard single-line chart data (reviews, sentences, time, or words fallback)
  const chartData = useMemo(() => {
    if (isWordsByLanguage) return []; // handled separately

    if (range === 'year') {
      const sorted = [...(weeklyData ?? [])].sort((a, b) => a.week.localeCompare(b.week));
      let cumulative = 0;
      return sorted.map((p) => {
        cumulative += getWeeklyValue(p, metric);
        return { label: weekToDateLabel(p.week), value: cumulative };
      });
    }

    const now = new Date();
    const daysBack = range === 'week' ? 7 : 30;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const filtered = dailyData
      .filter((d) => d.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));

    let cumulative = 0;
    return filtered.map((p) => {
      cumulative += getDailyValue(p, metric);
      return { label: p.date.slice(5), value: cumulative };
    });
  }, [dailyData, weeklyData, metric, range, isWordsByLanguage]);

  // Per-language words chart data
  const langChartData = useMemo(() => {
    if (!isWordsByLanguage || !languageDailyData?.length) return [];

    const now = new Date();

    if (range === 'year') {
      // Aggregate daily language data into ISO weeks, then accumulate
      const weekMap = new Map<string, Map<string, number>>();
      for (const d of languageDailyData) {
        const weekKey = dateToISOWeek(d.date);
        if (!weekMap.has(weekKey)) weekMap.set(weekKey, new Map());
        const langMap = weekMap.get(weekKey)!;
        langMap.set(d.language, (langMap.get(d.language) ?? 0) + d.newWordsCount);
      }

      const sortedWeeks = Array.from(weekMap.keys()).sort();
      const cumulatives = new Map<string, number>();
      for (const lang of languages) cumulatives.set(lang, 0);

      return sortedWeeks.map((week) => {
        const langMap = weekMap.get(week)!;
        const point: Record<string, string | number> = { label: weekToDateLabel(week) };
        for (const lang of languages) {
          cumulatives.set(lang, (cumulatives.get(lang) ?? 0) + (langMap.get(lang) ?? 0));
          point[lang] = cumulatives.get(lang)!;
        }
        return point;
      });
    }

    // Week or month
    const daysBack = range === 'week' ? 7 : 30;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Group by date
    const dateMap = new Map<string, Map<string, number>>();
    for (const d of languageDailyData) {
      if (d.date < cutoffStr) continue;
      if (!dateMap.has(d.date)) dateMap.set(d.date, new Map());
      const langMap = dateMap.get(d.date)!;
      langMap.set(d.language, (langMap.get(d.language) ?? 0) + d.newWordsCount);
    }

    const sortedDates = Array.from(dateMap.keys()).sort();
    const cumulatives = new Map<string, number>();
    for (const lang of languages) cumulatives.set(lang, 0);

    return sortedDates.map((date) => {
      const langMap = dateMap.get(date)!;
      const point: Record<string, string | number> = { label: date.slice(5) };
      for (const lang of languages) {
        cumulatives.set(lang, (cumulatives.get(lang) ?? 0) + (langMap.get(lang) ?? 0));
        point[lang] = cumulatives.get(lang)!;
      }
      return point;
    });
  }, [languageDailyData, languages, range, isWordsByLanguage]);

  const chartConfig: ChartConfig = isWordsByLanguage
    ? Object.fromEntries(
      languages.map((lang, i) => [
        lang,
        { label: lang.toUpperCase(), color: LANGUAGE_COLORS[i % LANGUAGE_COLORS.length] },
      ]),
    )
    : {
      value: {
        label: t(`metric.${metric}`),
        color: 'var(--primary)',
      },
    };

  const hasData = isWordsByLanguage
    ? langChartData.length > 0 && languages.some((lang) => {
      const last = langChartData[langChartData.length - 1];
      return last && (last[lang] as number) > 0;
    })
    : chartData.length > 0 && chartData[chartData.length - 1]?.value > 0;

  // Custom tooltip
  const renderTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const dateLabel = formatTooltipDate(label);
    return (
      <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
        <p className="font-medium text-muted-foreground mb-1">{dateLabel}</p>
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            {isWordsByLanguage && (
              <div className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: entry.color }} />
            )}
            <span className="tabular-nums font-medium">
              {formatValue(entry.value, metric)}{' '}
              <span className="text-muted-foreground font-normal">
                {isWordsByLanguage ? entry.name?.toUpperCase() : t(`metric.${metric}`).toLowerCase()}
              </span>
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="card-surface p-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-muted-foreground">
          {t('progress')}
        </p>
        <div className="flex gap-2 text-xs">
          {TIME_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'transition-colors',
                range === r ? 'text-primary font-medium' : 'text-muted-foreground',
              )}
            >
              {t(r)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 text-xs mb-3">
        {METRICS.map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={cn(
              'transition-colors',
              metric === m ? 'text-primary font-medium' : 'text-muted-foreground',
            )}
          >
            {t(`metric.${m}`)}
          </button>
        ))}
      </div>

      {hasData ? (
        <ChartContainer config={chartConfig} className="h-[180px] w-full">
          {isWordsByLanguage ? (
            <LineChart data={langChartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                width={36}
              />
              <ChartTooltip content={renderTooltip} />
              {languages.map((lang, i) => (
                <Line
                  key={lang}
                  type="monotone"
                  dataKey={lang}
                  stroke={LANGUAGE_COLORS[i % LANGUAGE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                width={metric === 'time' ? 52 : 36}
                tickFormatter={(v: number) => metric === 'time' ? formatTimeMs(v) : v.toLocaleString()}
              />
              <ChartTooltip content={renderTooltip} />
              <defs>
                <linearGradient id="fillValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--primary)"
                strokeWidth={2}
                fill="url(#fillValue)"
                isAnimationActive={false}
              />
            </AreaChart>
          )}
        </ChartContainer>
      ) : (
        <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
          {t('noData')}
        </div>
      )}
    </div>
  );
}
