'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

type HeatmapEntry = { date: string; reps: number };

interface ActivityHeatmapProps {
  data: HeatmapEntry[];
  timezone: string;
}

const CELL = 'w-[11px] h-[11px] rounded-[2px]';

function getColor(count: number) {
  return count > 0 ? 'bg-primary/70' : 'bg-muted/40';
}

function YearView({ lookup }: { lookup: Map<string, number> }) {
  const todayDate = new Date();
  const weeks: string[][] = [];
  let week: string[] = [];
  for (let i = 363; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    week.push(d.toISOString().slice(0, 10));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push(week);

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex gap-[3px]" style={{ minWidth: weeks.length * 15 }}>
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {w.map((day) => (
              <div
                key={day}
                className={cn(CELL, getColor(lookup.get(day) ?? 0))}
                title={`${day}: ${lookup.get(day) ?? 0}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthView({ lookup }: { lookup: Map<string, number> }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Monday = 0, Sunday = 6
  const startDow = (firstDay.getDay() + 6) % 7;

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
            if (day === null) return <div key={ci} className={cn(CELL, 'opacity-0')} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const count = lookup.get(dateStr) ?? 0;
            return (
              <div
                key={ci}
                className={cn(CELL, getColor(count))}
                title={`${dateStr}: ${count}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeekView({ lookup }: { lookup: Map<string, number> }) {
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
    days.push(d.toISOString().slice(0, 10));
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
                className={cn(CELL, getColor(count))}
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
        <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
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
        <YearView lookup={lookup} />
      ) : view === 'week' ? (
        <WeekView lookup={lookup} />
      ) : (
        <MonthView lookup={lookup} />
      )}

      <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-muted-foreground">
        <div className={cn(CELL, 'bg-muted/40')} />
        <span>{t('inactive')}</span>
        <div className={cn(CELL, 'bg-primary/70')} />
        <span>{t('active')}</span>
      </div>
    </div>
  );
}
