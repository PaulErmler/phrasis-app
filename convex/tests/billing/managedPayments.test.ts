/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

// convex/autumn.ts throws at import when AUTUMN_SECRET_KEY is unset, so the
// env is stubbed BEFORE the (deliberately dynamic) import — same pattern as
// trialGate.test.ts.
vi.stubEnv("AUTUMN_SECRET_KEY", "am_sk_test_stub");
const {
  rejectLegacySessionUnderManagedPayments,
  stripLegacySessionUnderManagedPayments,
} = await import("../../autumn");

/**
 * Stripe Managed Payments (merchant of record) is activated by one opaque
 * field forwarded to Stripe — `checkout_session_params.managed_payments`.
 * Nothing type-checks it end to end and no UI shows it, so the only way a
 * regression surfaces in production is as tax silently no longer being
 * charged, or as a Stripe 400 on every upgrade.
 *
 * These tests pin the wire shape on the v2 `/billing.attach` path, which is
 * the path expected to actually support Managed Payments: autumn-js pins
 * `x-api-version: 1.2`, routing the component's `attach` to Autumn's legacy
 * handler and a pre-Basil Stripe client, while this hand-rolled REST call
 * is unpinned.
 *
 * Note the casing assertions. This body is hand-written snake_case (nothing
 * case-converts it) whereas the Convex component's args are camelCase with
 * the children of `checkoutSessionParams` excluded from conversion. Both end
 * up snake_case at Stripe by different routes, which is exactly the kind of
 * thing a "consistency" refactor breaks.
 */

const USER = "user_mp";
const TRIAL_END = Date.now() + 5 * 24 * 60 * 60 * 1000;

type Call = { url: string; method: string; body: any; version: string | null };

let calls: Call[] = [];

/**
 * Route values are response payloads; wrap one as
 * `{ __status: 404, __body: {...} }` to answer with a non-2xx.
 */
function stubAutumn(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, init: any = {}) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body) : undefined,
      version: init?.headers?.["x-api-version"] ?? null,
    });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key !== undefined ? routes[key] : {};
    const isErrorRoute =
      typeof route === "object" && route !== null && "__status" in route;
    const status = isErrorRoute ? (route as any).__status : 200;
    const payload = isErrorRoute ? ((route as any).__body ?? {}) : route;
    return {
      ok: status < 400,
      status,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const trialingProduct = {
  id: "basic_annual",
  status: "trialing",
  is_default: false,
  is_add_on: false,
  trial_ends_at: null,
  current_period_end: TRIAL_END,
};

const freeProduct = {
  id: "free",
  status: "active",
  is_default: true,
  is_add_on: false,
};

const paidProduct = {
  id: "pro",
  status: "active",
  is_default: false,
  is_add_on: false,
};

/**
 * A real payer's customer payload. NOT `[freeProduct, paidProduct]`: a
 * customer who subscribes to a paid tier no longer holds `free` (verified in
 * the sandbox — documentation/autumn-usage-tracking.md). The earlier fixture
 * shape masked the cancel-to-Free routing bug: with `free` in `products`,
 * `targetIsHeld` was true and the cancel looked legacy-routed when for real
 * payers it was not.
 */
const payerCustomer = { products: [paidProduct] };

/** v1.2 `GET /products/:id` records for the attach routing decision. */
const freeProductRecord = {
  id: "free",
  is_default: true,
  properties: { is_free: true },
};
const paidProductRecord = {
  id: "ultra",
  is_default: false,
  properties: { is_free: false },
};

/** Routes for the upgrade branch — the only one that reaches billing.attach. */
const upgradeRoutes = {
  "/customers/": { products: [trialingProduct] },
  "/checkout": {
    product: { scenario: "upgrade", properties: { is_free: false } },
  },
  "/billing.attach": { payment_url: null },
};

const asUser = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: USER });

const attachBody = () =>
  calls.find((c) => c.url.includes("/billing.attach"))?.body;

