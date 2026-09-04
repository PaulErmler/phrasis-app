/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import schema from '../../schema';
import { internal } from '../../_generated/api';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * End-to-end wiring tests for `trackUsage` → `pushCustomerState` →
 * `syncAllFeatures`, over a stubbed Autumn API.
 *
 * paymentOverdue.test.ts covers each stage in isolation; these tests pin the
 * seam BETWEEN them, because that seam is where money leaks: if the action
 * fails to forward `anyPastDue` or the invoice URL into the mutation, a
 * delinquent customer keeps generating billable LLM/TTS work with no pay
 * button, and if it forwards `productsMissing` wrongly, a transient empty
 * Autumn response silently unblocks them.
 *
 * The header pin matters just as much: the payload's SHAPE is version-
 * dependent (see AUTUMN_API_VERSION in usage/tracking.ts), so a request that
 * drops `x-api-version: 2.2` would ride Autumn's moving default and one day
 * stop seeing `subscriptions[].past_due` at all, disabling the payment
 * block with zero errors.
 */

// No "track" substring in the id. The fetch stub routes by URL substring
// and must never confuse the customer path with the /track endpoint.
const USER = 'user_sync_wiring';

type Call = { url: string; method: string; body: any; version: string | null };

let calls: Call[] = [];

/**
 * Route stubbed responses by URL substring (same pattern as
 * convex/tests/billing/switchPlanDuringTrial.test.ts). Key order is match
 * order, so "expand=invoices" must be registered BEFORE "/customers/",
 * otherwise the expanded re-fetch would be served the un-expanded payload
 * and the invoice-capture tests would pass vacuously.
 */
function stubAutumn(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, init: any = {}) => {
    const version = init?.headers?.['x-api-version'] ?? null;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body) : undefined,
      version,
    });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const payload = key ? routes[key] : {};
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Requests to a given Autumn path, in order. */
const callsTo = (path: string) => calls.filter((c) => c.url.includes(path));

/** v2 subscription entry. The shape `x-api-version: 2.2` actually returns. */
const subscription = (over: Record<string, unknown> = {}) => ({
  plan_id: 'pro',
  status: 'active',
  add_on: false,
  past_due: false,
  ...over,
});

// Deliberately asymmetric numbers so a swapped granted/remaining/usage
// mapping (which would show users the wrong balance and mis-gate spending)
// cannot cancel out.
const BALANCES = {
  chat_messages: {
    feature_id: 'chat_messages',
    granted: 100,
    remaining: 60,
    usage: 40,
    unlimited: false,
  },
};

const INVOICE_URL = 'https://invoice.stripe.com/pay_1';

const customerPayload = (over: Record<string, unknown> = {}) => ({
  balances: BALANCES,
  subscriptions: [subscription()],
  ...over,
});

const runTrack = (t: TestConvex<typeof schema>) =>
  t.action(internal.usage.tracking.trackUsage, {
    userId: USER,
    featureId: 'chat_messages',
    value: 1,
  });

async function getQuotaDoc(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', USER))
      .first(),
  );
}

