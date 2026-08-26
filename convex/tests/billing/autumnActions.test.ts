/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import schema from '../../schema';
import { api } from '../../_generated/api';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * Behavior of the public actions in convex/autumn.ts, with the Autumn
 * component mocked at the module boundary. The sibling suites could not
 * observe the component side at all (convex-test does not register the
 * autumn component, so legacy-path calls there just failed downstream);
 * mocking `@useautumn/convex` here makes the seam observable, which is what
 * these behaviors live on:
 *
 * - `check` must force `sendEvent: false`. With sendEvent on, the
 *   component's check RECORDS a usage event of `requiredBalance` (unbounded,
 *   sign-free), i.e. the same self-service balance manipulation as the
 *   removed public `track`.
 * - The trial gate's decision must actually reach the component call, not
 *   just exist in gateTrialArgs (unit-tested in trialGate.test.ts).
 * - The Managed Payments strip/reject backstops must run on the component's
 *   RESULT inside the actions (helper-level tests live in
 *   managedPayments.test.ts).
 * - The v2 reroute must speak autumn-js's `{ data, error }` container in
 *   both directions: checkout_url mapped on success, Autumn's structured
 *   error preserved (not thrown) on failure, and the quota mirror refreshed
 *   afterwards.
 */

const mockAutumn = vi.hoisted(() => ({
  calls: [] as { method: string; args: unknown }[],
  responses: {
    check: undefined as unknown,
    attach: undefined as unknown,
    checkout: undefined as unknown,
  },
  identify: undefined as unknown,
}));

vi.mock('@useautumn/convex', () => {
  class Autumn {
    constructor(_component: unknown, config: { identify?: unknown }) {
      mockAutumn.identify = config.identify;
    }
    // convex/autumn.ts destructures createCustomer/listProducts/billingPortal
    // from this; plain placeholders keep the module loadable (none of them
    // is invoked here).
    api() {
      return { createCustomer: {}, listProducts: {}, billingPortal: {} };
    }
    async check(_ctx: unknown, args: unknown) {
      mockAutumn.calls.push({ method: 'check', args });
      return (
        mockAutumn.responses.check ?? { data: { allowed: true }, error: null }
      );
    }
    async attach(_ctx: unknown, args: unknown) {
      mockAutumn.calls.push({ method: 'attach', args });
      return mockAutumn.responses.attach ?? { data: {}, error: null };
    }
    async checkout(_ctx: unknown, args: unknown) {
      mockAutumn.calls.push({ method: 'checkout', args });
      return mockAutumn.responses.checkout ?? { data: {}, error: null };
    }
  }
  return { Autumn };
});

// convex/autumn.ts throws at import when AUTUMN_SECRET_KEY is unset, so the
// env is stubbed BEFORE the (deliberately dynamic) import; the import also
// constructs the (mocked) Autumn instance, capturing its identify() config.
vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_stub');
await import('../../autumn');

const USER = 'user_autumn_actions';

type Call = { url: string; method: string; body: any; version: string | null };

let calls: Call[] = [];

/**
 * Route stubbed responses by URL substring, optionally gated on method via a
 * "METHOD " key prefix. `{ $status, $body }` produces a non-ok JSON error;
 * `{ $status, $raw }` produces a non-ok NON-JSON body (for the error-mapping
 * pin on unparseable Autumn responses).
 */
function stubAutumn(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, init: any = {}) => {
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body) : undefined,
      version: init?.headers?.['x-api-version'] ?? null,
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
    const spec =
      raw !== null && typeof raw === 'object' && '$status' in raw
        ? (raw as { $status: number; $body?: unknown; $raw?: string })
        : null;
    const status = spec?.$status ?? 200;
    const text =
      spec?.$raw !== undefined
        ? spec.$raw
        : JSON.stringify(spec ? (spec.$body ?? {}) : raw);
    return {
      ok: status < 400,
      status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const freeProduct = {
  id: 'free',
  status: 'active',
  is_default: true,
  is_add_on: false,
};

const trialingProduct = {
  id: 'basic_annual',
  status: 'trialing',
  is_default: false,
  is_add_on: false,
  trial_ends_at: null,
  current_period_end: Date.now() + 5 * 24 * 60 * 60 * 1000,
};

const paidProduct = {
  id: 'pro',
  status: 'active',
  is_default: false,
  is_add_on: false,
};

/** A real payer holds only the paid plan (never `free`, sandbox-verified). */
const payerCustomer = {
  products: [paidProduct],
  trials_used: [{ product_id: 'pro' }],
};

/** Routes for a payer's cross-plan switch onto the v2 reroute. */
const rerouteBase = {
  'GET /customers/': payerCustomer,
  '/products/ultra': {
    id: 'ultra',
    is_default: false,
    properties: { is_free: false },
  },
};

const asUser = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: USER });

