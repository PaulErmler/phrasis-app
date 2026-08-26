'use client';

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { getUserTimezone } from '@/lib/timezone';
import { useNowMinute } from '@/hooks/use-now-minute';
import { dateInTimezone } from '@/lib/dateStrings';
import { normalizeLanguageCode } from '@/lib/languages';
import { NumbersRow } from './NumbersRow';
import { CumulativeLineChart } from './CumulativeLineChart';
import { ActivityHeatmap } from './ActivityHeatmap';
import { HourlyDistribution } from './HourlyDistribution';
import { AppUsageStats } from './AppUsageStats';
import { WordCloudSection } from './WordCloudCard';

function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

function monthsAgoStr(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getISOWeekString(dateStr: string): string {
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

function weeksAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  const iso = d.toISOString().slice(0, 10);
  return getISOWeekString(iso);
}

export function StatsView() {
  const tz = getUserTimezone();
  // Minute-quantized clock (no-wall-clock query guideline, same derivation
  // as the getCourseStats caller in ProgressStatsCard) so `today` and the
  // ranges keyed on it roll over at local midnight while the view is open.
  const nowMinute = useNowMinute();
  const todayStr = dateInTimezone(nowMinute, tz);
  const yearStartStr = yearStart();

  // Query 1: Small summary data (courseStats, todayReps, hourly, monthly, weekly)
  const pageData = useQuery(api.features.stats.getStatsPageData, {
    timezone: tz,
    today: todayStr,
    startDate: yearStartStr,
    endDate: todayStr,
    startMonth: monthsAgoStr(12),
    endMonth: currentMonthStr(),
    startWeek: weeksAgoStr(52),
    endWeek: getISOWeekString(todayStr),
  });

  // Query 2: Heavier daily data (heatmap + language daily stats)
  const dailyData = useQuery(api.features.stats.getStatsPageDailyData, {
    startDate: yearStartStr,
    endDate: todayStr,
  });

  // Only include target languages in language daily data
  const languageDailyData = dailyData?.languageDailyData;
  const targetLanguages = pageData?.targetLanguages;
  const filteredLanguageData = useMemo(() => {
    if (!languageDailyData?.length || !targetLanguages) return [];
    const targetSet = new Set(
      targetLanguages.map((l: string) => normalizeLanguageCode(l)),
    );
    return languageDailyData.filter((d) =>
      targetSet.has(normalizeLanguageCode(d.language)),
    );
  }, [languageDailyData, targetLanguages]);

  const todayNewWords = useMemo(() => {
    if (!filteredLanguageData.length) return 0;
    return filteredLanguageData
      .filter((d) => d.date === todayStr)
      .reduce((sum, d) => sum + d.newWordsCount, 0);
  }, [filteredLanguageData, todayStr]);

  const periodStats = useMemo(() => {
    const heatmap = dailyData?.heatmapData ?? [];
    const now = new Date();
    const daysAgo = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const weekCutoff = daysAgo(7);
    const monthCutoff = daysAgo(30);

    const sum = (arr: typeof heatmap) => ({
      reps: arr.reduce((s, d) => s + d.reps, 0),
      newCards: arr.reduce((s, d) => s + d.newCards, 0),
      timeMs: arr.reduce((s, d) => s + d.timeMs, 0),
    });

    const weekHeatmap = heatmap.filter((d) => d.date >= weekCutoff);
    const monthHeatmap = heatmap.filter((d) => d.date >= monthCutoff);

    const weekNewWords = filteredLanguageData
      .filter((d) => d.date >= weekCutoff)
      .reduce((s, d) => s + d.newWordsCount, 0);
    const monthNewWords = filteredLanguageData
      .filter((d) => d.date >= monthCutoff)
      .reduce((s, d) => s + d.newWordsCount, 0);

    return {
      week: { ...sum(weekHeatmap), newWords: weekNewWords },
      month: { ...sum(monthHeatmap), newWords: monthNewWords },
    };
  }, [dailyData?.heatmapData, filteredLanguageData]);

  const isLoading = pageData === undefined || dailyData === undefined;
  const cs = pageData?.courseStats;

  // Show whichever punctuation variant matches how the learner currently
  // scores their writing, so the number means what the app just told them it
  // means. Reviews recorded before the two series existed only exist in the
  // legacy pair, which is the fallback, otherwise the tile would vanish for
  // anyone who hasn't reviewed since the split shipped.
  const accuracy =
    cs && cs.totalAccuracyDualCount > 0
      ? {
          sum: pageData?.ignorePunctuation
            ? cs.totalAccuracyLenientSum
            : cs.totalAccuracyStrictSum,
          count: cs.totalAccuracyDualCount,
        }
      : { sum: cs?.totalAccuracySum ?? 0, count: cs?.totalAccuracyCount ?? 0 };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="scroll-view">
      <div className="app-view">
        <NumbersRow
          streak={cs?.currentStreak ?? 0}
          streakState={cs?.streakState ?? 'none'}
          words={cs?.totalWordCount ?? 0}
          reviews={cs?.totalRepetitions ?? 0}
          sentences={cs?.totalCards ?? 0}
          timeMs={cs?.totalTimeMs ?? 0}
          accuracySum={accuracy.sum}
          accuracyCount={accuracy.count}
          languageWordCounts={pageData?.languageWordCounts ?? []}
          todayReps={pageData?.todayReps ?? 0}
          todayNewCards={pageData?.todayNewCards ?? 0}
          todayTimeMs={pageData?.todayTimeMs ?? 0}
          todayNewWords={todayNewWords}
          weekReps={periodStats.week.reps}
          weekNewCards={periodStats.week.newCards}
          weekTimeMs={periodStats.week.timeMs}
          weekNewWords={periodStats.week.newWords}
          monthReps={periodStats.month.reps}
          monthNewCards={periodStats.month.newCards}
          monthTimeMs={periodStats.month.timeMs}
          monthNewWords={periodStats.month.newWords}
        />

        <CumulativeLineChart
          dailyData={(dailyData?.heatmapData ?? []).map((d) => ({
            date: d.date,
            reps: d.reps,
            newCards: d.newCards,
            timeMs: d.timeMs,
          }))}
          monthlyData={(pageData?.monthlyStats ?? []).map((m) => ({
            month: m.month,
            totalRepetitions: m.totalRepetitions,
            totalNewCards: m.totalNewCards,
            totalTimeMs: m.totalTimeMs,
          }))}
          weeklyData={(pageData?.weeklyStats ?? []).map((w) => ({
            week: w.week,
            totalRepetitions: w.totalRepetitions,
            totalNewCards: w.totalNewCards,
            totalTimeMs: w.totalTimeMs,
          }))}
          languageDailyData={filteredLanguageData}
          timezone={tz}
        />

        <WordCloudSection />

        <ActivityHeatmap data={dailyData?.heatmapData ?? []} timezone={tz} />

        <HourlyDistribution
          data={
            pageData?.hourlyDistribution ?? Array.from({ length: 24 }, () => 0)
          }
        />

        <AppUsageStats
          manualCards={cs?.totalCardsAddedManually ?? 0}
          chatCards={cs?.totalChatCardsApproved ?? 0}
          chatMessages={cs?.totalChatMessages ?? 0}
        />
      </div>
    </div>
  );
}