beforeEach(() => {
  calls = [];
  vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_stub');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('usage: reconcileCourseUsage', () => {
  const coursesBalance = (usage: number, unlimited = false) => ({
    courses: {
      feature_id: 'courses',
      granted: 10,
      remaining: 10 - usage,
      usage,
      unlimited,
    },
  });

  const seedActiveCourses = (t: TestConvex<typeof schema>, count: number) =>
    t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert('courses', {
          userId: USER,
          baseLanguages: ['en'],
          targetLanguages: ['de'],
          isArchived: i % 2 === 1 ? undefined : false,
        });
      }
      // An archived course must not count as held.
      await ctx.db.insert('courses', {
        userId: USER,
        baseLanguages: ['en'],
        targetLanguages: ['fr'],
        isArchived: true,
        archivedAt: 1,
      });
    });

  const runReconcile = (t: TestConvex<typeof schema>) =>
    t.action(internal.usage.tracking.reconcileCourseUsage, { userId: USER });

  it('releases exactly the ghost slots and refreshes the mirror', async () => {
    stubAutumn({
      '/track': {},
      '/customers/': customerPayload({
        balances: { ...BALANCES, ...coursesBalance(5) },
      }),
    });
    const t = convexTest(schema, modules);
    await seedActiveCourses(t, 2);

    await runReconcile(t);

    expect(callsTo('/track').map((c) => c.body)).toEqual([
      { customer_id: USER, feature_id: 'courses', value: -3 },
    ]);
    // Fresh read before, resync after: the mirror is populated.
    expect(callsTo('/customers/')).toHaveLength(2);
    expect((await getQuotaDoc(t))?.features.courses).toMatchObject({
      used: 5,
      included: 10,
    });
  });

  it('never tracks a positive value when the counter is below the active count', async () => {
    // A hand-lowered counter or an extra manual grant must survive: the
    // self-heal may only ever give slots back, never take them.
    stubAutumn({
      '/track': {},
      '/customers/': customerPayload({
        balances: { ...BALANCES, ...coursesBalance(1) },
      }),
    });
    const t = convexTest(schema, modules);
    await seedActiveCourses(t, 3);

    await runReconcile(t);
    expect(callsTo('/track')).toHaveLength(0);
  });

  it('is a no-op when the counter already matches', async () => {
    stubAutumn({
      '/track': {},
      '/customers/': customerPayload({
        balances: { ...BALANCES, ...coursesBalance(2) },
      }),
    });
    const t = convexTest(schema, modules);
    await seedActiveCourses(t, 2);

    await runReconcile(t);
    expect(callsTo('/track')).toHaveLength(0);
  });

  it('skips unlimited features and past-due customers', async () => {
    stubAutumn({
      '/track': {},
      '/customers/': customerPayload({
        balances: { ...BALANCES, ...coursesBalance(5, true) },
      }),
    });
    let t = convexTest(schema, modules);
    await seedActiveCourses(t, 1);
    await runReconcile(t);
    expect(callsTo('/track')).toHaveLength(0);

    calls = [];
    stubAutumn({
      '/track': {},
      'expand=invoices': customerPayload({
        balances: { ...BALANCES, ...coursesBalance(5) },
        subscriptions: [subscription({ past_due: true })],
      }),
      '/customers/': customerPayload({
        balances: { ...BALANCES, ...coursesBalance(5) },
        subscriptions: [subscription({ past_due: true })],
      }),
    });
    t = convexTest(schema, modules);
    await seedActiveCourses(t, 1);
    await runReconcile(t);
    expect(callsTo('/track')).toHaveLength(0);
  });
});

