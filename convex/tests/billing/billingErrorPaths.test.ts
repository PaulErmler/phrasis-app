/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

/**
 * Error paths and follow-on-sync pins for convex/billing.ts, complementing
 * switchPlanDuringTrial.test.ts (happy paths + attach wire shapes) and
 * managedPayments.test.ts (MoR params + attachNewPlan trial policy).
 *
 * What is at stake on each branch:
 *
 * - Autumn failures must throw with Autumn's own message preserved
 *   (`autumnFetch` wraps it as "Autumn request failed: <message>"), and a
 *   failed MONEY call must never be followed by the quota re-sync: syncing
 *   after a failed attach would overwrite the local mirror as if the switch
 *   had happened.
 * - A SUCCESSFUL switch must always be followed by the re-sync. That sync is
 *   how the new plan's allowances reach the local quota mirror; skipping it
 *   leaves the user locked behind stale balances they just paid to raise.
 * - A free target must never reach the immediate v2 branch, whichever
 *   scenario Autumn's classifier claims: `customize.free_trial` on a free
 *   plan is meaningless and the scheduled path is the only correct one.
 */

const USER = "user_err";
const TRIAL_END = Date.now() + 5 * 24 * 60 * 60 * 1000;

type Call = { url: string; method: string; body: any; version: string | null };

let calls: Call[] = [];

/**
 * Route stubbed responses by URL substring, optionally gated on method via a
 * "METHOD " key prefix ("POST /customers" for get-or-create, which has no
 * trailing slash and must not swallow `GET /customers/:id`). A
 * `{ $status, $body }` value produces a non-ok response.
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
    const key = Object.keys(routes).find((k) => {
      const sep = k.indexOf(" ");
      const wantMethod = sep === -1 ? undefined : k.slice(0, sep);
      const path = sep === -1 ? k : k.slice(sep + 1);
      return (
        (wantMethod === undefined || wantMethod === method) &&
        url.includes(path)
      );
    });
    const raw = key !== undefined ? routes[key] : {};
    const errorSpec =
      raw !== null && typeof raw === "object" && "$status" in raw
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
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const trialingProduct = (over: Record<string, unknown> = {}) => ({
  id: "basic_annual",
  status: "trialing",
  is_default: false,
  is_add_on: false,
  trial_ends_at: null,
  current_period_end: TRIAL_END,
  ...over,
});

const freeProduct = {
  id: "free",
  status: "active",
  is_default: true,
  is_add_on: false,
};

const pastDueBasic = {
  id: "basic",
  status: "past_due",
  is_default: false,
  is_add_on: false,
};

/**
 * What get-or-create (v2.2) reports for the follow-on sync: the post-switch
 * plan plus balances the sync can mirror. Asymmetric numbers so a swapped
 * remaining/granted/usage mapping cannot cancel out.
 */
const postSwitchCustomer = {
  subscriptions: [
    { plan_id: "pro", status: "active", add_on: false, past_due: false },
  ],
  balances: {
    chat_messages: {
      feature_id: "chat_messages",
      granted: 100,
      remaining: 60,
      usage: 40,
      unlimited: false,
    },
  },
};

const asUser = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: USER });

const callsTo = (path: string) => calls.filter((c) => c.url.includes(path));

/**
 * The follow-on quota sync always enters through get-or-create: POST
 * /customers with no trailing slash. Its presence/absence is the proof the
 * sync did or did not run.
 */
const syncPosts = () =>
  calls.filter((c) => c.method === "POST" && c.url.endsWith("/v1/customers"));

