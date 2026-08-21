import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BillingGate } from '@/components/app/BillingGate';

/**
 * BillingGate is the only thing that refreshes the local quota mirror outside
 * of usage tracking, so its triggers cut both ways financially: syncing too
 * eagerly turns every render / tab switch into an Autumn round-trip plus a
 * syncAllFeatures write on the usageQuotas OCC hotspot, while not syncing
 * means a long-idle session never notices a failed payment (usage keeps
 * flowing for free), and a user who already FIXED their card stays trapped
 * behind the hard-block overdue dialog.
 *
 * The real PaymentOverdueDialog is deliberately left in place (not mocked):
 * it reads the same mocked useQuery / usePathname, and with pastDue false it
 * must render nothing, which doubles as coverage that healthy users mounting
 * the gate app-wide never see the block.
 */

const syncQuotasMock = vi.fn();
const useQueryMock = vi.fn();
vi.mock('convex/react', () => ({
  // The overdue dialog's inner component has its own useAction (the cancel
  // action), but it only fires on click, so every call recorded here is the
  // gate's syncQuotas.
  useAction: () => syncQuotasMock,
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

// Only needed so the real overdue dialog can mount in the past-due cases.
// useCustomer() would otherwise demand an AutumnProvider.
vi.mock('autumn-js/react', () => ({
  useCustomer: () => ({
    openBillingPortal: vi.fn(),
    refetch: vi.fn().mockResolvedValue(null),
  }),
}));

const NOW = new Date('2026-07-26T12:00:00Z').getTime();
const MINUTE = 60_000;

/** Healthy-plan quotas: keeps the nested PaymentOverdueDialog unmounted. */
function quotas(lastSyncedAt: number) {
  return {
    features: {},
    lastSyncedAt,
    planStatus: 'active',
    pastDue: false,
    activeCourseCount: 0,
  };
}

/** Past-due quotas: the hard block is up, so the dialog mounts. */
function pastDueQuotas(lastSyncedAt: number) {
  return {
    features: {},
    lastSyncedAt,
    planStatus: 'past_due',
    pastDue: true,
    pastDueSince: lastSyncedAt - MINUTE,
    activeCourseCount: 1,
  };
}

/** bfcache restore: jsdom has no PageTransitionEvent constructor. */
function firePageShow(persisted: boolean) {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted });
  act(() => {
    window.dispatchEvent(event);
  });
}

function fireVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Settle the in-flight sync's catch/finally chain (microtasks only). */
const flushSync = () => act(async () => {});

beforeEach(() => {
  // Fake Date so STALE_AFTER_MS comparisons are exact, not wall-clock races.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  syncQuotasMock.mockReset();
  syncQuotasMock.mockResolvedValue(null);
  useQueryMock.mockReset();
  useQueryMock.mockReturnValue(quotas(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  // Drop the own-property shadow so jsdom's prototype getter is back.
  delete (document as { visibilityState?: string }).visibilityState;
});

describe('BillingGate', () => {
  it('syncs exactly once on mount and stays quiet across re-renders', async () => {
    const { rerender } = render(<BillingGate />);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);

    // Every quota update re-renders the gate; a per-render sync would feed
    // the very usageQuotas write conflicts the mirror exists to avoid.
    rerender(<BillingGate />);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);

    // pastDue false -> the app-wide dunning block must not appear.
    expect(screen.queryByTestId('payment-overdue-dialog')).toBeNull();
  });

  it('skips the refocus sync while the mirror is fresh', async () => {
    useQueryMock.mockReturnValue(quotas(NOW - 1 * MINUTE));
    render(<BillingGate />);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);

    // A fresh mirror means Autumn was just consulted; re-hitting it on every
    // tab switch would turn focus changes into de-facto API polling.
    fireVisibility('visible');
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);
  });

  it('re-syncs on refocus once the mirror is stale', async () => {
    useQueryMock.mockReturnValue(quotas(NOW - 11 * MINUTE));
    render(<BillingGate />);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);

    // Backgrounding fires visibilitychange too. Syncing on hide would double
    // every refresh for zero benefit (nobody is looking at the tab).
    fireVisibility('hidden');
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);

    // Stale + visible is the one signal a long-idle session has to notice a
    // payment failure, or, after the card was fixed in Stripe, the recovery
    // that lifts the hard block.
    fireVisibility('visible');
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(2);
  });

  it('dedupes a refocus that lands while a sync is still in flight', async () => {
    useQueryMock.mockReturnValue(quotas(NOW - 11 * MINUTE));
    let resolveFirst!: () => void;
    syncQuotasMock.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        resolveFirst = () => resolve(null);
      }),
    );

    render(<BillingGate />);
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);

    // The mount sync is still awaiting Autumn; letting a second one start now
    // would race two syncAllFeatures writers on the same usageQuotas row, and
    // whichever snapshot lands last wins. Possibly the older one.
    fireVisibility('visible');
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst();
    });

    // Dedupe is per-flight, not a latch: once settled, staleness must be able
    // to trigger a fresh sync again.
    fireVisibility('visible');
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(2);
  });

  it('ignores the staleness window on refocus while the block is up', async () => {
    // The mirror is FRESH, so the healthy-path guard would skip this sync,
    // but a blocked user has no dismiss button, and the thing they were just
    // sent off to do (pay the hosted invoice) is settled elsewhere. Making
    // them wait out a 10-minute window before the app notices leaves them
    // staring at a hard block their payment already cleared.
    useQueryMock.mockReturnValue(pastDueQuotas(NOW));
    render(<BillingGate />);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('payment-overdue-dialog')).toBeInTheDocument();

    fireVisibility('visible');
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(2);
  });

  it('retries after a bfcache restore, absorbing the Stripe webhook lag', async () => {
    // Paying navigates this tab to the Stripe invoice page; Back restores it
    // from bfcache with no remount, so nothing else re-syncs. Stripe settles
    // the invoice synchronously but Autumn only follows once the webhook
    // lands, so the first sync back usually still reads past due. One shot
    // would leave the block up on the happy path.
    useQueryMock.mockReturnValue(pastDueQuotas(NOW));
    render(<BillingGate />);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);

    firePageShow(true);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(2);

    // Still past due after the first retry. Keep going, but only for the
    // bounded number of attempts (no open-ended polling of Autumn).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(syncQuotasMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(syncQuotasMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(syncQuotasMock).toHaveBeenCalledTimes(4);
  });

  it('stops retrying the moment the payment lands', async () => {
    useQueryMock.mockReturnValue(pastDueQuotas(NOW));
    const { rerender } = render(<BillingGate />);
    await flushSync();
    firePageShow(true);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(2);

    // That sync cleared pastDueSince server-side; the block is gone. Burning
    // the remaining attempts would be Autumn round-trips for a user who is
    // no longer blocked by anything.
    useQueryMock.mockReturnValue(quotas(NOW));
    rerender(<BillingGate />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(syncQuotasMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('payment-overdue-dialog')).toBeNull();
  });

  it('ignores a bfcache restore while the plan is healthy', async () => {
    // pageshow fires on every back-navigation in the app, not just the
    // return from Stripe. Syncing on all of them would make ordinary
    // browsing an Autumn poll.
    render(<BillingGate />);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);

    firePageShow(true);
    await flushSync();
    expect(syncQuotasMock).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows a failed sync without wedging future syncs', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      useQueryMock.mockReturnValue(quotas(NOW - 11 * MINUTE));
      syncQuotasMock.mockRejectedValueOnce(new Error('autumn 502'));

      render(<BillingGate />);
      await flushSync();

      // The gate wraps every authenticated route; an Autumn blip crashing it
      // (or surfacing as an unhandled rejection) would take the app down over
      // a best-effort refresh. Vitest fails this test on any unhandled
      // rejection, so reaching these assertions IS the no-throw proof.
      expect(syncQuotasMock).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to sync quotas:',
        expect.any(Error),
      );

      // finally{} must release the in-flight latch even on error, otherwise
      // one bad response disables billing refresh until a full reload, and an
      // overdue user is never blocked (or an unblocked user never released).
      fireVisibility('visible');
      await flushSync();
      expect(syncQuotasMock).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});
