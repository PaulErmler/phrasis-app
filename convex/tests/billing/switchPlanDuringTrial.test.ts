/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import schema from '../../schema';
import { api, internal } from '../../_generated/api';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * Tests for the trial-switching and overdue-cancel actions. Originally
 * characterization tests pinned before the shared-normalizer refactor; the
 * cancelOverdueSubscription cases were later updated ON PURPOSE for the
 * recovered/cancelled contract (cancel-after-pay guard), see that describe.
 *
 * These actions had no tests at all despite carrying the most carefully
 * verified logic in the billing code. Autumn is reached over raw `fetch`, so
 * the network is stubbed and assertions are made on the requests issued,
 * which is exactly what a shape regression would corrupt.
 *
 * Payloads use the v1.2 `products[]` shape, which is what the code requests.
 */

const USER = 'user_trial';
const TRIAL_END = Date.now() + 5 * 24 * 60 * 60 * 1000;

type Call = { url: string; method: string; body: any; version: string | null };

let calls: Call[] = [];

/**
 * Route stubbed responses by URL substring, optionally gated on method via a
 * "METHOD " key prefix (e.g. "POST /customers"). The prefix exists because
 * get-or-create is `POST /customers` with NO trailing slash: a "/customers/"
 * key never matches it (silently feeding the follow-on sync an empty
 * payload), while a bare "/customers" key would also swallow
 * `GET /customers/:id`. A `{ $status, $body }` value produces a non-ok
 * response so callers' failure paths can be pinned too.
 */
function stubAutumn(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, init: any = {}) => {
    const method = init?.method ?? 'GET';
    const version = init?.headers?.['x-api-version'] ?? null;
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body) : undefined,
      version,
    });
    const key = Object.keys(routes).find((k) => {
      const sep = k.indexOf(' ');
      const wantMethod = sep === -1 ? undefined : k.slice(0, sep);
      const path = sep === -1 ? k : k.slice(sep + 1);
      return (
        (wantMethod === undefined || wantMethod === method) &&
        url.includes(path)
      );
    });
    const raw = key !== undefined ? routes[key] : {};
    const errorSpec =
      raw !== null && typeof raw === 'object' && '$status' in raw
        ? (raw as { $status: number; $body?: unknown })
        : null;
    const status = errorSpec?.$status ?? 200;
    const payload = errorSpec ? (errorSpec.$body ?? {}) : raw;
    return {
      ok: status < 400,
      status,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const trialingProduct = (over: Record<string, unknown> = {}) => ({
  id: 'basic_annual',
  status: 'trialing',
  is_default: false,
  is_add_on: false,
  trial_ends_at: null,
  current_period_end: TRIAL_END,
  ...over,
});

const freeProduct = {
  id: 'free',
  status: 'active',
  is_default: true,
  is_add_on: false,
};

const pastDueBasic = {
  id: 'basic',
  status: 'past_due',
  is_default: false,
  is_add_on: false,
};

/** A genuinely unsettled invoice with a Stripe-hosted payment page. */
const openInvoice = {
  status: 'open',
  hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
  created_at: 1,
};

/**
 * What get-or-create (v2.2) reports once the paid plan is gone: only Free
 * left, with balances toFeaturesRecord can turn into the quota mirror.
 */
const freeOnlyCustomer = {
  subscriptions: [
    { plan_id: 'free', status: 'active', auto_enable: true, add_on: false },
  ],
  balances: {
    chat_messages: {
      feature_id: 'chat_messages',
      granted: 10,
      remaining: 10,
      usage: 0,
      unlimited: false,
    },
  },
};

const asUser = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: USER });

/** Requests to a given Autumn path, in order. */
const callsTo = (path: string) => calls.filter((c) => c.url.includes(path));

/**
 * The follow-on quota sync always enters through get-or-create. POST
 * /customers with NO trailing slash, so this is the proof the sync ran.
 */
const syncPosts = () =>
  calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v1/customers'));

const getQuotaDoc = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', USER))
      .first(),
  );

/**
 * Put the quota mirror into the blocked state the overdue dialog acts from,
 * through the same mutation the real sync paths use.
 */
const seedPastDueDoc = (t: TestConvex<typeof schema>) =>
  t.mutation(internal.usage.helpers.syncAllFeatures, {
    userId: USER,
    features: { chat_messages: { balance: 0, included: 10, used: 10 } },
    planId: 'basic',
    planName: 'Basic',
    planStatus: 'past_due',
    anyPastDue: true,
    productsMissing: false,
    pastDueInvoiceUrl: 'https://invoice.stripe.com/i/stale',
  });