const getQuotaDoc = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    ctx.db
      .query("usageQuotas")
      .withIndex("by_userId", (q) => q.eq("userId", USER))
      .first(),
  );

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls = [];
  vi.stubEnv("AUTUMN_SECRET_KEY", "am_sk_test_stub");
  // Every failure path here logs the Autumn body before throwing; keep the
  // run output clean while still letting assertions read the thrown message.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("switchPlanDuringTrial error paths", () => {
  it("customer fetch failure → throws with Autumn's message, nothing else is called", async () => {
    stubAutumn({
      "GET /customers/": { $status: 500, $body: { message: "autumn is down" } },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: "pro" }),
    ).rejects.toThrow(/Autumn request failed: autumn is down/);
    // No preview, no attach of either kind, no sync: the action learned
    // nothing about the customer and must change nothing.
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("trialing plan with no readable trial end → refuses the switch", async () => {
    stubAutumn({
      "GET /customers/": {
        products: [
          trialingProduct({ trial_ends_at: null, current_period_end: null }),
        ],
      },
    });
    const t = convexTest(schema, modules);
    // Without an end date the remaining-days math is impossible; guessing
    // would either extend the trial or bill immediately.
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: "pro" }),
    ).rejects.toThrow(/trial end date unavailable/i);
    expect(callsTo("/checkout")).toHaveLength(0);
  });

  it("trial end already in the past → refuses the switch", async () => {
    stubAutumn({
      "GET /customers/": {
        products: [
          trialingProduct({ current_period_end: Date.now() - 60_000 }),
        ],
      },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: "pro" }),
    ).rejects.toThrow(/already passed/i);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("checkout preview failure → throws, no attach, no sync", async () => {
    stubAutumn({
      "GET /customers/": { products: [trialingProduct()] },
      "/checkout": { $status: 500, $body: { message: "preview broke" } },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: "pro" }),
    ).rejects.toThrow(/Autumn request failed: preview broke/);
    // Attaching without Autumn's classification would guess the direction.
    expect(callsTo("/attach")).toHaveLength(0);
    expect(callsTo("/billing.attach")).toHaveLength(0);
    expect(syncPosts()).toHaveLength(0);
  });

  it("a free target with a non-scheduling scenario is refused before any attach", async () => {
    // The classifier normally reports downgrade/cancel for a free target; if
    // it ever reports upgrade/new, following the immediate branch would send
    // `customize.free_trial` on a FREE plan. Refuse rather than guess.
    stubAutumn({
      "GET /customers/": { products: [trialingProduct()] },
      "/checkout": {
        product: { scenario: "upgrade", properties: { is_free: true } },
      },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: "free" }),
    ).rejects.toThrow(/not applicable during trial \(scenario: upgrade\)/i);
    expect(callsTo("/attach")).toHaveLength(0);
    expect(callsTo("/billing.attach")).toHaveLength(0);
  });

  it("a missing scenario reports 'unknown' rather than attaching blind", async () => {
    stubAutumn({
      "GET /customers/": { products: [trialingProduct()] },
      "/checkout": {},
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: "pro" }),
    ).rejects.toThrow(/scenario: unknown/i);
    expect(callsTo("/attach")).toHaveLength(0);
    expect(callsTo("/billing.attach")).toHaveLength(0);
  });

  it("failed v2 attach on the upgrade path → throws with the message, mirror untouched", async () => {
    stubAutumn({
      "GET /customers/": { products: [trialingProduct()] },
      "/checkout": {
        product: { scenario: "upgrade", properties: { is_free: false } },
      },
      "/billing.attach": { $status: 402, $body: { message: "card declined" } },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, { productId: "pro" }),
    ).rejects.toThrow(/Autumn request failed: card declined/);
    // The money call failed: syncing now would refresh the mirror as if the
    // switch had happened.
    expect(syncPosts()).toHaveLength(0);
  });

  it("failed legacy attach on the downgrade path → throws, no sync", async () => {
    stubAutumn({
      "GET /customers/": { products: [trialingProduct()] },
      "/checkout": {
        product: { scenario: "downgrade", properties: { is_free: false } },
      },
      "POST /attach": { $status: 500, $body: { message: "attach broke" } },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.switchPlanDuringTrial, {
        productId: "basic",
      }),
    ).rejects.toThrow(/Autumn request failed: attach broke/);
    expect(syncPosts()).toHaveLength(0);
  });
});

