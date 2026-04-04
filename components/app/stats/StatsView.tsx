'use client';

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { getUserTimezone } from '@/lib/timezone';
import { NumbersRow } from './NumbersRow';
import { CumulativeLineChart } from './CumulativeLineChart';
import { ActivityHeatmap } from './ActivityHeatmap';
import { HourlyDistribution } from './HourlyDistribution';
import { AppUsageStats } from './AppUsageStats';

function today(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

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
  const todayStr = today(tz);
  const yearStartStr = yearStart();

  // Query 1: Small summary data (courseStats, todayReps, hourly, monthly, weekly)
  const pageData = useQuery(api.features.stats.getStatsPageData, {
    timezone: tz,
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
  const filteredLanguageData = useMemo(() => {
    if (!dailyData?.languageDailyData?.length || !pageData?.targetLanguages) return [];
    const targetSet = new Set(pageData.targetLanguages.map((l: string) => l.replace(/_latam$/, '')));
    return dailyData.languageDailyData.filter((d) => targetSet.has(d.language.replace(/_latam$/, '')));
  }, [dailyData?.languageDailyData, pageData?.targetLanguages]);

  const todayNewWords = useMemo(() => {
    if (!filteredLanguageData.length) return 0;
    return filteredLanguageData
      .filter((d) => d.date === todayStr)
      .reduce((sum, d) => sum + d.newWordsCount, 0);
  }, [filteredLanguageData, todayStr]);

  const isLoading = pageData === undefined;
  const cs = pageData?.courseStats;

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
          words={cs?.totalWordCount ?? 0}
          reviews={cs?.totalRepetitions ?? 0}
          sentences={cs?.totalCards ?? 0}
          timeMs={cs?.totalTimeMs ?? 0}
          accuracySum={cs?.totalAccuracySum ?? 0}
          accuracyCount={cs?.totalAccuracyCount ?? 0}
          hasLearnedToday={(pageData?.todayReps ?? 0) > 0}
          languageWordCounts={pageData?.languageWordCounts ?? []}
          todayReps={pageData?.todayReps ?? 0}
          todayNewCards={pageData?.todayNewCards ?? 0}
          todayTimeMs={pageData?.todayTimeMs ?? 0}
          todayNewWords={todayNewWords}
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
        />

        <ActivityHeatmap
          data={dailyData?.heatmapData ?? []}
          timezone={tz}
        />

        <HourlyDistribution data={pageData?.hourlyDistribution ?? Array.from({ length: 24 }, () => 0)} />

        <AppUsageStats
          manualCards={cs?.totalCardsAddedManually ?? 0}
          chatCards={cs?.totalChatCardsApproved ?? 0}
          chatMessages={cs?.totalChatMessages ?? 0}
        />
      </div>
    </div>
  );
}