beforeEach(() => {
  calls = [];
  vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_stub');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('switchPlanDuringTrial', () => {
  it('rejects an unauthenticated caller', async () => {
    stubAutumn({});
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.billing.switchPlanDuringTrial, { productId: 'pro' }),
    ).rejects.toThrow(/not authenticated/i);
  });

  it('refuses when the customer is not trialing', async () => {
    stubAutumn({ '/customers/': { products: [freeProduct] } });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: 'pro' }),
    ).rejects.toThrow(/no active trial/i);
  });

  it('does not mistake an early-cancelled trial (expired, future trial end) for an active one', async () => {
    // Cancelling a trial can leave the plan in the payload with status
    // 'expired' while its trial_ends_at is still in the future. Treating
    // that as trialing would drive a switch off a trial that no longer
    // exists. The currentPlans filter must exclude it.
    stubAutumn({
      '/customers/': {
        products: [freeProduct, trialingProduct({ status: 'expired' })],
      },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: 'pro' }),
    ).rejects.toThrow(/no active trial/i);
  });

  it('reads the trial end from current_period_end (v1.2 leaves trial_ends_at null)', async () => {
    stubAutumn({
      '/customers/': { products: [trialingProduct()] },
      '/checkout': {
        product: { scenario: 'downgrade', properties: { is_free: false } },
      },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: 'basic',
    });
    expect(res.trialEndsAt).toBe(TRIAL_END);
  });

  it('refuses to re-attach the plan already being trialed', async () => {
    stubAutumn({
      '/customers/': { products: [trialingProduct()] },
      '/checkout': {
        product: { scenario: 'upgrade', properties: { is_free: false } },
      },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, {
        productId: 'basic_annual',
      }),
    ).rejects.toThrow(/already trialing/i);
  });

  it('downgrade → plain legacy attach, scheduled, trial untouched', async () => {
    stubAutumn({
      '/customers/': { products: [trialingProduct()] },
      '/checkout': {
        product: { scenario: 'downgrade', properties: { is_free: false } },
      },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: 'basic',
    });

    expect(res.mode).toBe('scheduled');
    const attach = callsTo('/attach')[0];
    expect(attach.body).toEqual({ customer_id: USER, product_id: 'basic' });
    // No customize.free_trial. That would re-anchor the running trial.
    expect(attach.body.customize).toBeUndefined();
    expect(attach.version).toBe('1.2');
  });

  it('upgrade → v2 billing.attach carrying the REMAINING trial, never extending it', async () => {
    stubAutumn({
      '/customers/': { products: [trialingProduct()] },
      '/checkout': {
        product: { scenario: 'upgrade', properties: { is_free: false } },
      },
      '/billing.attach': { payment_url: null },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: 'pro',
    });

    expect(res.mode).toBe('immediate');
    const attach = callsTo('/billing.attach')[0];
    expect(attach.version).toBe('2.1.0');
    expect(attach.body.plan_id).toBe('pro');
    const days = attach.body.customize.free_trial.duration_length;
    // ~5 days left: must not round UP into a longer trial than remains.
    expect(days).toBe(5);
    expect(attach.body.customize.free_trial.card_required).toBe(true);
  });

  it('never shortens a trial below the API minimum of one day', async () => {
    stubAutumn({
      '/customers/': {
        products: [
          trialingProduct({ current_period_end: Date.now() + 3_600_000 }),
        ],
      },
      '/checkout': {
        product: { scenario: 'upgrade', properties: { is_free: false } },
      },
      '/billing.attach': { payment_url: null },
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: 'pro',
    });
    expect(
      callsTo('/billing.attach')[0].body.customize.free_trial.duration_length,
    ).toBe(1);
  });

  it('a free target takes the scheduled path, never the immediate one', async () => {
    stubAutumn({
      '/customers/': { products: [trialingProduct()] },
      '/checkout': {
        product: { scenario: 'cancel', properties: { is_free: true } },
      },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: 'free',
    });
    expect(res.mode).toBe('scheduled');
    // Free must never reach billing.attach. Its free_trial would be meaningless.
    expect(callsTo('/billing.attach')).toHaveLength(0);
  });

  it('rejects an unclassifiable scenario rather than guessing', async () => {
    stubAutumn({
      '/customers/': { products: [trialingProduct()] },
      '/checkout': {
        product: { scenario: 'active', properties: { is_free: false } },
      },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: 'pro' }),
    ).rejects.toThrow(/not applicable during trial/i);
  });

  it('renew of the trialed plan un-schedules a pending switch via plain legacy attach', async () => {
    stubAutumn({
      '/customers/': { products: [trialingProduct()] },
      '/checkout': {
        product: { scenario: 'renew', properties: { is_free: false } },
      },
    });
    const t = convexTest(schema, modules);
    // Same product id as the running trial: the "already trialing" guard must
    // step aside for Autumn's "renew" classification. This is the only way
    // back from a scheduled downgrade, and blocking it would strand the user
    // on a switch they changed their mind about.
    const res = await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: 'basic_annual',
    });

    expect(res.mode).toBe('immediate');
    const attach = callsTo('/attach')[0];
    expect(attach.version).toBe('1.2');
    // A plain legacy attach: any customize.free_trial here would re-anchor
    // (extend) the running trial instead of just dropping the schedule.
    expect(attach.body).toEqual({
      customer_id: USER,
      product_id: 'basic_annual',
    });
    expect(callsTo('/billing.attach')).toHaveLength(0);
  });

  it("scenario 'new' takes the immediate billing.attach path like an upgrade", async () => {
    stubAutumn({
      '/customers/': { products: [trialingProduct()] },
      '/checkout': {
        product: { scenario: 'new', properties: { is_free: false } },
      },
      '/billing.attach': { payment_url: null },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: 'pro',
    });

    expect(res.mode).toBe('immediate');
    const attach = callsTo('/billing.attach')[0];
    expect(attach.version).toBe('2.1.0');
    expect(attach.body.plan_id).toBe('pro');
    // "new" must still carry the REMAINING trial, without it the customer
    // would be billed immediately for a plan they were promised to try free.
    expect(attach.body.customize.free_trial.duration_length).toBe(5);
  });

  it('forwards a payment_url when Autumn demands a card despite the trial', async () => {
    stubAutumn({
      '/customers/': { products: [trialingProduct()] },
      '/checkout': {
        product: { scenario: 'upgrade', properties: { is_free: false } },
      },
      '/billing.attach': {
        payment_url: 'https://checkout.stripe.com/c/pay_123',
      },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: 'pro',
    });
    // Swallowing this would leave the switch half-done with no way for the
    // user to complete payment. The client must be able to redirect.
    expect(res.paymentUrl).toBe('https://checkout.stripe.com/c/pay_123');
  });
});

