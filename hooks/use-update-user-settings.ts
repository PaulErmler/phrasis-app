'use client';

import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

/**
 * Wraps `updateUserSettings` with an optimistic patch of `getUserSettings`,
 * so Preferences toggles (and anything else reading the account row) flip
 * in the same frame instead of lagging one round-trip.
 */
export function useUpdateUserSettings() {
  return useMutation(
    api.features.courses.updateUserSettings,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getUserSettings,
      {},
    );
    if (current === undefined || current === null) return;
    localStore.setQuery(api.features.courses.getUserSettings, {}, {
      ...current,
      ...args,
    });
  });
}
