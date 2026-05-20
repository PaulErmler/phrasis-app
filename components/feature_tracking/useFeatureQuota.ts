'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

export interface FeatureQuotaInfo {
  balance: number;
  included: number;
  used: number;
  unlimited: boolean;
  isAvailable: boolean;
  isLoading: boolean;
}

/**
 * Reactive hook for a single feature's quota state, powered by the Convex
 * `usageQuotas` table. Defaults to available while loading so the UI doesn't
 * flash a false "locked" state -- the server mutation is the authoritative gate.
 *
 * Note: `getMyQuotas` returns `null` both when the user is unauthenticated and
 * when their `usageQuotas` row hasn't been synced yet (syncQuotas runs as a
 * side effect on app mount and can take hundreds of ms). The same goes for a
 * feature that just isn't in the synced map yet. We treat both as transient
 * loading so the +Add / call-to-action button doesn't flash from gated to
 * enabled while sync completes.
 */
export function useFeatureQuota(featureId: string): FeatureQuotaInfo {
  const quotas = useQuery(api.usage.queries.getMyQuotas);

  const loadingFallback: FeatureQuotaInfo = {
    balance: 0,
    included: 0,
    used: 0,
    unlimited: false,
    isAvailable: true,
    isLoading: true,
  };

  if (quotas === undefined || quotas === null) {
    return loadingFallback;
  }

  const feature = quotas.features[featureId];
  if (!feature) {
    return loadingFallback;
  }

  return {
    balance: feature.balance,
    included: feature.included,
    used: feature.used,
    unlimited: feature.unlimited ?? false,
    isAvailable: feature.unlimited === true || feature.balance > 0,
    isLoading: false,
  };
}
