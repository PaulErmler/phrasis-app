'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * One preset tile of a daily-goal picker — the shared visual between the
 * onboarding goal step and the homescreen quick-edit (which differ in grid
 * layout and commit semantics, but must look identical per tile).
 */
export function GoalPresetTile({
  active,
  onClick,
  children,
  'data-testid': testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'flex min-h-9 items-center justify-center rounded-md border text-xs font-medium tabular-nums transition-colors',
        active
          ? 'border-primary/30 bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
