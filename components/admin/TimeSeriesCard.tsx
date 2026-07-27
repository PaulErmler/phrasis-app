'use client';

import { Area, AreaChart, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';

export interface TimeSeriesPoint {
  date: string; // "YYYY-MM-DD"
  value: number;
  /** Optional extra lines shown in the tooltip, e.g. { reviews: 120 } */
  extra?: Record<string, number | string>;
}

interface TimeSeriesCardProps {
  title: string;
  data: TimeSeriesPoint[];
  valueLabel: string;
  isLoading?: boolean;
  headline?: string;
}

/**
 * Single-series area chart over calendar days, matching the stats-page
 * chart idiom (primary hue, recessive grid/axes, hover tooltip).
 */
export function TimeSeriesCard({
  title,
  data,
  valueLabel,
  isLoading,
  headline,
}: TimeSeriesCardProps) {
  const chartConfig: ChartConfig = {
    value: { label: valueLabel, color: 'var(--primary)' },
  };
  const gradientId = `fill-${title.replace(/\s+/g, '-').toLowerCase()}`;

  const chartData = data.map((d) => ({
    ...d,
    label: d.date.slice(5), // "MM-DD"
  }));

  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload?: TimeSeriesPoint & { label: string } }>;
  }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    if (!point) return null;
    return (
      <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
        <p className="font-medium text-muted-foreground mb-1">{point.date}</p>
        <p className="tabular-nums font-medium">
          {point.value.toLocaleString()}{' '}
          <span className="text-muted-foreground font-normal">{valueLabel}</span>
        </p>
        {point.extra &&
          Object.entries(point.extra).map(([key, value]) => (
            <p key={key} className="tabular-nums text-muted-foreground">
              {typeof value === 'number' ? value.toLocaleString() : value} {key}
            </p>
          ))}
      </div>
    );
  };

  return (
    <div className="card-surface p-3">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-muted-foreground">{title}</p>
        {headline && (
          <p className="text-sm font-semibold tabular-nums">{headline}</p>
        )}
      </div>
      {isLoading ? (
        <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="h-[180px] w-full">
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
              width={36}
              allowDecimals={false}
            />
            <ChartTooltip content={renderTooltip} />
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--primary)"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}
