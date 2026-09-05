'use client';

import { useState, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  type TooltipProps,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import { formatTimeMs } from '@/lib/formatTime';
import { normalizeLanguageCode } from '@/lib/languages';
import {
  accumulateFromTotal,
  monthKeyOf,
  yearViewBuckets,
  type YearViewBuckets,
} from './cumulativeSeries';

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

interface LanguageDailyPoint {
  date: string;
  language: string;
  newWordsCount: number;
}

interface LanguageMonthlyPoint {
  month: string; // "YYYY-MM"
  language: string;
  newWordsCount: number;
}

interface CumulativeLineChartProps {
  dailyData: DailyPoint[];
  /** Every month with activity, all history: the year view is built from it. */
  monthlyData: MonthlyPoint[];
  languageDailyData?: LanguageDailyPoint[];
  /** Per-language new words by month over the same span as `monthlyData`. */
  languageMonthlyData?: LanguageMonthlyPoint[];
  /** User's IANA timezone. Used to build the day range so the cumulative line
   * spans every calendar day through today (in the user's zone). */
  timezone: string;
  /**
   * All-time totals per metric (the numbers in the tiles above). The line
   * starts at the total from before the window and ends here, so a month
   * view of a course with older history does not climb from zero.
   */
  totals?: {
    words: number;
    reviews: number;
    sentences: number;
    timeMs: number;
  };
  /** All-time word totals per target language, keyed by normalized code. */
  languageWordTotals?: { language: string; words: number }[];
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
    case 'words':
      return point.newCards;
    case 'reviews':
      return point.reps;
    case 'sentences':
      return point.newCards;
    case 'time':
      return point.timeMs;
  }
}

function getMonthlyValue(point: MonthlyPoint, metric: Metric): number {
  switch (metric) {
    case 'words':
      return point.totalNewCards;
    case 'reviews':
      return point.totalRepetitions;
    case 'sentences':
      return point.totalNewCards;
    case 'time':
      return point.totalTimeMs;
  }
}

/** Format a Date as "YYYY-MM-DD" in the user's timezone (matches how daily
 * stats are keyed server-side, and the ActivityHeatmap day grid). */
function formatDateInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

/** Inclusive list of "YYYY-MM-DD" day keys ending at today (user's timezone),
 * spanning `daysBack` days back, so the cumulative series reaches today and
 * flat-lines across inactive days. daysBack=7 → 8 points, daysBack=30 → 31. */
function buildDayRange(daysBack: number, timezone: string): string[] {
  const today = new Date();
  const days: string[] = [];
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(formatDateInTz(d, timezone));
  }
  return days;
}

/**
 * Axis label of a year-view bucket: the short month name (with the year
 * when the bucket is a January or the first bucket) or "Q1 '26".
 */
