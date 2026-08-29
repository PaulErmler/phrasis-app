'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useFeatureQuota } from './useFeatureQuota';
import UsageLimitDialog from '@/components/autumn/usage-limit-dialog';

/**
 * The open-a-UsageLimitDialog half of the quota-lock scaffold: state + the
 * dialog element, nothing else. For surfaces that only need to SHOW the
 * paywall in response to something (a server USAGE_LIMIT, an upgrade
 * button) without subscribing to quota state.
 */
export function useLimitDialog(featureId: string): {
  openLimitDialog: () => void;
  /** null until opened; mount it once near the control. */
  limitDialog: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const openLimitDialog = useCallback(() => setOpen(true), []);
  return {
    openLimitDialog,
    limitDialog: open ? (
      <UsageLimitDialog open={open} setOpen={setOpen} featureId={featureId} />
    ) : null,
  };
}

/**
 * Full quota-lock scaffold for feature-gated controls: one implementation of
 * "locked" (quota exhausted and known) on top of useLimitDialog. The mic
 * buttons render this instead of hand-rolling the useFeatureQuota +
 * useState + UsageLimitDialog trio.
 */
export function useFeatureLock(featureId: string): {
  isLocked: boolean;
  openLimitDialog: () => void;
  limitDialog: ReactNode;
} {
  const { isAvailable, isLoading } = useFeatureQuota(featureId);
  const { openLimitDialog, limitDialog } = useLimitDialog(featureId);
  return {
    isLocked: !isAvailable && !isLoading,
    openLimitDialog,
    limitDialog,
  };
}