beforeEach(() => {
  calls = [];
  vi.stubEnv("AUTUMN_SECRET_KEY", "am_sk_test_stub");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Managed Payments flag on switchPlanDuringTrial", () => {
  it("omits checkout_session_params entirely when the flag is unset", async () => {
    stubAutumn(upgradeRoutes);
    const t = convexTest(schema, modules);
    await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: "pro",
    });
    expect(attachBody()).not.toHaveProperty("checkout_session_params");
  });

  it("omits it for any value other than the literal 'true'", async () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "1");
    stubAutumn(upgradeRoutes);
    const t = convexTest(schema, modules);
    await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: "pro",
    });
    expect(attachBody()).not.toHaveProperty("checkout_session_params");
  });

  it("forwards managed_payments in snake_case when enabled", async () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    stubAutumn(upgradeRoutes);
    const t = convexTest(schema, modules);
    await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: "pro",
    });
    const body = attachBody();
    expect(body.checkout_session_params).toEqual({
      managed_payments: { enabled: true },
    });
    expect(body).not.toHaveProperty("checkoutSessionParams");
  });

  it("does not disturb the trial carry-over it shares the body with", async () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    stubAutumn(upgradeRoutes);
    const t = convexTest(schema, modules);
    await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: "pro",
    });
    const body = attachBody();
    expect(body.customize.free_trial.duration_length).toBe(5);
    expect(body.customize.free_trial.card_required).toBe(true);
    expect(body.redirect_mode).toBe("if_required");
  });

  it("forwards managed_payments on the first-purchase v2 path", async () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    stubAutumn({
      "/customers/": { products: [freeProduct], trials_used: [] },
      "/billing.attach": { payment_url: "https://checkout.stripe.com/c/pay/x" },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.attachNewPlan, {
      productId: "pro",
    });
    expect(res.paymentUrl).toBe("https://checkout.stripe.com/c/pay/x");
    const body = attachBody();
    expect(body.checkout_session_params).toEqual({
      managed_payments: { enabled: true },
    });
    expect(body.plan_id).toBe("pro");
    expect(body.redirect_mode).toBe("always");
  });

  it("uses redirect_mode 'always' even with the flag off — never an inline charge", async () => {
    // 'if_required' would bill a lapsed subscriber's surviving saved card
    // directly: no Checkout Session, no confirmation step — and with MoR on,
    // a subscription that is silently not merchant-of-record.
    stubAutumn({
      "/customers/": { products: [freeProduct], trials_used: [] },
      "/billing.attach": { payment_url: null },
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.billing.attachNewPlan, { productId: "pro" });
    expect(attachBody().redirect_mode).toBe("always");
    expect(attachBody()).not.toHaveProperty("checkout_session_params");
  });

  it("stays off the scheduled/downgrade path, which never creates a session", async () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    stubAutumn({
      "/customers/": { products: [trialingProduct] },
      "/checkout": {
        product: { scenario: "downgrade", properties: { is_free: false } },
      },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: "basic",
    });
    expect(res.mode).toBe("scheduled");
    expect(calls.filter((c) => c.url.includes("/billing.attach"))).toHaveLength(
      0,
    );
  });
});

/**
 * The v2 first-purchase path re-implements the trial policy that
 * `gateTrialArgs` enforces on the legacy path. It is a public action, so these
 * are the same anti-trial-hopping guarantees, re-pinned on the new route: a
 * second trial is worth weeks of paid usage, and `customize.free_trial: null`
 * is the only thing preventing it here.
 */
