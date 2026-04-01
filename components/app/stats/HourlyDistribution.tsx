'use client';

import { useTranslations } from 'next-intl';

interface HourlyDistributionProps {
  data: number[];
}

export function HourlyDistribution({ data }: HourlyDistributionProps) {
  const t = useTranslations('StatsPage');
  const total = data.reduce((a, b) => a + b, 0);
  const hasData = total > 0;

  if (!hasData) return null;

  const percentages = data.map((count) => (count / total) * 100);
  const maxPct = Math.max(...percentages);

  return (
    <div className="card-surface p-3">
      <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {t('studyHours')}
      </p>
      <div className="flex">
        {/* Y axis */}
        <div className="flex flex-col justify-between pr-1.5 shrink-0" style={{ height: 96 }}>
          {[maxPct, maxPct / 2, 0].map((tick, i) => (
            <span key={i} className="text-[9px] text-muted-foreground tabular-nums leading-none text-right" style={{ minWidth: 24 }}>
              {Math.round(tick)}%
            </span>
          ))}
        </div>
        {/* Bars */}
        <div className="flex-1 flex items-end gap-[2px]" style={{ height: 96 }}>
          {percentages.map((pct, hour) => {
            const barHeight = pct > 0 ? Math.max((pct / maxPct) * 100, 4) : 0;
            return (
              <div key={hour} className="flex-1 h-full flex flex-col justify-end items-center">
                <div
                  className="w-full bg-primary/70 rounded-t-sm"
                  style={{ height: `${barHeight}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
      {/* X axis labels */}
      <div className="flex" style={{ paddingLeft: 32 }}>
        <div className="flex-1 flex gap-[2px] mt-1">
          {data.map((_, hour) => (
            <div key={hour} className="flex-1 text-center">
              {hour % 4 === 0 && (
                <span className="text-[9px] text-muted-foreground">{hour}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
