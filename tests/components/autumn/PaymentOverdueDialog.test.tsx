import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaymentOverdueDialog from '@/components/autumn/payment-overdue-dialog';

const useQueryMock = vi.fn();
const cancelOverdueMock = vi.fn();
vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: () => cancelOverdueMock,
}));

const openBillingPortalMock = vi.fn();
const refetchMock = vi.fn();
vi.mock('autumn-js/react', () => ({
  useCustomer: () => ({
    openBillingPortal: openBillingPortalMock,
    refetch: refetchMock,
  }),
}));

const pathnameMock = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

const FEATURES = { chat_messages: { balance: 1, included: 1, used: 0 } };

function quotas(overrides: Record<string, unknown>) {
  return {
    features: FEATURES,
    lastSyncedAt: Date.now(),
    pastDue: false,
    activeCourseCount: 0,
    ...overrides,
  };
}

const pastDueQuotas = (overrides: Record<string, unknown> = {}) =>
  quotas({
    planStatus: 'past_due',
    pastDue: true,
    pastDueSince: Date.now() - 60_000,
    activeCourseCount: 3,
    ...overrides,
  });

/** jsdom refuses real navigation; capture the assignment instead. */
function captureLocationHref() {
  const assigned: string[] = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      set href(v: string) {
        assigned.push(v);
      },
      get href() {
        return 'http://localhost/app';
      },
    },
  });
  return assigned;
}

/** Walk the confirmation step and fire the destructive cancel. */
async function clickThroughCancel() {
  await userEvent.click(screen.getByTestId('payment-overdue-cancel'));
  await userEvent.click(screen.getByTestId('payment-overdue-cancel-confirm'));
}

beforeEach(() => {
  useQueryMock.mockReset();
  openBillingPortalMock.mockReset();
  openBillingPortalMock.mockResolvedValue({ data: { url: 'x' }, error: null });
  refetchMock.mockReset();
  refetchMock.mockResolvedValue(null);
  cancelOverdueMock.mockReset();
  cancelOverdueMock.mockResolvedValue({
    outcome: 'cancelled',
    cancelledProductId: 'basic_annual',
  });
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  pathnameMock.mockReset();
  pathnameMock.mockReturnValue('/app');
});

