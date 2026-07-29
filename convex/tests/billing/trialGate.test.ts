/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ActionCtx } from "../../_generated/server";

/**
 * Unit tests for the server-side trial gate in convex/autumn.ts.
 *
 * `attach`/`checkout` are PUBLIC actions: anyone with a session can call
 * them from the browser console with arbitrary args. Autumn's own trial
 * dedup is per-plan, so without this gate a user could hop
 * basic → pro → basic_annual and collect a fresh free trial on every plan —
 * weeks of paid usage for free. These tests pin the gate's decisions (and
 * the module's public surface, which closes the sibling negative-`track`
 * exploit) so a refactor can't quietly re-open either hole.
 *
 * The module throws at import when AUTUMN_SECRET_KEY is unset, so the env
 * is stubbed BEFORE the (deliberately dynamic) import.
 */
vi.stubEnv("AUTUMN_SECRET_KEY", "am_sk_test_stub");
const autumnModule = await import("../../autumn");
const { gateTrialArgs } = autumnModule;

const USER = "user_x";

/**
 * The gate's generic is bounded by the weak type `{ freeTrial?: boolean }`,
 * which rejects a bare `{ productId }` literal — so args spell the optional
 * field out (matching what the attach/checkout actions actually pass).
 */
type GateArgs = { productId: string; freeTrial?: boolean };

/** Ctx double: the gate only ever touches auth.getUserIdentity. */
const ctxAs = (identity: { subject: string } | null): ActionCtx =>
  ({ auth: { getUserIdentity: async () => identity } }) as never;

type Call = { url: string; method: string; version: string | null };
let calls: Call[] = [];

/** One-route stub: every fetch answers with the given customer response. */
function stubCustomerFetch(res: {
  status?: number;
  ok?: boolean;
  body?: unknown;
}) {
  const fetchMock = vi.fn(async (url: string, init: any = {}) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      version: init?.headers?.["x-api-version"] ?? null,
    });
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      text: async () => JSON.stringify(res.body ?? {}),
      json: async () => res.body ?? {},
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// v1.2 `products[]` shape — what the gate's x-api-version '1.2' GET returns.
const freeProduct = {
  id: "free",
  status: "active",
  is_default: true,
  is_add_on: false,
};
const trialingProduct = {
  id: "basic_annual",
  status: "trialing",
  is_default: false,
  is_add_on: false,
  trial_ends_at: null,
  current_period_end: Date.now() + 5 * 24 * 60 * 60 * 1000,
};