const callsTo = (path: string) => calls.filter((c) => c.url.includes(path));

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls = [];
  mockAutumn.calls.length = 0;
  mockAutumn.responses.check = undefined;
  mockAutumn.responses.attach = undefined;
  mockAutumn.responses.checkout = undefined;
  vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_stub');
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('check (paywall preview)', () => {
  it('forces sendEvent off even when the client asks for it, forwarding everything else', async () => {
    stubAutumn({});
    const t = convexTest(schema, modules);
    await asUser(t).action(api.autumn.check, {
      featureId: 'chat_messages',
      requiredBalance: 3,
      sendEvent: true,
      withPreview: true,
      entityId: 'e1',
      entityData: { seat: 'a' },
      customerData: { name: 'N', email: 'n@example.test' },
    });
    // sendEvent:true would make the component RECORD a usage event of
    // `requiredBalance` — a sign-free number under caller control, i.e.
    // self-service balance manipulation from the browser console.
    expect(mockAutumn.calls).toEqual([
      {
        method: 'check',
        args: {
          featureId: 'chat_messages',
          requiredBalance: 3,
          sendEvent: false,
          withPreview: true,
          entityId: 'e1',
          entityData: { seat: 'a' },
          customerData: { name: 'N', email: 'n@example.test' },
        },
      },
    ]);
  });

  it('returns a blocked (spent-balance) container from the component unchanged', async () => {
    // The paywall renders straight off this shape; reshaping it here would
    // break usePaywall without any type error.
    const blocked = {
      data: {
        allowed: false,
        balance: 0,
        feature_id: 'chat_messages',
        required_balance: 1,
        preview: { scenario: 'usage_limit', title: 'Out of messages' },
      },
      error: null,
    };
    mockAutumn.responses.check = blocked;
    stubAutumn({});
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.autumn.check, {
      featureId: 'chat_messages',
    });
    expect(res).toEqual(blocked);
  });

  it("passes the component's structured error container through, not as a throw", async () => {
    const failure = {
      data: null,
      error: { message: 'Customer not found', code: 'customer_not_found' },
    };
    mockAutumn.responses.check = failure;
    stubAutumn({});
    const t = convexTest(schema, modules);
    // autumn-js reads `{ data, error }`; converting the error into an
    // exception would surface as an unhandled crash instead of paywall copy.
    await expect(
      asUser(t).action(api.autumn.check, { featureId: 'chat_messages' }),
    ).resolves.toEqual(failure);
  });
});

describe('component identify() config', () => {
  type IdentifyFn = (ctx: {
    auth: { getUserIdentity: () => Promise<Record<string, unknown> | null> };
  }) => Promise<{
    customerId: string;
    customerData: { name?: string; email?: string };
  } | null>;

  it("returns null for unauthenticated callers — the component's rejection mechanism", async () => {
    // check/attach/checkout/createCustomer/... carry no explicit auth check
    // of their own; identify() returning null is what makes the component
    // refuse unauthenticated calls. If this returned a fallback id instead,
    // every public billing action would be open to anonymous callers.
    const identify = mockAutumn.identify as IdentifyFn;
    await expect(
      identify({ auth: { getUserIdentity: async () => null } }),
    ).resolves.toBeNull();
  });

  it('maps the JWT subject to the Autumn customer id, with name/email as customerData', async () => {
    // `subject` is the same id used by consumeQuota and the REST calls in
    // billing.ts; a drift here would fork one user into two Autumn
    // customers (one billed, one entitled).
    const identify = mockAutumn.identify as IdentifyFn;
    await expect(
      identify({
        auth: {
          getUserIdentity: async () => ({
            subject: 'user_a',
            name: 'Ada',
            email: 'ada@example.test',
          }),
        },
      }),
    ).resolves.toEqual({
      customerId: 'user_a',
      customerData: { name: 'Ada', email: 'ada@example.test' },
    });
  });
});

