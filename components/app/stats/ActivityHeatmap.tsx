'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

type HeatmapEntry = { date: string; reps: number };

interface ActivityHeatmapProps {
  data: HeatmapEntry[];
  timezone: string;
}

const CELL_YEAR = 'aspect-square w-full rounded-[2px]';
const CELL_FIXED = 'w-[11px] h-[11px] rounded-[2px]';

function getColor(count: number) {
  return count > 0 ? 'bg-primary/70' : 'bg-muted/40';
}

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

function YearView({ lookup, timezone }: { lookup: Map<string, number>; timezone: string }) {
  const todayDate = new Date();
  const weeks: string[][] = [];
  let week: string[] = [];
  for (let i = 363; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    week.push(formatDate(d, timezone));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push(week);

  return (
    <div
      className="grid gap-[2px]"
      style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }}
    >
      {weeks.map((w, wi) => (
        <div key={wi} className="flex flex-col gap-[2px]">
          {w.map((day) => (
            <div
              key={day}
              className={cn(CELL_YEAR, getColor(lookup.get(day) ?? 0))}
              title={`${day}: ${lookup.get(day) ?? 0}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function MonthView({ lookup, timezone }: { lookup: Map<string, number>; timezone: string }) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value) - 1;

  // Use UTC-constructed dates so day-of-week and day count don't depend on
  // the browser's local timezone; we're computing pure calendar values.
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  // Monday = 0, Sunday = 6
  const startDow = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-[3px] mb-[3px]">
        {dayLabels.map((label, i) => (
          <div key={i} className="text-[9px] text-muted-foreground text-center">
            {label}
          </div>
        ))}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="grid grid-cols-7 gap-[3px] mb-[3px]">
          {row.map((day, ci) => {
            if (day === null) return <div key={ci} className={cn(CELL_FIXED, 'opacity-0')} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const count = lookup.get(dateStr) ?? 0;
            return (
              <div
                key={ci}
                className={cn(CELL_FIXED, getColor(count))}
                title={`${dateStr}: ${count}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeekView({ lookup, timezone }: { lookup: Map<string, number>; timezone: string }) {
  const now = new Date();
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // Get the Monday of the current week
  const todayDow = (now.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(now);
  monday.setDate(monday.getDate() - todayDow);

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    days.push(formatDate(d, timezone));
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-[3px]">
        {days.map((day, i) => {
          const count = lookup.get(day) ?? 0;
          const dayNum = day.slice(8); // "DD"
          return (
            <div key={day} className="flex flex-col items-center gap-[3px]">
              <span className="text-[9px] text-muted-foreground">{dayLabels[i]}</span>
              <div
                className={cn(CELL_FIXED, getColor(count))}
                title={`${day}: ${count}`}
              />
              <span className="text-[9px] text-muted-foreground">{parseInt(dayNum, 10)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type HeatmapView = 'week' | 'month' | 'year';

export function ActivityHeatmap({ data, timezone }: ActivityHeatmapProps) {
  const t = useTranslations('StatsPage');
  const [view, setView] = useState<HeatmapView>('month');

  const lookup = useMemo(() => new Map(data.map((d) => [d.date, d.reps])), [data]);

  return (
    <div className="card-surface p-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-muted-foreground">
          {t('activity')}
        </p>
        <div className="flex gap-2 text-xs">
          {(['week', 'month', 'year'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'transition-colors',
                view === v ? 'text-primary font-medium' : 'text-muted-foreground',
              )}
            >
              {t(v)}
            </button>
          ))}
        </div>
      </div>

      {view === 'year' ? (
        <YearView lookup={lookup} timezone={timezone} />
      ) : view === 'week' ? (
        <WeekView lookup={lookup} timezone={timezone} />
      ) : (
        <MonthView lookup={lookup} timezone={timezone} />
      )}

      <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-muted-foreground">
        <div className="w-[9px] h-[9px] rounded-[2px] bg-muted/40" />
        <span>{t('inactive')}</span>
        <div className="w-[9px] h-[9px] rounded-[2px] bg-primary/70" />
        <span>{t('active')}</span>
      </div>
    </div>
  );
}
