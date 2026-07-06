'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { CREDIT_COSTS, FEATURE_IDS, type FeatureId } from '@/convex/features/featureIds';

export interface FeatureQuotaInfo {
  balance: number;
  included: number;
  used: number;
  unlimited: boolean;
  isAvailable: boolean;
  isLoading: boolean;
}

/** Zeroed quota fields shared by the two "no feature data" return paths. */
const EMPTY_QUOTA = { balance: 0, included: 0, used: 0, unlimited: false };

/**
 * Reactive hook for a single feature's quota state, powered by the Convex
 * `usageQuotas` table.
 *
 * `getMyQuotas` returns `null` while the query is in flight, when the user is
 * unauthenticated, or when their `usageQuotas` row hasn't been synced yet
 * (syncQuotas runs as a side effect on app mount and can take hundreds of ms).
 * That is the only genuinely transient state, so we stay optimistic there to
 * avoid flashing a false "locked" state during the brief on-mount sync.
 *
 * Once the doc IS loaded, an absent feature is NOT mid-sync: `syncAllFeatures`
 * overwrites the entire `features` map in a single write, so every granted
 * feature is present together. An absent key therefore means the plan simply
 * doesn't grant the feature -- we mirror the backend `hasFeatureAccess`
 * (absent + synced => unavailable). Returning the optimistic fallback here was
 * the bug that let free users see un-granted boolean features (e.g.
 * `multiple_languages`) as available and hit a server-side rejection.
 */
export function useFeatureQuota(featureId: string): FeatureQuotaInfo {
  const quotas = useQuery(api.usage.queries.getMyQuotas);

  if (quotas === undefined || quotas === null) {
    return { ...EMPTY_QUOTA, isAvailable: true, isLoading: true };
  }

  // Credit-consuming features draw from the shared `credits` balance when
  // the user's plan grants one (mirrors `resolveQuotaTarget` in
  // convex/usage/helpers.ts), expressed in feature units (credits / cost).
  // Legacy plan versions have per-feature balances and no `credits` entry,
  // so they fall through to the direct lookup below.
  const creditCost = CREDIT_COSTS[featureId as FeatureId];
  const credits = quotas.features[FEATURE_IDS.CREDITS];
  if (creditCost !== undefined && credits) {
    return {
      balance: Math.floor(credits.balance / creditCost),
      included: Math.floor(credits.included / creditCost),
      used: Math.floor(credits.used / creditCost),
      unlimited: credits.unlimited ?? false,
      isAvailable: credits.unlimited === true || credits.balance >= creditCost,
      isLoading: false,
    };
  }

  const feature = quotas.features[featureId];
  if (!feature) {
    return { ...EMPTY_QUOTA, isAvailable: false, isLoading: false };
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