describe('usage: trackUsage sync wiring', () => {
  it('past-due customer: blocks, captures the invoice URL, in exactly one extra request', async () => {
    stubAutumn({
      '/track': {},
      // Registered before "/customers/". See stubAutumn note.
      'expand=invoices': customerPayload({
        subscriptions: [subscription({ past_due: true })],
        invoices: [
          { status: 'open', hosted_invoice_url: INVOICE_URL, created_at: 10 },
        ],
      }),
      '/customers/': customerPayload({
        subscriptions: [subscription({ past_due: true })],
      }),
    });
    const t = convexTest(schema, modules);
    const before = Date.now();
    await runTrack(t);

    // The negative-value /track exploit was closed by removing the public
    // proxy; the internal action must still send the true underlying id/value.
    expect(callsTo('/track')[0].body).toEqual({
      customer_id: USER,
      feature_id: 'chat_messages',
      value: 1,
    });

    const doc = await getQuotaDoc(t);
    // pastDueSince is what assertBillingCurrent keys on, if the
    // action didn't forward anyPastDue, the delinquent user keeps spending.
    expect(doc?.pastDueSince).toBeGreaterThanOrEqual(before);
    expect(doc?.planStatus).toBe('past_due');
    // Without the URL the overdue dialog has no pay button. The user
    // literally cannot settle the debt.
    expect(doc?.pastDueInvoiceUrl).toBe(INVOICE_URL);
    // granted→included, remaining→balance, usage→used.
    expect(doc?.features.chat_messages).toEqual({
      balance: 60,
      included: 100,
      used: 40,
    });

    // One expanded re-fetch, not zero (URL lost) and not two (the payload
    // already carrying invoices must be reused, not re-fetched).
    expect(callsTo('expand=invoices')).toHaveLength(1);
    // track + plain GET + expanded GET, every one pinned to the v2 shape.
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c.version).toBe('2.2');
  });

  it('healthy customer: no invoice fetch, no past-due state', async () => {
    stubAutumn({
      '/track': {},
      'expand=invoices': customerPayload(),
      '/customers/': customerPayload(),
    });
    const t = convexTest(schema, modules);
    await runTrack(t);

    const doc = await getQuotaDoc(t);
    expect(doc?.pastDueSince).toBeUndefined();
    expect(doc?.planStatus).toBe('active');
    expect(doc?.pastDueInvoiceUrl).toBeUndefined();
    expect(doc?.features.chat_messages).toEqual({
      balance: 60,
      included: 100,
      used: 40,
    });

    // The expanded call costs a second Autumn round-trip per sync. It must
    // stay reserved for the rare delinquent path.
    expect(callsTo('expand=invoices')).toHaveLength(0);
    for (const c of calls) expect(c.version).toBe('2.2');
  });

  it("captures the URL from an 'uncollectible' invoice too", async () => {
    // Stripe flips an invoice to uncollectible after final dunning, but the
    // debt still exists and the hosted page still accepts payment, dropping
    // it would strand exactly the longest-overdue customers without a pay
    // button.
    stubAutumn({
      '/track': {},
      'expand=invoices': customerPayload({
        subscriptions: [subscription({ past_due: true })],
        invoices: [
          {
            status: 'uncollectible',
            hosted_invoice_url: INVOICE_URL,
            created_at: 10,
          },
        ],
      }),
      '/customers/': customerPayload({
        subscriptions: [subscription({ past_due: true })],
      }),
    });
    const t = convexTest(schema, modules);
    await runTrack(t);

    expect((await getQuotaDoc(t))?.pastDueInvoiceUrl).toBe(INVOICE_URL);
  });

  it('an empty Autumn answer leaves an existing past-due block untouched', async () => {
    // A transient empty response (no subscriptions, no products) means "we
    // don't know", not "the customer holds nothing". If the action mapped it
    // to anyPastDue:false without productsMissing, one flaky Autumn reply
    // would unblock a delinquent customer for free.
    const t = convexTest(schema, modules);
    await t.mutation(internal.usage.helpers.syncAllFeatures, {
      userId: USER,
      features: { chat_messages: { balance: 10, included: 10, used: 0 } },
      anyPastDue: true,
      productsMissing: false,
      planId: 'pro',
      planName: 'Pro',
      planStatus: 'past_due',
    });
    const seededSince = (await getQuotaDoc(t))?.pastDueSince;
    expect(seededSince).toBeDefined();

    stubAutumn({
      '/track': {},
      '/customers/': { balances: BALANCES },
    });
    await runTrack(t);

    const doc = await getQuotaDoc(t);
    expect(doc?.planStatus).toBe('past_due');
    expect(doc?.pastDueSince).toBe(seededSince);
    // The balances themselves are still authoritative. Quota refresh must
    // not be held hostage by the missing plan list.
    expect(doc?.features.chat_messages).toEqual({
      balance: 60,
      included: 100,
      used: 40,
    });
    // productsMissing → anyPastDue false on the derived side, so the
    // invoice re-fetch must not fire either.
    expect(callsTo('expand=invoices')).toHaveLength(0);
  });
});