describe("switchPlanDuringTrial follow-on quota sync", () => {
  it("a successful upgrade re-syncs the quota mirror with the new plan's balances", async () => {
    stubAutumn({
      "GET /customers/": { products: [trialingProduct()] },
      "/checkout": {
        product: { scenario: "upgrade", properties: { is_free: false } },
      },
      "/billing.attach": { payment_url: null },
      "POST /customers": postSwitchCustomer,
    });
    const t = convexTest(schema, modules);
    await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: "pro",
    });

    // Exactly one sync, on the pinned v2.2 shape (the version the sync's
    // payload parsing depends on).
    expect(syncPosts()).toHaveLength(1);
    expect(syncPosts()[0].version).toBe("2.2");

    // And it landed: the local mirror now carries the post-switch plan and
    // balances, so the paid-for allowances apply without waiting for the
    // next mount-time sync.
    const doc = await getQuotaDoc(t);
    expect(doc?.planId).toBe("pro");
    expect(doc?.features["chat_messages"]).toMatchObject({
      balance: 60,
      included: 100,
      used: 40,
    });
  });

  it("a scheduled downgrade re-syncs too", async () => {
    stubAutumn({
      "GET /customers/": { products: [trialingProduct()] },
      "/checkout": {
        product: { scenario: "downgrade", properties: { is_free: false } },
      },
      "POST /customers": postSwitchCustomer,
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.switchPlanDuringTrial, {
      productId: "basic",
    });
    expect(res.mode).toBe("scheduled");
    expect(syncPosts()).toHaveLength(1);
  });
});

describe("attachNewPlan error paths", () => {
  it("customer fetch failure other than 404 → throws, no attach", async () => {
    // Only a 404 means "brand-new customer"; any other failure means the
    // trial policy could not be derived, and attaching anyway would hand
    // out (or wrongly deny) a trial based on nothing.
    stubAutumn({
      "GET /customers/": { $status: 503, $body: { message: "upstream sad" } },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.attachNewPlan, { productId: "pro" }),
    ).rejects.toThrow(/Autumn request failed: upstream sad/);
    expect(callsTo("/billing.attach")).toHaveLength(0);
    expect(syncPosts()).toHaveLength(0);
  });

  it("failed v2 attach → throws with the message, no follow-on sync", async () => {
    stubAutumn({
      "GET /customers/": { products: [freeProduct], trials_used: [] },
      "/billing.attach": {
        $status: 400,
        $body: { message: "plan not purchasable" },
      },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.attachNewPlan, { productId: "pro" }),
    ).rejects.toThrow(/Autumn request failed: plan not purchasable/);
    expect(syncPosts()).toHaveLength(0);
  });

  it("a successful first purchase runs the follow-on sync", async () => {
    stubAutumn({
      "GET /customers/": { products: [freeProduct], trials_used: [] },
      "/billing.attach": { payment_url: "https://checkout.stripe.com/c/pay/a" },
      "POST /customers": postSwitchCustomer,
    });
    const t = convexTest(schema, modules);
    const res = await asUser(t).action(api.billing.attachNewPlan, {
      productId: "pro",
    });
    expect(res.paymentUrl).toBe("https://checkout.stripe.com/c/pay/a");
    // Normally a no-op refresh (the subscription starts when the customer
    // returns from Stripe), but it must run: it heals the mirror if Autumn
    // ever settles a call inline.
    expect(syncPosts()).toHaveLength(1);
  });
});

describe("cancelOverdueSubscription error paths", () => {
  it("rejects an unauthenticated caller", async () => {
    stubAutumn({});
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.billing.cancelOverdueSubscription, {}),
    ).rejects.toThrow(/not authenticated/i);
    expect(calls).toHaveLength(0);
  });

  it("customer fetch failure → throws, cancels nothing, syncs nothing", async () => {
    // Cancelling based on a failed read could destroy a subscription whose
    // real state was healthy.
    stubAutumn({
      "GET /customers/": { $status: 500, $body: { message: "read failed" } },
    });
    const t = convexTest(schema, modules);
    await expect(
      asUser(t).action(api.billing.cancelOverdueSubscription, {}),
    ).rejects.toThrow(/Autumn request failed: read failed/);
    expect(callsTo("/cancel")).toHaveLength(0);
    expect(syncPosts()).toHaveLength(0);
  });

  it("a failed follow-on sync does not undo or hide a successful cancel", async () => {
    stubAutumn({
      "GET /customers/": { products: [freeProduct, pastDueBasic] },
      "/cancel": { success: true },
      "POST /customers": { $status: 500, $body: { message: "sync broke" } },
    });
    const t = convexTest(schema, modules);
    // The money-side cancel already executed and cannot be re-run, so the
    // sync layer absorbs its own failure (getOrCreateCustomer logs and
    // returns null) and the action still reports what actually happened.
    const res = await asUser(t).action(api.billing.cancelOverdueSubscription, {});
    expect(res.outcome).toBe("cancelled");
    expect(res.cancelledProductId).toBe("basic");
    // The sync was attempted; its failure was logged, not thrown.
    expect(syncPosts()).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
  });
});