describe("attachNewPlan trial policy", () => {
  it("lets a never-trialed customer take the plan's configured trial", async () => {
    stubAutumn({
      "/customers/": { products: [freeProduct], trials_used: [] },
      "/billing.attach": { payment_url: null },
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.billing.attachNewPlan, { productId: "pro" });
    // Passing no `customize` is what makes Autumn apply the plan's own trial.
    expect(attachBody()).not.toHaveProperty("customize");
  });

  it("suppresses the trial for anyone who has already used one", async () => {
    stubAutumn({
      "/customers/": {
        products: [freeProduct],
        trials_used: [{ product_id: "basic" }],
      },
      "/billing.attach": { payment_url: null },
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.billing.attachNewPlan, { productId: "pro" });
    expect(attachBody().customize).toEqual({ free_trial: null });
  });

  it("refuses a trialing customer — that route is switchPlanDuringTrial", async () => {
    stubAutumn({ "/customers/": { products: [trialingProduct] } });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.attachNewPlan, { productId: "pro" }),
    ).rejects.toThrow(/switchPlanDuringTrial/);
    expect(calls.filter((c) => c.url.includes("/billing.attach"))).toHaveLength(
      0,
    );
  });

  it("refuses an existing payer — that is an in-place subscription update", async () => {
    stubAutumn({ "/customers/": payerCustomer });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.attachNewPlan, { productId: "ultra" }),
    ).rejects.toThrow(/already on a paid plan/i);
  });

  it("rejects an unauthenticated caller", async () => {
    stubAutumn({});
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.billing.attachNewPlan, { productId: "pro" }),
    ).rejects.toThrow(/not authenticated/i);
  });
});

/**
 * The legacy autumn-js path (convex/autumn.ts `attach`/`checkout`) cannot
 * carry Managed Payments — Autumn's v1.2 handler builds its Stripe client on
 * a pre-Basil API version. And it isn't just attach: for a card-less
 * customer the v1.2 `/checkout` PREVIEW itself creates the session and
 * autumn-js redirects straight to it. The client routes first purchases to
 * `billing.attachNewPlan` before calling either action; the server-side
 * guard is what stops a STALE client from completing a first purchase
 * without merchant of record.
 */