describe('trial gate wiring into the component calls', () => {
  it("a trial-eligible customer's checkout reaches the component untouched", async () => {
    stubAutumn({
      'GET /customers/': { products: [freeProduct], trials_used: [] },
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.autumn.checkout, { productId: 'pro' });
    // No freeTrial key at all: that absence is what makes Autumn apply the
    // plan's configured trial.
    expect(mockAutumn.calls).toEqual([
      { method: 'checkout', args: { productId: 'pro' } },
    ]);
  });

  it("an ex-trialer's checkout reaches the component with freeTrial forced off", async () => {
    stubAutumn({
      'GET /customers/': {
        products: [freeProduct],
        trials_used: [{ product_id: 'basic' }],
      },
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.autumn.checkout, { productId: 'pro' });
    // The anti-trial-hopping pin, observed at the component seam: the gate
    // deciding correctly is not enough if the action drops the gated args.
    expect(mockAutumn.calls).toEqual([
      { method: 'checkout', args: { productId: 'pro', freeTrial: false } },
    ]);
  });

  it("a payer's renew stays on the component (legacy path) and forwards entity args", async () => {
    const renewResult = {
      data: { product: { scenario: 'renew' } },
      error: null,
    };
    mockAutumn.responses.attach = renewResult;
    stubAutumn({ 'GET /customers/': payerCustomer });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.autumn.attach, {
      productId: 'pro',
      entityId: 'seat_1',
      entityData: { kind: 'seat' },
    });
    // Held target ⇒ renew ⇒ legacy component attach (its scheduling
    // semantics un-schedule a pending switch); the v2 reroute must not fire.
    expect(mockAutumn.calls).toEqual([
      {
        method: 'attach',
        args: {
          productId: 'pro',
          entityId: 'seat_1',
          entityData: { kind: 'seat' },
          freeTrial: false,
        },
      },
    ]);
    expect(callsTo('/billing.attach')).toHaveLength(0);
    expect(res).toEqual(renewResult);
  });
});

describe('Managed Payments backstops wired into the actions', () => {
  it('attach refuses a component result carrying a session URL while the flag is on', async () => {
    vi.stubEnv('AUTUMN_MANAGED_PAYMENTS', 'true');
    mockAutumn.responses.attach = {
      data: { checkout_url: 'https://checkout.stripe.com/c/pay/legacy' },
      error: null,
    };
    stubAutumn({ 'GET /customers/': payerCustomer });
    const t = convexTest(schema, modules);
    // A legacy session can never carry merchant of record, and autumn-js
    // would redirect straight into it. The action, not just the helper,
    // must apply the refusal to what the component returned.
    await expect(
      asUser(t).action(api.autumn.attach, { productId: 'pro' }),
    ).rejects.toThrow(/payment method/i);
  });

  it('checkout strips the session URL from the preview but keeps the dialog payload', async () => {
    vi.stubEnv('AUTUMN_MANAGED_PAYMENTS', 'true');
    mockAutumn.responses.checkout = {
      data: {
        url: 'https://checkout.stripe.com/c/pay/x',
        product: { scenario: 'upgrade', properties: { is_free: false } },
        total: 100,
      },
      error: null,
    };
    stubAutumn({
      'GET /customers/': {
        products: [freeProduct, trialingProduct],
        trials_used: [{ product_id: 'basic_annual' }],
      },
    });
    const t = convexTest(schema, modules);
    const res = (await asUser(t).action(api.autumn.checkout, {
      productId: 'pro',
    })) as { data: Record<string, unknown> };
    // autumn-js then opens CheckoutDialog with this data instead of
    // redirecting into a non-MoR sale (the 2026-08-11 incident).
    expect(res.data).not.toHaveProperty('url');
    expect(res.data.product).toEqual({
      scenario: 'upgrade',
      properties: { is_free: false },
    });
    expect(res.data.total).toBe(100);
  });
});

describe('v2 reroute result containers (attachViaV2NoTrial)', () => {
  it('maps payment_url to checkout_url on success, without involving the component', async () => {
    // Fake timers so the scheduled quota sync can be absorbed against the
    // stub before this test's fetch stub is torn down.
    vi.useFakeTimers();
    try {
      stubAutumn({
        ...rerouteBase,
        '/billing.attach': {
          payment_url: 'https://checkout.stripe.com/c/pay/v2',
        },
      });
      const t = convexTest(schema, modules);
      const res = (await asUser(t).action(api.autumn.attach, {
        productId: 'ultra',
      })) as { data: Record<string, unknown>; error: unknown };
      // autumn-js redirects on `checkout_url`; without the mapping a v2
      // payment redirect would be silently dropped and the switch stranded.
      expect(res.error).toBeNull();
      expect(res.data.checkout_url).toBe(
        'https://checkout.stripe.com/c/pay/v2',
      );
      expect(mockAutumn.calls).toHaveLength(0);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves Autumn's structured error as a { data:null, error } container, not a throw", async () => {
    stubAutumn({
      ...rerouteBase,
      '/billing.attach': {
        $status: 402,
        $body: { message: 'Insufficient funds', code: 'card_declined' },
      },
    });
    const t = convexTest(schema, modules);
    // autumn-js's attach handling shows error.message in the dialog; a
    // throw would replace actionable copy with an unhandled crash.
    await expect(
      asUser(t).action(api.autumn.attach, { productId: 'ultra' }),
    ).resolves.toEqual({
      data: null,
      error: { message: 'Insufficient funds', code: 'card_declined' },
    });
  });

  it('falls back to the raw body text (and a stable code) when the error is not JSON', async () => {
    stubAutumn({
      ...rerouteBase,
      '/billing.attach': { $status: 502, $raw: '<html>bad gateway</html>' },
    });
    const t = convexTest(schema, modules);
    const res = (await asUser(t).action(api.autumn.attach, {
      productId: 'ultra',
    })) as { data: unknown; error: { message: string; code: string } };
    expect(res.data).toBeNull();
    expect(res.error.message).toBe('<html>bad gateway</html>');
    expect(res.error.code).toBe('attach_failed');
  });

  it('a successful reroute schedules the quota-mirror refresh (new allowances apply)', async () => {
    vi.useFakeTimers();
    try {
      stubAutumn({
        ...rerouteBase,
        '/billing.attach': { payment_url: null },
        // The scheduled sync enters through get-or-create on the pinned
        // v2.2 shape.
        'POST /customers': {
          subscriptions: [
            { plan_id: 'ultra', status: 'active', add_on: false },
          ],
          balances: {
            chat_messages: {
              feature_id: 'chat_messages',
              granted: 100,
              remaining: 60,
              usage: 40,
              unlimited: false,
            },
          },
        },
      });
      const t = convexTest(schema, modules);
      const res = (await asUser(t).action(api.autumn.attach, {
        productId: 'ultra',
      })) as { error: unknown };
      expect(res.error).toBeNull();

      // The sync is scheduled, not awaited (the confirm must not block on
      // it); drive the scheduler to completion.
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const syncPost = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith('/v1/customers'),
      );
      expect(syncPost).toBeDefined();
      expect(syncPost?.version).toBe('2.2');

      // The common entry point is the low-quota dialog: without this
      // refresh the just-purchased allowances stay locked until the next
      // mount-time sync.
      const doc = await t.run(async (ctx) =>
        ctx.db
          .query('usageQuotas')
          .withIndex('by_userId', (q) => q.eq('userId', USER))
          .first(),
      );
      expect(doc?.planId).toBe('ultra');
      expect(doc?.features['chat_messages']).toMatchObject({
        balance: 60,
        included: 100,
        used: 40,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not schedule the quota refresh after a failed reroute', async () => {
    vi.useFakeTimers();
    try {
      stubAutumn({
        ...rerouteBase,
        '/billing.attach': { $status: 500, $body: { message: 'boom' } },
      });
      const t = convexTest(schema, modules);
      await asUser(t).action(api.autumn.attach, { productId: 'ultra' });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      // No switch happened, so nothing may rewrite the mirror.
      expect(
        calls.filter(
          (c) => c.method === 'POST' && c.url.endsWith('/v1/customers'),
        ),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