describe('PaymentOverdueDialog', () => {
  it('renders nothing when the plan is healthy', () => {
    useQueryMock.mockReturnValue(quotas({ planStatus: 'active' }));
    render(<PaymentOverdueDialog />);
    expect(screen.queryByTestId('payment-overdue-dialog')).toBeNull();
  });

  it('renders nothing while quotas are still loading', () => {
    useQueryMock.mockReturnValue(undefined);
    render(<PaymentOverdueDialog />);
    expect(screen.queryByTestId('payment-overdue-dialog')).toBeNull();
  });

  it('renders nothing on /app/admin so admins keep the dashboard', () => {
    pathnameMock.mockReturnValue('/app/admin/users/abc');
    useQueryMock.mockReturnValue(pastDueQuotas());
    render(<PaymentOverdueDialog />);
    expect(screen.queryByTestId('payment-overdue-dialog')).toBeNull();
  });

  it('blocks immediately: no dismiss button, no close X, escape ignored', async () => {
    useQueryMock.mockReturnValue(pastDueQuotas());
    render(<PaymentOverdueDialog />);

    expect(screen.getByTestId('payment-overdue-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('payment-overdue-notice').textContent).toBe(
      'blockedDescription',
    );
    expect(screen.queryByTestId('payment-overdue-dismiss')).toBeNull();
    // shadcn's DialogContent close X renders a "Close" sr-only label.
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(screen.getByTestId('payment-overdue-dialog')).toBeInTheDocument();
  });

  it('sends the user to the hosted invoice when one exists', async () => {
    const url = 'https://invoice.stripe.com/i/abc';
    useQueryMock.mockReturnValue(pastDueQuotas({ pastDueInvoiceUrl: url }));
    const assigned = captureLocationHref();

    render(<PaymentOverdueDialog />);
    expect(screen.getByTestId('payment-overdue-pay').textContent).toContain(
      'payInvoiceButton',
    );
    await userEvent.click(screen.getByTestId('payment-overdue-pay'));

    expect(assigned).toEqual([url]);
    // Paying the invoice is the settlement path. The portal only swaps cards.
    expect(openBillingPortalMock).not.toHaveBeenCalled();
  });

  it('falls back to the billing portal when no invoice URL was captured', async () => {
    useQueryMock.mockReturnValue(pastDueQuotas());
    render(<PaymentOverdueDialog />);

    expect(screen.getByTestId('payment-overdue-pay').textContent).toContain(
      'payButton',
    );
    await userEvent.click(screen.getByTestId('payment-overdue-pay'));
    expect(openBillingPortalMock).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: expect.any(String) }),
    );
  });

  it('surfaces a portal failure without releasing the block', async () => {
    // The portal is the only exit for users without a captured invoice URL.
    // If it fails silently they are stuck in a hard block with a dead
    // button and no idea why. The toast is the only feedback they get,
    // and the buttons must come back so they can retry.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useQueryMock.mockReturnValue(pastDueQuotas());
    render(<PaymentOverdueDialog />);

    // Autumn-style soft failure: resolves with an error payload.
    openBillingPortalMock.mockResolvedValue({
      error: { message: 'no stripe' },
    });
    await userEvent.click(screen.getByTestId('payment-overdue-pay'));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('portalError'),
    );
    expect(screen.getByTestId('payment-overdue-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('payment-overdue-pay')).toBeEnabled();

    // Hard failure: network throw. Same contract. Toast, still blocked.
    openBillingPortalMock.mockRejectedValue(new Error('offline'));
    await userEvent.click(screen.getByTestId('payment-overdue-pay'));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(2));
    expect(toastErrorMock).toHaveBeenLastCalledWith('portalError');
    expect(screen.getByTestId('payment-overdue-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('payment-overdue-pay')).toBeEnabled();
    errorSpy.mockRestore();
  });

  it('cancel is behind a confirmation that warns about course archival', async () => {
    useQueryMock.mockReturnValue(pastDueQuotas({ activeCourseCount: 3 }));
    render(<PaymentOverdueDialog />);

    await userEvent.click(screen.getByTestId('payment-overdue-cancel'));
    // Confirmation replaces the primary actions, no accidental cancel.
    expect(
      screen.getByTestId('payment-overdue-cancel-warning'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('payment-overdue-pay')).toBeNull();
    expect(cancelOverdueMock).not.toHaveBeenCalled();

    // Backing out returns to the block without cancelling.
    await userEvent.click(screen.getByTestId('payment-overdue-cancel-back'));
    expect(screen.getByTestId('payment-overdue-pay')).toBeInTheDocument();
    expect(cancelOverdueMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('payment-overdue-cancel'));
    await userEvent.click(screen.getByTestId('payment-overdue-cancel-confirm'));
    expect(cancelOverdueMock).toHaveBeenCalledWith({});
  });

  it('uses the no-courses warning when nothing would be archived', async () => {
    useQueryMock.mockReturnValue(pastDueQuotas({ activeCourseCount: 1 }));
    render(<PaymentOverdueDialog />);

    await userEvent.click(screen.getByTestId('payment-overdue-cancel'));
    expect(
      screen.getByTestId('payment-overdue-cancel-warning').textContent,
    ).toBe('cancelWarningNoCourses');
  });

  it('refetches the Autumn customer only after the cancel settled', async () => {
    // The refetch exists so /app/settings stops showing the cancelled plan.
    // Firing it before the server finished would cache the OLD subscription
    // state. The user would see themselves still subscribed to a plan the
    // server just destroyed. Order is the contract.
    useQueryMock.mockReturnValue(pastDueQuotas());
    let resolveCancel!: (v: unknown) => void;
    cancelOverdueMock.mockImplementation(
      () => new Promise((r) => (resolveCancel = r)),
    );
    render(<PaymentOverdueDialog />);

    await clickThroughCancel();
    expect(cancelOverdueMock).toHaveBeenCalledWith({});
    expect(refetchMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveCancel({
        outcome: 'cancelled',
        cancelledProductId: 'basic_annual',
      });
    });
    expect(refetchMock).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith('cancelSuccess');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('tells the user their payment arrived when the server refused to cancel', async () => {
    // The cancel-after-pay race: the user paid the invoice, then clicked
    // Cancel out of confusion. The server detects the settled debt and
    // returns 'recovered' instead of destroying the subscription they just
    // paid for. The UI must say "payment received", not "cancelled", or
    // the user will believe their money bought them a cancellation.
    useQueryMock.mockReturnValue(pastDueQuotas());
    cancelOverdueMock.mockResolvedValue({ outcome: 'recovered' });
    render(<PaymentOverdueDialog />);

    await clickThroughCancel();
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith('paymentReceived'),
    );
    expect(toastSuccessMock).not.toHaveBeenCalledWith('cancelSuccess');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('a failed cancel resets the confirm step and keeps the block up', async () => {
    // If the cancel action throws, the subscription still exists and money
    // is still owed. The block must stay, and the user must land back on
    // the pay/cancel choice (not a stuck confirm step) to try again.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useQueryMock.mockReturnValue(pastDueQuotas());
    cancelOverdueMock.mockRejectedValue(new Error('convex down'));
    render(<PaymentOverdueDialog />);

    await clickThroughCancel();
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('cancelError'),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('payment-overdue-dialog')).toBeInTheDocument();
    // Back on the primary actions, buttons live again for a retry.
    expect(screen.getByTestId('payment-overdue-pay')).toBeEnabled();
    errorSpy.mockRestore();
  });

  it('a refetch failure never masks a successful cancel as an error', async () => {
    // The cancel already went through server-side; the refetch is cosmetic
    // cache hygiene. Toasting an error here would make the user retry a
    // cancel that already succeeded. Against a subscription that no
    // longer exists.
    useQueryMock.mockReturnValue(pastDueQuotas());
    refetchMock.mockRejectedValue(new Error('offline'));
    render(<PaymentOverdueDialog />);

    await clickThroughCancel();
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith('cancelSuccess'),
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('disables both confirm-step buttons while the cancel is in flight', async () => {
    // A second confirm click would double-fire the cancel action; clicking
    // Back mid-flight would hide the spinner and let the user re-trigger
    // it from the primary step. Both paths risk duplicate cancel calls
    // against the billing provider.
    useQueryMock.mockReturnValue(pastDueQuotas());
    cancelOverdueMock.mockImplementation(() => new Promise(() => {}));
    render(<PaymentOverdueDialog />);

    await clickThroughCancel();
    expect(cancelOverdueMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('payment-overdue-cancel-confirm')).toBeDisabled();
    expect(screen.getByTestId('payment-overdue-cancel-back')).toBeDisabled();
  });

  it('re-enables the buttons when the page returns from bfcache', async () => {
    // Clicking Pay leaves `busy` set on purpose while the tab navigates to
    // the Stripe invoice. Coming back via the Back button restores the page
    // from bfcache with that state frozen, without the pageshow reset,
    // every escape hatch in this hard block stays disabled forever.
    const url = 'https://invoice.stripe.com/i/abc';
    useQueryMock.mockReturnValue(pastDueQuotas({ pastDueInvoiceUrl: url }));
    const assigned = captureLocationHref();
    render(<PaymentOverdueDialog />);

    await userEvent.click(screen.getByTestId('payment-overdue-pay'));
    expect(assigned).toEqual([url]);
    expect(screen.getByTestId('payment-overdue-pay')).toBeDisabled();
    expect(screen.getByTestId('payment-overdue-cancel')).toBeDisabled();

    // jsdom has no PageTransitionEvent constructor; a plain event carrying
    // `persisted` is what the listener actually reads.
    const pageshow = new Event('pageshow');
    Object.defineProperty(pageshow, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(pageshow);
    });

    expect(screen.getByTestId('payment-overdue-pay')).toBeEnabled();
    expect(screen.getByTestId('payment-overdue-cancel')).toBeEnabled();
  });
});
