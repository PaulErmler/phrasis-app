import { v } from 'convex/values';

import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server';
import { internal } from '../_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { optionalEnv } from '../lib/env';
import { EVENTS, track } from '../analytics';

/**
 * Daily reconciliation of ACTUAL payment amounts from Stripe.
 *
 * The margin dashboards previously modeled revenue from list prices with a
 * flat 19% VAT and estimated Stripe fees. Real invoices differ per user:
 * VAT depends on the customer's country, card fees on the card's origin, and
 * proration/discounts change the gross. This sweep pulls the last
 * `LOOKBACK_DAYS` of PAID invoices with their charge's balance transaction
 * and reports one `payment_recorded` PostHog event per invoice, attributed
 * to the app user via the customer email:
 *
 *   gross        amount_paid (VAT-inclusive, what the customer was charged)
 *   tax          actual VAT/sales tax on the invoice
 *   stripe_fee   actual processing + Managed Payments fee (balance txn)
 *   balance_net  what landed in the Stripe balance (gross - stripe_fee)
 *
 * NOTE on Managed Payments: Stripe is merchant of record and remits the tax.
 * Whether `balance_net` already has the remitted tax deducted depends on how
 * Stripe books it for the account — verify against the first real payout and
 * pick the matching net formula in the PostHog tile (`balance_net - tax` vs
 * `balance_net`). Both raw numbers are on the event precisely so the tile
 * can be corrected without re-syncing.
 *
 * Dedup: `paymentEvents` keyed by invoice id. Lookback windows overlap on
 * purpose (a late webhook-settled invoice still gets picked up); the ledger
 * makes the overlap idempotent.
 *
 * Requires STRIPE_SECRET_KEY (a RESTRICTED read-only key: Invoices, Charges,
 * Balance transactions). Unset means the sweep no-ops, so the feature is
 * safe to deploy before the key exists.
 */

const LOOKBACK_DAYS = 35;
const STRIPE_API = 'https://api.stripe.com/v1';

type StripeBalanceTransaction = {
  fee?: number;
  net?: number;
};

type StripeCharge = {
  balance_transaction?: StripeBalanceTransaction | string | null;
};

type StripeInvoice = {
  id: string;
  amount_paid?: number;
  currency?: string;
  /** Legacy total-tax field; newer API versions use total_tax_amounts. */
  tax?: number | null;
  total_tax_amounts?: Array<{ amount?: number }>;
  customer_email?: string | null;
  charge?: StripeCharge | string | null;
  status_transitions?: { paid_at?: number | null };
  created: number;
  /** First page of line items is embedded in the list response. */
  lines?: {
    data?: Array<{
      period?: { start?: number; end?: number };
    }>;
  };
};

type StripeInvoiceList = {
  data: StripeInvoice[];
  has_more: boolean;
};

/** Cents (or the currency's minor unit) → major units. */
const major = (cents: number | undefined | null): number =>
  cents === undefined || cents === null ? 0 : cents / 100;

/**
 * Billing period covered by the invoice, in whole months (>= 1). An annual
 * subscription invoice returns 12, a monthly one 1. This is what lets the
 * dashboards report MRR instead of cash-in: a yearly payment contributes
 * net/12 per month for 12 months rather than one distorting spike.
 */
function invoicePeriodMonths(inv: StripeInvoice): number {
  const period = inv.lines?.data?.[0]?.period;
  if (!period?.start || !period?.end) return 1;
  const days = (period.end - period.start) / 86_400;
  return Math.max(1, Math.round(days / 30.44));
}

function invoiceTaxCents(inv: StripeInvoice): number {
  if (typeof inv.tax === 'number') return inv.tax;
  if (Array.isArray(inv.total_tax_amounts)) {
    return inv.total_tax_amounts.reduce((sum, t) => sum + (t.amount ?? 0), 0);
  }
  return 0;
}

export const userIdByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx: QueryCtx, args: { email: string }) => {
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_email', (q) => q.eq('email', args.email.toLowerCase()))
      .first();
    return profile?.userId ?? null;
  },
});

/**
 * Dedup-checked insert + PostHog capture for one paid invoice. Returns true
 * when the invoice was new. The event fires from inside the mutation so a
 * lost OCC race can't emit an event for a row that was never written.
 */
