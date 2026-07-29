'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import PaymentOverdueDialog from '@/components/autumn/payment-overdue-dialog';

/**
 * Keeps the local quota mirror fresh and renders the payment-overdue block.
 *
 * Mounted once from app/app/(main)/../layout.tsx (the shared /app layout) so
 * it covers every authenticated route — including /app/learn, which is a
 * standalone page outside the (main) route group and therefore used to get
 * neither the quota sync nor the overdue dialog.
 */

/**
 * How stale the mirror may get before a tab-focus refresh re-syncs it.
 * Autumn is only polled on mount and after usage tracking, so without this a
 * session left open never notices a payment failure — and, after the user
 * fixes their card in the Stripe billing portal, never notices the recovery
 * either. Focus-driven rather than an interval: no polling, no cron.
 */
const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Refocus/restore syncs while the payment block is up are retried a few
 * times. Paying the hosted invoice settles the debt in Stripe immediately,
 * but Autumn's subscription state only follows once Stripe's webhook lands,
 * so the first sync after the user returns often still reads past due — and
 * with no dismiss on the dialog, giving up after one attempt strands them
 * behind a block their payment already cleared.
 */
const PAST_DUE_RESYNC_ATTEMPTS = 3;
const PAST_DUE_RESYNC_DELAY_MS = 5_000;

export function BillingGate() {
  const syncQuotas = useAction(api.usage.actions.syncQuotas);
  const quotas = useQuery(api.usage.queries.getMyQuotas);

  // Read inside the event handlers without re-subscribing them on every
  // quota update.
  const lastSyncedAtRef = useRef<number | undefined>(undefined);
  lastSyncedAtRef.current = quotas?.lastSyncedAt;
  const pastDueRef = useRef(false);
  pastDueRef.current = quotas?.pastDue === true;

  const inFlight = useRef(false);
  const sync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await syncQuotas();
    } catch (err) {
      console.error('Failed to sync quotas:', err);
    } finally {
      inFlight.current = false;
    }
  }, [syncQuotas]);

  const didSyncOnMount = useRef(false);
  useEffect(() => {
    if (didSyncOnMount.current) return;
    didSyncOnMount.current = true;
    void sync();
  }, [sync]);

  /** One retry loop at a time — pageshow and visibilitychange can both fire
   *  on the same bfcache restore. */
  const resyncing = useRef(false);

  // Known trade-off (deferred with the other usageQuotas OCC items): this
  // refocus sync adds a writer to the usageQuotas hotspot, and its
  // syncAllFeatures overwrites `features` wholesale from an Autumn snapshot
  // taken BEFORE any mutation the user fires right after refocusing — a
  // concurrent decrement can be transiently reverted until the scheduled
  // post-track re-sync converges. Fix sketch if it ever bites: pass a
  // fetchedAt arg and skip the features overwrite when lastSyncedAt is newer.
  useEffect(() => {
    let cancelled = false;

    /** Sync until the block lifts, or the attempts run out. */
    const resyncWhileBlocked = async () => {
      if (resyncing.current) return;
      resyncing.current = true;
      try {
        for (let attempt = 0; attempt < PAST_DUE_RESYNC_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, PAST_DUE_RESYNC_DELAY_MS),
            );
            // Re-checked after the wait as well as after the sync: once the
            // block has lifted there is nothing left to poll for, and the
            // remaining attempts would be pure Autumn round-trips.
            if (cancelled || !pastDueRef.current) return;
          }
          await sync();
          if (cancelled || !pastDueRef.current) return;
        }
      } finally {
        resyncing.current = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      // A blocked user may have just paid — in the Stripe tab, or on the
      // invoice page this one navigated to. The staleness window must never
      // be what keeps a hard block up, so it is skipped entirely here.
      if (pastDueRef.current) {
        void resyncWhileBlocked();
        return;
      }
      const lastSyncedAt = lastSyncedAtRef.current;
      if (lastSyncedAt !== undefined && Date.now() - lastSyncedAt < STALE_AFTER_MS) {
        return;
      }
      void sync();
    };

    // Returning from the hosted invoice page via the Back button restores
    // this document from bfcache: no remount, so neither the mount sync nor
    // a fresh page load happens. `pageshow.persisted` is the signal that
    // always fires for that restore — and it is exactly the
    // paid-and-came-back path the block has to release.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && pastDueRef.current) void resyncWhileBlocked();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [sync]);

  return <PaymentOverdueDialog />;
}