function yearBucketLabel(
  key: string,
  mode: YearViewBuckets['mode'],
  first: boolean,
  locale: string,
): string {
  if (mode === 'quarter') {
    return `${key.slice(5)} '${key.slice(2, 4)}`;
  }
  const date = new Date(`${key}-15T12:00:00Z`);
  const withYear = first || key.endsWith('-01');
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    ...(withYear ? { year: '2-digit' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

function formatValue(value: number, metric: Metric): string {
  if (metric === 'time') return formatTimeMs(value);
  return value.toLocaleString();
}

function formatTooltipDate(label: string): string {
  // Day labels are "MM-DD"; the year view's month and quarter labels are
  // shown as they are.
  const now = new Date();
  const [mm, dd] = label.split('-');
  if (!dd || !/^\d{2}$/.test(mm) || !/^\d{2}$/.test(dd)) return label;
  const monthNum = parseInt(mm, 10);
  const currentMonth = now.getMonth() + 1;
  const year =
    monthNum > currentMonth ? now.getFullYear() - 1 : now.getFullYear();
  return `${mm}-${dd}-${String(year).slice(2)}`;
}

/** The all-time total a metric's line ends at. The words fallback draws
 * `newCards`, so it pairs with the sentences total. */
function totalFor(
  totals: CumulativeLineChartProps['totals'],
  metric: Metric,
): number | undefined {
  if (!totals) return undefined;
  switch (metric) {
    case 'words':
    case 'sentences':
      return totals.sentences;
    case 'reviews':
      return totals.reviews;
    case 'time':
      return totals.timeMs;
  }
}

export function CumulativeLineChart({
  dailyData,
  monthlyData,
  languageDailyData,
  languageMonthlyData,
  timezone,
  totals,
  languageWordTotals,
}: CumulativeLineChartProps) {
  const t = useTranslations('StatsPage');
  const locale = useLocale();
  const [metric, setMetric] = useState<Metric>('words');
  const [range, setRange] = useState<TimeRange>('month');

  // The year view's buckets: the last twelve months, or every quarter of a
  // history two years or longer. Months with activity in either source
  // count as history.
  const yearBuckets = useMemo(() => {
    const currentMonth = monthKeyOf(formatDateInTz(new Date(), timezone));
    const active = [
      ...monthlyData.map((m) => m.month),
      ...(languageMonthlyData ?? []).map((m) => m.month),
    ];
    return yearViewBuckets(active, currentMonth);
  }, [monthlyData, languageMonthlyData, timezone]);
  const yearLabels = useMemo(
    () =>
      yearBuckets.keys.map((key, i) =>
        yearBucketLabel(key, yearBuckets.mode, i === 0, locale),
      ),
    [yearBuckets, locale],
  );

  // One line per language, variants merged onto their base code (`en` and
  // `en_gb`, `es` and `es_latam`), which is also how the word tile counts.
  const languageRows = useMemo(
    () =>
      (languageDailyData ?? []).map((d) => ({
        ...d,
        language: normalizeLanguageCode(d.language),
      })),
    [languageDailyData],
  );
  const languages = useMemo(() => {
    const set = new Set(languageRows.map((d) => d.language));
    return Array.from(set).sort();
  }, [languageRows]);
  const wordTotalByLanguage = useMemo(
    () =>
      new Map(
        (languageWordTotals ?? []).map((lw) => [
          normalizeLanguageCode(lw.language),
          lw.words,
        ]),
      ),
    [languageWordTotals],
  );

  const isWordsByLanguage = metric === 'words' && languages.length > 0;

  // Standard single-line chart data (reviews, sentences, time, or words fallback)
  const chartData = useMemo(() => {
    if (isWordsByLanguage) return []; // handled separately
    const total = totalFor(totals, metric);

    if (range === 'year') {
      const index = new Map(yearBuckets.keys.map((key, i) => [key, i]));
      const increments = yearBuckets.keys.map(() => 0);
      for (const p of monthlyData) {
        const i = index.get(yearBuckets.keyOfMonth(p.month));
        if (i !== undefined) increments[i]! += getMonthlyValue(p, metric);
      }
      const values = accumulateFromTotal(increments, total);
      return yearLabels.map((label, i) => ({ label, value: values[i]! }));
    }

    // Build a continuous daily series from the window edge through today so the
    // cumulative line reaches today and flat-lines across days with no activity
    // (rather than ending at the last active day).
    const daysBack = range === 'week' ? 7 : 30;
    const dayKeys = buildDayRange(daysBack, timezone);
    const byDate = new Map(dailyData.map((d) => [d.date, d]));

    const values = accumulateFromTotal(
      dayKeys.map((date) => {
        const point = byDate.get(date);
        return point ? getDailyValue(point, metric) : 0;
      }),
      total,
    );
    return dayKeys.map((date, i) => ({
      label: date.slice(5),
      value: values[i]!,
    }));
  }, [
    dailyData,
    monthlyData,
    yearBuckets,
    yearLabels,
    metric,
    range,
    isWordsByLanguage,
    timezone,
    totals,
  ]);

  // Per-language words chart data
  const langChartData = useMemo(() => {
    if (!isWordsByLanguage || languageRows.length === 0) return [];

    // Bucket keys (the year view's months or quarters, day keys otherwise)
    // with each language's increments, then one running total per language
    // that starts at that language's total from before the window.
    let labels: string[];
    let bucketKeys: string[];
    let rows: { key: string; language: string; newWordsCount: number }[];
    if (range === 'year') {
      bucketKeys = yearBuckets.keys;
      labels = yearLabels;
      rows = (languageMonthlyData ?? []).map((d) => ({
        key: yearBuckets.keyOfMonth(d.month),
        language: normalizeLanguageCode(d.language),
        newWordsCount: d.newWordsCount,
      }));
    } else {
      bucketKeys = buildDayRange(range === 'week' ? 7 : 30, timezone);
      labels = bucketKeys.map((date) => date.slice(5));
      rows = languageRows.map((d) => ({
        key: d.date,
        language: d.language,
        newWordsCount: d.newWordsCount,
      }));
    }

    const bucketIndex = new Map(bucketKeys.map((key, i) => [key, i]));
    const increments = new Map(
      languages.map((lang) => [lang, bucketKeys.map(() => 0)]),
    );
    for (const d of rows) {
      const i = bucketIndex.get(d.key);
      const series = increments.get(d.language);
      if (i === undefined || !series) continue;
      series[i]! += d.newWordsCount;
    }
    const series = new Map(
      languages.map((lang) => [
        lang,
        accumulateFromTotal(
          increments.get(lang)!,
          wordTotalByLanguage.get(lang),
        ),
      ]),
    );

    return labels.map((label, i) => {
      const point: Record<string, string | number> = { label };
      for (const lang of languages) point[lang] = series.get(lang)![i]!;
      return point;
    });
  }, [
    languageRows,
    languageMonthlyData,
    languages,
    range,
    isWordsByLanguage,
    timezone,
    wordTotalByLanguage,
    yearBuckets,
    yearLabels,
  ]);

  const chartConfig: ChartConfig = isWordsByLanguage
    ? Object.fromEntries(
        languages.map((lang, i) => [
          lang,
          {
            label: lang.toUpperCase(),
            color: LANGUAGE_COLORS[i % LANGUAGE_COLORS.length],
          },
        ]),
      )
    : {
        value: {
          label: t(`metric.${metric}`),
          color: 'var(--primary)',
        },
      };

  const hasData = isWordsByLanguage
    ? langChartData.length > 0 &&
      languages.some((lang) => {
        const last = langChartData[langChartData.length - 1];
        return last && (last[lang] as number) > 0;
      })
    : chartData.length > 0 && chartData[chartData.length - 1]?.value > 0;

  // Custom tooltip
  const renderTooltip = ({
    active,
    payload,
    label,
  }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const dateLabel = formatTooltipDate(String(label ?? ''));
    return (
      <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
        <p className="font-medium text-muted-foreground mb-1">{dateLabel}</p>
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            {isWordsByLanguage && (
              <div
                className="h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: entry.color }}
              />
            )}
            <span className="tabular-nums font-medium">
              {formatValue(entry.value ?? 0, metric)}{' '}
              <span className="text-muted-foreground font-normal">
                {isWordsByLanguage
                  ? entry.name?.toUpperCase()
                  : t(`metric.${metric}`).toLowerCase()}
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
                range === r
                  ? 'text-primary font-medium'
                  : 'text-muted-foreground',
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
              metric === m
                ? 'text-primary font-medium'
                : 'text-muted-foreground',
            )}
          >
            {t(`metric.${m}`)}
          </button>
        ))}
      </div>

      {hasData ? (
        <ChartContainer config={chartConfig} className="h-[180px] w-full">
          {isWordsByLanguage ? (
            <LineChart
              data={langChartData}
              margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            >
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
                domain={['dataMin', 'auto']}
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
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            >
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
                domain={['dataMin', 'auto']}
                tickFormatter={(v: number) =>
                  metric === 'time' ? formatTimeMs(v) : v.toLocaleString()
                }
              />
              <ChartTooltip content={renderTooltip} />
              <defs>
                <linearGradient id="fillValue" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--primary)"
                    stopOpacity={0.2}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--primary)"
                    stopOpacity={0.02}
                  />
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