beforeEach(() => {
  calls = [];
  vi.stubEnv("AUTUMN_SECRET_KEY", "am_sk_test_stub");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("gateTrialArgs", () => {
  it("passes a trial-eligible customer through untouched, so Autumn starts the configured trial", async () => {
    stubCustomerFetch({
      body: { products: [freeProduct], trials_used: [] },
    });
    const args: GateArgs = { productId: "basic" };
    const result = await gateTrialArgs(ctxAs({ subject: USER }), "checkout", args);

    // Same object, no freeTrial injected — injecting `freeTrial: false` here
    // would silently deny every legitimate first trial.
    expect(result).toBe(args);
    expect("freeTrial" in result).toBe(false);

    // Eligibility must be derived from the durable trials_used record, on
    // the v1.2 shape the parsing expects — a version drift here would make
    // every customer look trial-eligible.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`/customers/${USER}?expand=trials_used`);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].version).toBe("1.2");
  });

  it("treats an unknown customer (404) as history-free and passes args through", async () => {
    stubCustomerFetch({ ok: false, status: 404, body: { message: "not found" } });
    const args: GateArgs = { productId: "basic" };
    // A brand-new user's very first checkout happens before any Autumn
    // customer exists; blocking on 404 would break every first purchase.
    await expect(
      gateTrialArgs(ctxAs({ subject: USER }), "checkout", args),
    ).resolves.toBe(args);
  });

  it("rejects attach while trialing — plan switches must go through switchPlanDuringTrial", async () => {
    stubCustomerFetch({
      body: { products: [freeProduct, trialingProduct], trials_used: [{ product_id: "basic_annual" }] },
    });
    // A raw attach mid-trial would either grant a fresh trial or bill
    // immediately; only switchPlanDuringTrial carries the running trial over.
    await expect(
      gateTrialArgs<GateArgs>(ctxAs({ subject: USER }), "attach", {
        productId: "pro",
      }),
    ).rejects.toThrow(/switchPlanDuringTrial/);
  });

  it("lets checkout proceed while trialing, but with freeTrial forced off", async () => {
    stubCustomerFetch({
      body: { products: [freeProduct, trialingProduct], trials_used: [{ product_id: "basic_annual" }] },
    });
    const args: GateArgs = { productId: "pro" };
    const result = await gateTrialArgs(ctxAs({ subject: USER }), "checkout", args);

    // The dialog needs the preview, but no checkout session that could
    // complete into a SECOND trial may ever be created.
    expect(result).toEqual({ productId: "pro", freeTrial: false });
    // Caller's args stay unmutated — they may be reused for a later retry.
    expect("freeTrial" in args).toBe(false);
  });

  it("forces freeTrial:false for a customer who ever trialed — the anti-trial-farming pin", async () => {
    stubCustomerFetch({
      // Trial consumed in the past, nothing running now: `products` has
      // forgotten it (cancelled plans vanish), only trials_used remembers.
      body: { products: [freeProduct], trials_used: [{ product_id: "basic" }] },
    });
    // Even an explicit freeTrial:true from a hand-crafted direct action call
    // must be overridden — this is exactly the basic → pro → basic_annual
    // trial-hopping exploit the gate exists to stop.
    const result = await gateTrialArgs(ctxAs({ subject: USER }), "attach", {
      productId: "basic_annual",
      freeTrial: true,
    });
    expect(result).toEqual({ productId: "basic_annual", freeTrial: false });
  });

  it("fails closed when eligibility cannot be verified (non-404 error)", async () => {
    stubCustomerFetch({ ok: false, status: 500, body: { message: "boom" } });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      // Passing args through on an outage would hand out trials to users
      // whose history simply couldn't be read.
      await expect(
        gateTrialArgs<GateArgs>(ctxAs({ subject: USER }), "attach", {
        productId: "pro",
      }),
      ).rejects.toThrow(/trial eligibility/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("passes unauthenticated calls through without hitting Autumn — identify() rejects them", async () => {
    const fetchMock = stubCustomerFetch({ body: {} });
    const args: GateArgs = { productId: "basic" };
    // No identity means no customer id to gate on; the component's
    // identify() throws before any Autumn call executes, so a lookup here
    // would only leak requests for a caller that can never attach anything.
    await expect(gateTrialArgs(ctxAs(null), "checkout", args)).resolves.toBe(
      args,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("public action surface", () => {
  it("exports only the endpoints the react hooks use — the negative-track exploit stays closed", () => {
    // Everything the client legitimately calls must exist...
    for (const name of [
      "check",
      "attach",
      "checkout",
      "createCustomer",
      "listProducts",
      "billingPortal",
    ]) {
      expect(
        (autumnModule as Record<string, unknown>)[name],
        `expected export ${name}`,
      ).toBeDefined();
    }
    // ...and nothing that lets a browser mutate its own balance or billing
    // state. Public `track` accepted unbounded negative values — i.e. free
    // self-service usage credits — and the rest are the same class of
    // self-scoped write. Re-exporting `autumn.api()` wholesale would bring
    // them all back at once.
    for (const name of [
      "track",
      "cancel",
      "query",
      "usage",
      "setupPayment",
      "createReferralCode",
      "redeemReferralCode",
      "createEntity",
      "getEntity",
    ]) {
      expect(name in autumnModule, `unexpected export ${name}`).toBe(false);
    }
  });
});