describe('cancelOverdueSubscription', () => {
  it('nothing past due → recovered, no cancel, and the mirror is re-synced', async () => {
    stubAutumn({
      'GET /customers/': { products: [freeProduct, trialingProduct()] },
      'POST /customers': freeOnlyCustomer,
    });
    const t = convexTest(schema, modules);
    // Throwing here (the old contract) punished the double-click / stale-tab
    // case: the first click cancelled, the second saw "no past-due plan" and
    // surfaced an error over a state that is actually fine.
    const res = await asUser(t).action(
      api.billing.cancelOverdueSubscription,
      {},
    );

    expect(res.outcome).toBe('recovered');
    expect(res.cancelledProductId).toBeUndefined();
    expect(callsTo('/cancel')).toHaveLength(0);
    // The sync is what clears a stale block instead of stranding the user.
    expect(syncPosts()).toHaveLength(1);
    expect(syncPosts()[0].version).toBe('2.2');
  });

  it('cancels the past-due plan immediately (v1 status encoding)', async () => {
    stubAutumn({
      'GET /customers/': {
        products: [
          freeProduct,
          { ...trialingProduct(), id: 'basic', status: 'past_due' },
        ],
        invoices: [openInvoice],
      },
      '/cancel': { success: true },
      'POST /customers': freeOnlyCustomer,
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(
      api.billing.cancelOverdueSubscription,
      {},
    );

    expect(res.outcome).toBe('cancelled');
    expect(res.cancelledProductId).toBe('basic');
    expect(callsTo('/cancel')[0].body).toEqual({
      customer_id: USER,
      product_id: 'basic',
      cancel_immediately: true,
    });
    expect(callsTo('/cancel')[0].version).toBe('1.2');
  });

  it('also detects the v2 boolean encoding of past_due', async () => {
    stubAutumn({
      'GET /customers/': {
        products: [
          freeProduct,
          {
            ...trialingProduct(),
            id: 'basic',
            status: 'active',
            past_due: true,
          },
        ],
        invoices: [openInvoice],
      },
      '/cancel': { success: true },
      'POST /customers': freeOnlyCustomer,
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(
      api.billing.cancelOverdueSubscription,
      {},
    );
    expect(res.outcome).toBe('cancelled');
    expect(res.cancelledProductId).toBe('basic');
  });

  it('never cancels the free plan or an add-on, even with an unpaid invoice', async () => {
    stubAutumn({
      'GET /customers/': {
        products: [
          { ...freeProduct, status: 'past_due' },
          {
            id: 'extra',
            status: 'past_due',
            is_default: false,
            is_add_on: true,
          },
        ],
        invoices: [openInvoice],
      },
      'POST /customers': freeOnlyCustomer,
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(
      api.billing.cancelOverdueSubscription,
      {},
    );

    expect(res.outcome).toBe('recovered');
    expect(callsTo('/cancel')).toHaveLength(0);
    expect(syncPosts()).toHaveLength(1);
  });

  it('plan reads past_due but every invoice is settled → recovered, never cancels', async () => {
    stubAutumn({
      'GET /customers/': {
        products: [freeProduct, pastDueBasic],
        invoices: [
          {
            status: 'paid',
            hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
          },
        ],
      },
      'POST /customers': freeOnlyCustomer,
    });
    const t = convexTest(schema, modules);
    // The user just paid the hosted invoice; Autumn's subscription state lags
    // the Stripe webhook. Cancelling in this window destroys a subscription
    // that was paid seconds ago, with no refund path.
    const res = await asUser(t).action(
      api.billing.cancelOverdueSubscription,
      {},
    );

    expect(res.outcome).toBe('recovered');
    expect(callsTo('/cancel')).toHaveLength(0);
    expect(syncPosts()).toHaveLength(1);
  });

  it('invoices field absent (expand not honored) → still cancels', async () => {
    stubAutumn({
      'GET /customers/': { products: [freeProduct, pastDueBasic] },
      '/cancel': { success: true },
      'POST /customers': freeOnlyCustomer,
    });
    const t = convexTest(schema, modules);
    // Ambiguous payload: without the invoices array we cannot prove the debt
    // is settled, so we fail toward the user's explicit request, refusing
    // would leave a genuinely delinquent customer stuck behind the block.
    const res = await asUser(t).action(
      api.billing.cancelOverdueSubscription,
      {},
    );

    expect(res.outcome).toBe('cancelled');
    expect(res.cancelledProductId).toBe('basic');
    expect(callsTo('/cancel')).toHaveLength(1);
  });

  it('an unpaid invoice without a hosted page still counts as unpaid → cancels', async () => {
    stubAutumn({
      'GET /customers/': {
        products: [freeProduct, pastDueBasic],
        invoices: [{ status: 'open', hosted_invoice_url: null }],
      },
      '/cancel': { success: true },
      'POST /customers': freeOnlyCustomer,
    });
    const t = convexTest(schema, modules);
    // "Nothing payable in the dialog" must not read as "nothing owed": the
    // debt exists whether or not Stripe exposes a hosted page for it.
    const res = await asUser(t).action(
      api.billing.cancelOverdueSubscription,
      {},
    );

    expect(res.outcome).toBe('cancelled');
    expect(callsTo('/cancel')).toHaveLength(1);
  });

  it('cancelling clears the block: pastDueSince and invoice URL wiped by the sync', async () => {
    const t = convexTest(schema, modules);
    await seedPastDueDoc(t);
    stubAutumn({
      'GET /customers/': {
        products: [freeProduct, pastDueBasic],
        invoices: [openInvoice],
      },
      '/cancel': { success: true },
      'POST /customers': freeOnlyCustomer,
    });

    const res = await asUser(t).action(
      api.billing.cancelOverdueSubscription,
      {},
    );
    expect(res.outcome).toBe('cancelled');

    // The follow-on sync is what un-blocks the app: a cancel that left these
    // fields set would strand the user behind the overdue dialog with
    // nothing left to pay and no way out.
    const doc = await getQuotaDoc(t);
    expect(doc?.pastDueSince).toBeUndefined();
    expect(doc?.pastDueInvoiceUrl).toBeUndefined();
    expect(doc?.planId).toBe('free');
    expect(doc?.planStatus).toBe('active');
    expect(doc?.features['chat_messages']?.balance).toBe(10);
  });

  it('a failed cancel throws and leaves the block standing', async () => {
    const t = convexTest(schema, modules);
    await seedPastDueDoc(t);
    stubAutumn({
      'GET /customers/': {
        products: [freeProduct, pastDueBasic],
        invoices: [openInvoice],
      },
      '/cancel': { $status: 402, $body: { message: 'cancellation failed' } },
      'POST /customers': freeOnlyCustomer,
    });

    await expect(
      asUser(t).action(api.billing.cancelOverdueSubscription, {}),
    ).rejects.toThrow(/cancellation failed/);

    // No sync after a failed cancel: the customer still owes money, so
    // clearing pastDueSince here would lift the payment block while the
    // delinquent subscription lives on.
    expect(syncPosts()).toHaveLength(0);
    const doc = await getQuotaDoc(t);
    expect(doc?.pastDueSince).toBeDefined();
    expect(doc?.pastDueInvoiceUrl).toBe('https://invoice.stripe.com/i/stale');
  });
});