describe("legacy-path guard under Managed Payments", () => {
  for (const kind of ["attach", "checkout"] as const) {
    it(`rejects a first purchase on legacy ${kind} while the flag is on`, async () => {
      vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
      stubAutumn({
        "/customers/": { products: [freeProduct], trials_used: [] },
      });
      const t = convexTest(schema, modules);
      await expect(
        asUser(t).action(api.autumn[kind], { productId: "pro" }),
      ).rejects.toThrow(/refresh the page/i);
      // Thrown before anything reached Autumn — only the trial-gate
      // customer GET may have gone out.
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    });

    it(`does not guard ${kind} for a first purchase while the flag is off`, async () => {
      stubAutumn({
        "/customers/": { products: [freeProduct], trials_used: [] },
      });
      const t = convexTest(schema, modules);
      // Downstream the un-guarded call hits the Autumn component, which this
      // harness doesn't register — all that matters here is that the failure
      // is NOT the guard's.
      const err = await asUser(t)
        .action(api.autumn[kind], { productId: "pro" })
        .then(() => null)
        .catch((e: unknown) => String(e));
      expect(err ?? "").not.toMatch(/refresh the page/i);
    });
  }

  it("routes an existing payer's cross-plan switch to v2 with the trial suppressed", async () => {
    // The legacy /attach can no longer express "no trial": `false` is lost
    // in Autumn's v1.2→v2 translation (a paying upgrader live-received a
    // fresh 7-day trial plus a credit note, 2026-08-09) and `null` fails
    // its schema. Cross-plan switches therefore go to v2, whose
    // customize.free_trial:null works.
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    stubAutumn({
      "/customers/": payerCustomer,
      "/products/ultra": paidProductRecord,
      "/billing.attach": { payment_url: null },
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.autumn.attach, { productId: "ultra" });
    const body = attachBody();
    expect(body.plan_id).toBe("ultra");
    expect(body.customize).toEqual({ free_trial: null });
    expect(body.checkout_session_params).toEqual({
      managed_payments: { enabled: true },
    });
    const call = calls.find((c) => c.url.includes("/billing.attach"));
    expect(call?.version).toBe("2.1.0");
  });

  it("routes the payer switch to v2 with the flag off too — no session params", async () => {
    stubAutumn({
      "/customers/": payerCustomer,
      "/products/ultra": paidProductRecord,
      "/billing.attach": { payment_url: null },
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.autumn.attach, { productId: "ultra" });
    const body = attachBody();
    expect(body.customize).toEqual({ free_trial: null });
    expect(body).not.toHaveProperty("checkout_session_params");
  });

  it("keeps renew (re-attaching a held plan) on the legacy path", async () => {
    stubAutumn({
      "/customers/": payerCustomer,
    });
    const t = convexTest(schema, modules);
    // Downstream the legacy call hits the Autumn component, which this
    // harness doesn't register — what matters is that no v2 attach fired.
    await asUser(t)
      .action(api.autumn.attach, { productId: paidProduct.id })
      .catch(() => null);
    expect(
      calls.filter((c) => c.url.includes("/billing.attach")),
    ).toHaveLength(0);
  });

  it("an EXPIRED entry matching the target is not a renew — still reroutes to v2", async () => {
    // A payer returning to a plan they once held (the old entry lingers as
    // `expired` in the payload) is a cross-plan switch: reading it as a
    // renew would keep the attach on the legacy path, where "no trial" is
    // silently lost — the 2026-08-09 incident class.
    stubAutumn({
      "/customers/": {
        products: [
          paidProduct,
          { id: "basic", status: "expired", is_default: false, is_add_on: false },
        ],
        trials_used: [{ product_id: "basic" }],
      },
      "/products/basic": {
        id: "basic",
        is_default: false,
        properties: { is_free: false },
      },
      "/billing.attach": { payment_url: null },
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.autumn.attach, { productId: "basic" });
    const body = attachBody();
    expect(body.plan_id).toBe("basic");
    expect(body.customize).toEqual({ free_trial: null });
  });

  it("does not guard a trialing customer's checkout preview while the flag is on", async () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    stubAutumn({
      "/customers/": {
        products: [freeProduct, trialingProduct],
        trials_used: [{ product_id: "basic_annual" }],
      },
    });
    const t = convexTest(schema, modules);
    // The trial-switch dialog needs this preview to render.
    const err = await asUser(t)
      .action(api.autumn.checkout, { productId: "pro" })
      .then(() => null)
      .catch((e: unknown) => String(e));
    expect(err ?? "").not.toMatch(/refresh the page/i);
  });

  it("rejects client-supplied checkoutSessionParams at the validator", async () => {
    // The component would forward these verbatim onto the Stripe session —
    // a client could pass managed_payments:{enabled:false} and shift the
    // sale's tax liability onto us. The public surface must not accept it.
    stubAutumn({
      "/customers/": { products: [freeProduct], trials_used: [] },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.autumn.attach, {
        productId: "pro",
        checkoutSessionParams: { managed_payments: { enabled: false } },
      } as never),
    ).rejects.toThrow(/checkoutSessionParams/);
  });

  it("rejects productIds at the validator — it would bypass the v2 no-trial routing", async () => {
    // The reroute keys on `productId`; an attach via `productIds` would fall
    // through to the legacy path, where "no trial" is silently lost — the
    // exact live incident (2026-08-09) the routing exists to prevent.
    stubAutumn({ "/customers/": payerCustomer });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.autumn.attach, {
        productIds: ["pro_annual"],
      } as never),
    ).rejects.toThrow(/productIds/);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("rejects forceCheckout at the validator — a demanded session can never carry MoR", async () => {
    stubAutumn({ "/customers/": payerCustomer });
    const t = convexTest(schema, modules);
    for (const kind of ["attach", "checkout"] as const) {
      await expect(
        asUser(t).action(api.autumn[kind], {
          productId: "ultra",
          forceCheckout: true,
        } as never),
      ).rejects.toThrow(/forceCheckout/);
    }
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

/**
 * The routing decision inside `attach` for customers whose trial is
 * suppressed. The subtlety these pin: a real payer does NOT hold the free
 * plan (sandbox-verified), so "target not held" alone cannot distinguish a
 * cross-plan switch (must go to v2) from a cancel-to-Free (must stay legacy —
 * v2's attach_action has no cancel, and free has no trial to suppress).
 */
describe("attach routing for trial-suppressed switches", () => {
  it("keeps cancel-to-Free on the legacy path for a real payer", async () => {
    stubAutumn({
      "/customers/": payerCustomer,
      "/products/free": freeProductRecord,
    });
    const t = convexTest(schema, modules);
    // Downstream the legacy call hits the Autumn component, which this
    // harness doesn't register — what matters is that no v2 attach fired
    // and the routing consulted the product record.
    await asUser(t)
      .action(api.autumn.attach, { productId: "free" })
      .catch(() => null);
    expect(
      calls.filter((c) => c.url.includes("/billing.attach")),
    ).toHaveLength(0);
    expect(calls.some((c) => c.url.includes("/products/free"))).toBe(true);
  });

  it("fails closed when the target's product record cannot be read", async () => {
    // Guessing the route here could either immediate-cancel a paid
    // subscription (v2 on a free target) or hand out a trial (legacy on a
    // paid target) — refuse instead.
    stubAutumn({
      "/customers/": payerCustomer,
      "/products/ultra": { __status: 500, __body: { message: "boom" } },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const t = convexTest(schema, modules);
      await expect(
        asUser(t).action(api.autumn.attach, { productId: "ultra" }),
      ).rejects.toThrow(/selected plan/);
      expect(
        calls.filter((c) => c.url.includes("/billing.attach")),
      ).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("refuses validator-accepted args the v2 reroute cannot forward", async () => {
    // attachViaV2NoTrial sends only productId/options; silently dropping a
    // reward (or entityId, successUrl, …) would report success while the
    // referral never applies. Nothing in the app sends these — fail loud.
    stubAutumn({
      "/customers/": payerCustomer,
      "/products/ultra": paidProductRecord,
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.autumn.attach, {
        productId: "ultra",
        reward: "promo_code",
      }),
    ).rejects.toThrow(/reward/);
    expect(
      calls.filter((c) => c.url.includes("/billing.attach")),
    ).toHaveLength(0);
  });
});

describe("grandfathered free attachments (is_default:false)", () => {
  // Old customers' free-plan rows carry NO default flag on v1.2 (live
  // payload, 2026-08-11). They must still route as FIRST purchases: the
  // 2026-08-11 incident was exactly this — the flag-less free plan read as
  // a paid plan, the customer was sent down the legacy path, and the
  // cardless preview minted a session the MoR backstop then blocked.
  const grandfatheredFree = {
    id: "free",
    status: "active",
    is_default: false,
    is_add_on: false,
  };

  it("attachNewPlan accepts them as a first purchase", async () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    stubAutumn({
      "/customers/": { products: [grandfatheredFree], trials_used: [] },
      "/billing.attach": { payment_url: "https://checkout.stripe.com/c/pay/z" },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.attachNewPlan, {
      productId: "pro",
    });
    expect(res.paymentUrl).toBe("https://checkout.stripe.com/c/pay/z");
    expect(attachBody().redirect_mode).toBe("always");
  });

  it("the legacy guard still blocks their first purchase while the flag is on", async () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    stubAutumn({
      "/customers/": { products: [grandfatheredFree], trials_used: [] },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.autumn.checkout, { productId: "pro" }),
    ).rejects.toThrow(/refresh the page/i);
  });
});

describe("attachNewPlan before the Autumn customer exists", () => {
  it("treats a 404 customer fetch as a brand-new, trial-eligible customer", async () => {
    // A brand-new user's very first checkout can run before any Autumn
    // customer exists — exactly the flow this action owns. Throwing on the
    // 404 (as any other Autumn error does) would fail every such purchase.
    stubAutumn({
      "/customers/": { __status: 404, __body: { message: "not found" } },
      "/billing.attach": { payment_url: "https://checkout.stripe.com/c/pay/y" },
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.attachNewPlan, {
      productId: "pro",
    });
    expect(res.paymentUrl).toBe("https://checkout.stripe.com/c/pay/y");
    const body = attachBody();
    expect(body.redirect_mode).toBe("always");
    // History-free ⇒ trial-eligible: no customize, Autumn applies the
    // plan's configured trial.
    expect(body).not.toHaveProperty("customize");
  });
});

/**
 * The legacy-session backstops behind `guardFirstPurchaseOffLegacyPath`.
 * Autumn's v1.2 endpoints build a Checkout Session whenever they deem the
 * customer cardless — which includes customers whose card was collected on
 * a MANAGED PAYMENTS session (the trial-start flow): the MoR payment method
 * is not a usable default for new legacy sessions, so even a brand-new
 * trialing customer's next plan click comes back with a session URL that
 * autumn-js would redirect into (a non-MoR sale — live incident,
 * 2026-08-11).
 *
 * The PREVIEW strips the url — the session-bearing response still carries
 * the full dialog payload (probed live 2026-08-11), and the dialog's
 * confirm paths produce MoR-capable sessions. The ATTACH result has no
 * dialog to fall back to, so it refuses instead.
 */
describe("rejectLegacySessionUnderManagedPayments (attach results)", () => {
  it("refuses a legacy attach result carrying a session URL while the flag is on", () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    for (const data of [
      { url: "https://checkout.stripe.com/c/pay/x" },
      { checkout_url: "https://checkout.stripe.com/c/pay/x" },
    ]) {
      expect(() =>
        rejectLegacySessionUnderManagedPayments({ data, error: null }),
      ).toThrow(/payment method/i);
    }
  });

  it("passes session-free results and error containers through", () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    for (const result of [
      { data: { product: { scenario: "upgrade" } }, error: null },
      { data: null, error: { message: "nope", code: "attach_failed" } },
      null,
    ]) {
      expect(() =>
        rejectLegacySessionUnderManagedPayments(result),
      ).not.toThrow();
    }
  });

  it("is inert while the flag is off — legacy sessions are the normal path there", () => {
    expect(() =>
      rejectLegacySessionUnderManagedPayments({
        data: { url: "https://checkout.stripe.com/c/pay/x" },
        error: null,
      }),
    ).not.toThrow();
  });
});

describe("stripLegacySessionUnderManagedPayments (checkout previews)", () => {
  it("removes the session url but keeps the dialog payload while the flag is on", () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const result = {
        data: {
          url: "https://checkout.stripe.com/c/pay/x",
          product: { scenario: "upgrade", properties: { is_free: false } },
          lines: [{ amount: 100 }],
          total: 100,
          next_cycle: { starts_at: 1 },
        },
        error: null,
      };
      stripLegacySessionUnderManagedPayments(result);
      // No url → autumn-js falls through to opening CheckoutDialog with
      // this same data; its confirm goes through switchPlanDuringTrial or
      // the v2 attach reroute, both MoR-capable.
      expect(result.data).not.toHaveProperty("url");
      expect(result.data.product.scenario).toBe("upgrade");
      expect(result.data.total).toBe(100);
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("leaves session-free previews and error containers untouched", () => {
    vi.stubEnv("AUTUMN_MANAGED_PAYMENTS", "true");
    const preview = {
      data: { product: { scenario: "downgrade" } },
      error: null,
    };
    stripLegacySessionUnderManagedPayments(preview);
    expect(preview.data).toEqual({ product: { scenario: "downgrade" } });
    expect(() =>
      stripLegacySessionUnderManagedPayments({ data: null, error: {} }),
    ).not.toThrow();
  });

  it("is inert while the flag is off — the url is the legitimate legacy redirect", () => {
    const result = {
      data: { url: "https://checkout.stripe.com/c/pay/x" },
      error: null,
    };
    stripLegacySessionUnderManagedPayments(result);
    expect(result.data.url).toBe("https://checkout.stripe.com/c/pay/x");
  });
});
