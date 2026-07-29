'use client';

import { NumbersRow } from '@/components/app/stats/NumbersRow';
import { CumulativeLineChart } from '@/components/app/stats/CumulativeLineChart';
import { ActivityHeatmap } from '@/components/app/stats/ActivityHeatmap';
import { HourlyDistribution } from '@/components/app/stats/HourlyDistribution';
import { AppUsageStats } from '@/components/app/stats/AppUsageStats';
import { PhoneShell } from '../PhoneShell';
import {
  HERO_STATS,
  HOURLY_DISTRIBUTION,
  dailySeries,
  languageDailySeries,
  weeklySeries,
} from '../fixtures';

/**
 * Real StatsView building blocks (all pure/prop-driven) fed with mock data —
 * mirrors the layout of components/app/stats/StatsView.tsx minus the
 * Convex-backed word cloud.
 */
export function StatsScreen() {
  const tz = 'Europe/Berlin';
  const s = HERO_STATS;
  const daily = dailySeries();
  const heatmap = daily.map(({ date, reps }) => ({ date, reps }));

  return (
    <PhoneShell activeView="stats">
      <div className="scroll-view">
        <div className="app-view">
          <NumbersRow
            streak={s.streak}
            streakState="active"
            words={s.words}
            reviews={s.reps}
            sentences={s.sentences}
            timeMs={s.timeMs}
            accuracySum={s.accuracyPct / 100 * 250}
            accuracyCount={250}
            languageWordCounts={[{ language: 'es', words: 2038 }]}
            todayReps={s.todayReps}
            todayNewCards={s.todayNewCards}
            todayTimeMs={s.todayTimeMs}
            todayNewWords={s.todayNewWords}
            weekReps={1094}
            weekNewCards={71}
            weekTimeMs={6 * 3600_000 + 45 * 60_000}
            weekNewWords={188}
            monthReps={4630}
            monthNewCards={296}
            monthTimeMs={28 * 3600_000 + 30 * 60_000}
            monthNewWords={782}
          />

          <CumulativeLineChart
            dailyData={daily}
            monthlyData={[]}
            weeklyData={weeklySeries()}
            languageDailyData={languageDailySeries()}
            timezone={tz}
          />

          <ActivityHeatmap data={heatmap} timezone={tz} />

          <HourlyDistribution data={HOURLY_DISTRIBUTION} />

          <AppUsageStats manualCards={412} chatCards={286} chatMessages={731} />
        </div>
      </div>
    </PhoneShell>
  );
}
