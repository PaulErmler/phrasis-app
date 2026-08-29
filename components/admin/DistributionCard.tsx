'use client';

export interface DistributionRow {
  label: string;
  count: number;
  sublabel?: string;
}

interface DistributionCardProps {
  title: string;
  rows: DistributionRow[];
  isLoading?: boolean;
  headline?: string;
  maxRows?: number;
}

/**
 * Horizontal proportional bars for a categorical count breakdown
 * (magnitude job → single hue; labels wear text tokens).
 */
export function DistributionCard({
  title,
  rows,
  isLoading,
  headline,
  maxRows = 12,
}: DistributionCardProps) {
  const shown = rows.slice(0, maxRows);
  const hidden = rows.length - shown.length;
  const max = Math.max(1, ...shown.map((r) => r.count));

  return (
    <div className="card-surface p-3">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-muted-foreground">{title}</p>
        {headline && (
          <p className="text-sm font-semibold tabular-nums">{headline}</p>
        )}
      </div>
      {isLoading ? (
        <div className="py-6 text-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : shown.length === 0 ? (
        <div className="py-6 text-center text-muted-foreground text-sm">
          No data
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((row) => (
            <div key={`${row.label}-${row.sublabel ?? ''}`} className="text-xs">
              <div className="flex items-baseline justify-between mb-0.5">
                <span className="font-medium truncate">
                  {row.label}
                  {row.sublabel && (
                    <span className="text-muted-foreground font-normal">
                      {' '}
                      · {row.sublabel}
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-muted-foreground ml-2 shrink-0">
                  {row.count.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(2, (row.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
          {hidden > 0 && (
            <p className="text-xs text-muted-foreground pt-1">+{hidden} more</p>
          )}
        </div>
      )}
    </div>
  );
}
