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
 */
export function useFeatureQuota(featureId: string): FeatureQuotaInfo {
  const quotas = useQuery(api.usage.queries.getMyQuotas);

  if (quotas === undefined) {
    return {
      balance: 0,
      included: 0,
      used: 0,
      unlimited: false,
      isAvailable: true,
      isLoading: true,
    };
  }

  if (quotas === null) {
    return {
      balance: 0,
      included: 0,
      used: 0,
      unlimited: false,
      isAvailable: false,
      isLoading: false,
    };
  }

  const feature = quotas.features[featureId];
  if (!feature) {
    return {
      balance: 0,
      included: 0,
      used: 0,
      unlimited: false,
      isAvailable: false,
      isLoading: false,
    };
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