export const recordPayment = internalMutation({
  args: {
    stripeInvoiceId: v.string(),
    userId: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    gross: v.number(),
    tax: v.number(),
    stripeFee: v.optional(v.number()),
    balanceNet: v.optional(v.number()),
    currency: v.string(),
    paidAt: v.number(),
    /** Whole months the invoice pays for (12 for annual plans). */
    periodMonths: v.number(),
  },
  returns: v.boolean(),
  handler: async (
    ctx: MutationCtx,
    args: {
      stripeInvoiceId: string;
      userId?: string;
      customerEmail?: string;
      gross: number;
      tax: number;
      stripeFee?: number;
      balanceNet?: number;
      currency: string;
      paidAt: number;
      periodMonths: number;
    },
  ) => {
    const existing = await ctx.db
      .query('paymentEvents')
      .withIndex('by_stripeInvoiceId', (q) =>
        q.eq('stripeInvoiceId', args.stripeInvoiceId),
      )
      .first();
    if (existing) return false;

    // The ledger row stores no user id or email (see the schema comment);
    // attribution rides only on the PostHog event below.
    const { userId, customerEmail, ...ledgerRow } = args;
    void customerEmail;
    await ctx.db.insert('paymentEvents', ledgerRow);
    // Unmatched payments still count toward totals, mirroring the AI-cost
    // system bucket: the money was still received.
    await track(
      ctx,
      args.userId ?? 'system:unmatched-payment',
      EVENTS.PAYMENT_RECORDED,
      {
        stripe_invoice_id: args.stripeInvoiceId,
        gross: args.gross,
        tax: args.tax,
        stripe_fee: args.stripeFee,
        balance_net: args.balanceNet,
        currency: args.currency,
        paid_at: args.paidAt,
        period_months: args.periodMonths,
        attributed: args.userId !== undefined,
      },
    );
    return true;
  },
});

export const syncStripePayments = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx: ActionCtx) => {
    const key = optionalEnv('STRIPE_SECRET_KEY');
    if (!key) {
      console.log('[paymentSync] STRIPE_SECRET_KEY unset — skipping sweep');
      return null;
    }

    const since = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 24 * 3600;
    let startingAfter: string | undefined;
    let recorded = 0;
    let seen = 0;

    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({
        status: 'paid',
        limit: '100',
        'created[gte]': String(since),
        'expand[]': 'data.charge.balance_transaction',
      });
      if (startingAfter) params.set('starting_after', startingAfter);

      const res = await fetch(`${STRIPE_API}/invoices?${params}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        throw new Error(
          `[paymentSync] Stripe invoices list failed: ${res.status} ${(await res.text()).slice(0, 300)}`,
        );
      }
      const list = (await res.json()) as StripeInvoiceList;

      for (const inv of list.data) {
        seen++;
        const gross = major(inv.amount_paid);
        if (gross <= 0) continue; // free-plan / zero invoices carry no revenue

        const charge =
          inv.charge && typeof inv.charge === 'object' ? inv.charge : null;
        const bt =
          charge?.balance_transaction &&
          typeof charge.balance_transaction === 'object'
            ? charge.balance_transaction
            : null;

        const email = inv.customer_email ?? undefined;
        const userId = email
          ? ((await ctx.runQuery(internal.features.paymentSync.userIdByEmail, {
              email,
            })) ?? undefined)
          : undefined;

        const inserted: boolean = await ctx.runMutation(
          internal.features.paymentSync.recordPayment,
          {
            stripeInvoiceId: inv.id,
            userId,
            customerEmail: email,
            gross,
            tax: major(invoiceTaxCents(inv)),
            stripeFee: bt?.fee !== undefined ? major(bt.fee) : undefined,
            balanceNet: bt?.net !== undefined ? major(bt.net) : undefined,
            currency: (inv.currency ?? 'eur').toLowerCase(),
            paidAt: (inv.status_transitions?.paid_at ?? inv.created) * 1000,
            periodMonths: invoicePeriodMonths(inv),
          },
        );
        if (inserted) recorded++;
      }

      if (!list.has_more || list.data.length === 0) break;
      startingAfter = list.data[list.data.length - 1].id;
    }

    console.log(
      `[paymentSync] swept ${seen} paid invoices, recorded ${recorded} new`,
    );
    return null;
  },
});
