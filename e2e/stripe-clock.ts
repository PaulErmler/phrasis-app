import fs from "node:fs";
import path from "node:path";

/**
 * Minimal Stripe REST helpers for the test-clock billing spec
 * (billing-clock.spec.ts). Plain fetch instead of the `stripe` SDK so the
 * repo gains no dependency for one spec.
 *
 * Needs the Stripe TEST-mode secret key of the account Autumn's sandbox org
 * is connected to (Stripe dashboard → Developers → API keys, test mode).
 * Resolution order:
 *   1. `STRIPE_TEST_SECRET_KEY` in the Playwright process env, or
 *   2. `.env.local` at the repo root — the Playwright runner does not load
 *      it (only Next.js does), so it is parsed here: `STRIPE_TEST_SECRET_KEY`
 *      if present, else any `*STRIPE*` variable whose value is a test-mode
 *      secret key.
 * The spec skips when neither yields a key. A live-mode key is refused
 * outright — everything here creates customers, advances time, and fails
 * charges — and values are never logged.
 */

const STRIPE_API = "https://api.stripe.com/v1";

const isTestKey = (value: string) => /^(sk|rk)_test_/.test(value);

/** Parse KEY=VALUE lines; quotes trimmed, comments/exports ignored. */
function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(
      line,
    );
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export function stripeTestKey(): string | undefined {
  const explicit = process.env.STRIPE_TEST_SECRET_KEY;
  if (explicit) {
    if (!isTestKey(explicit)) {
      throw new Error(
        "STRIPE_TEST_SECRET_KEY must be a TEST-mode key (sk_test_/rk_test_)",
      );
    }
    return explicit;
  }

  const env = parseEnvFile(path.resolve(__dirname, "..", ".env.local"));
  const preferred = env.STRIPE_TEST_SECRET_KEY;
  if (preferred && isTestKey(preferred)) return preferred;
  for (const [name, value] of Object.entries(env)) {
    // Live-mode (or non-key) values are silently skipped — never referenced
    // in errors or logs.
    if (/STRIPE/i.test(name) && isTestKey(value)) return value;
  }
  return undefined;
}

async function stripeFetch<T>(
  key: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Record<string, string>,
  apiVersion?: string,
): Promise<T> {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(apiVersion ? { "Stripe-Version": apiVersion } : {}),
    },
    ...(method !== "GET" && body !== undefined ? { body } : {}),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    // Never echo the request (it could embed the key via a bug) — Stripe's
    // error message is enough.
    throw new Error(
      `Stripe ${method} ${path} failed (${res.status}): ${json?.error?.message ?? "unknown"}`,
    );
  }
  return json;
}

export type ClockedCustomer = {
  clockId: string;
  customerId: string;
};

/**
 * Create a frozen test clock plus a Stripe customer bound to it. Everything
 * later attached to this customer (subscriptions, invoices) moves when the
 * clock advances.
 */
export async function createClockedCustomer(
  key: string,
  email: string,
): Promise<ClockedCustomer> {
  const clock = await stripeFetch<{ id: string }>(
    key,
    "POST",
    "/test_helpers/test_clocks",
    { frozen_time: String(Math.floor(Date.now() / 1000)) },
  );
  const customer = await stripeFetch<{ id: string }>(key, "POST", "/customers", {
    email,
    name: "E2E Clock User",
    test_clock: clock.id,
  });
  return { clockId: clock.id, customerId: customer.id };
}

/**
 * Attach one of Stripe's shareable test PaymentMethods and make it the
 * default for invoices. `pm_card_visa` succeeds forever;
 * `pm_card_chargeCustomerFail` attaches fine but fails every charge.
 */
export async function attachTestCard(
  key: string,
  customerId: string,
  pm: "pm_card_visa" | "pm_card_chargeCustomerFail" = "pm_card_visa",
): Promise<string> {
  const attached = await stripeFetch<{ id: string }>(
    key,
    "POST",
    `/payment_methods/${pm}/attach`,
    { customer: customerId },
  );
  await stripeFetch(key, "POST", `/customers/${customerId}`, {
    "invoice_settings[default_payment_method]": attached.id,
  });
  return attached.id;
}

/**
 * Advance the clock to `toUnixSeconds` and wait until Stripe finishes
 * processing (status back to 'ready'). Stripe generates the interim events
 * — renewal invoices, charges, cancellations — while 'advancing'.
 */
export async function advanceClock(
  key: string,
  clockId: string,
  toUnixSeconds: number,
  timeoutMs = 180_000,
): Promise<void> {
  if (!Number.isFinite(toUnixSeconds)) {
    throw new Error(
      `advanceClock got a non-finite target (${toUnixSeconds}) — a period/trial timestamp was missing on the subscription`,
    );
  }
  await stripeFetch(key, "POST", `/test_helpers/test_clocks/${clockId}/advance`, {
    frozen_time: String(Math.floor(toUnixSeconds)),
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const clock = await stripeFetch<{ status: string }>(
      key,
      "GET",
      `/test_helpers/test_clocks/${clockId}`,
    );
    if (clock.status === "ready") return;
    if (clock.status !== "advancing") {
      throw new Error(`Test clock entered unexpected status: ${clock.status}`);
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the test clock to advance");
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

export type SubscriptionLite = {
  id: string;
  status: string;
  trial_end: number | null;
  current_period_end: number;
  cancel_at_period_end: boolean;
  /**
   * A scheduled cancellation may arrive as EITHER the boolean or this
   * timestamp: Autumn's scheduled cancel-to-Free sets `cancel_at` to the
   * period end and leaves `cancel_at_period_end` false (observed live,
   * 2026-08-10). Check both.
   */
  cancel_at: number | null;
};

type RawSubscription = {
  id: string;
  status: string;
  trial_end?: number | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  // Pre-basil API versions carry the period on the subscription…
  current_period_end?: number;
  // …basil (2025-03-31) and later moved it to the subscription items.
  items?: { data?: Array<{ current_period_end?: number }> };
};

function normalizeSubscription(raw: RawSubscription): SubscriptionLite {
  const itemEnds = (raw.items?.data ?? [])
    .map((i) => i.current_period_end)
    .filter((n): n is number => typeof n === "number");
  const periodEnd =
    raw.current_period_end ??
    (itemEnds.length ? Math.max(...itemEnds) : Number.NaN);
  return {
    id: raw.id,
    status: raw.status,
    trial_end: raw.trial_end ?? null,
    cancel_at_period_end: raw.cancel_at_period_end ?? false,
    cancel_at: raw.cancel_at ?? null,
    current_period_end: periodEnd,
  };
}

/**
 * Is the subscription scheduled to end at its period end (rather than
 * renewing)? Either Stripe spelling counts — see the `cancel_at` note on
 * SubscriptionLite. The 26h slack absorbs Autumn anchoring the timestamp a
 * few minutes past the period boundary.
 */
export function isCancelScheduledAtPeriodEnd(sub: SubscriptionLite): boolean {
  return (
    sub.cancel_at_period_end ||
    (sub.cancel_at !== null &&
      sub.cancel_at <= sub.current_period_end + 26 * 3600)
  );
}

/** All subscriptions of the customer, any status. */
export async function listSubscriptions(
  key: string,
  customerId: string,
): Promise<SubscriptionLite[]> {
  const res = await stripeFetch<{ data: RawSubscription[] }>(
    key,
    "GET",
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`,
  );
  return res.data.map(normalizeSubscription);
}

/**
 * Fetch a Checkout Session. Pinned to the dahlia API version so the
 * `managed_payments` field is present on the response regardless of the
 * account's default version.
 */
export async function getCheckoutSession(
  key: string,
  sessionId: string,
): Promise<{
  id: string;
  status: string;
  managed_payments?: { enabled?: boolean } | null;
  amount_total: number | null;
  currency: string | null;
}> {
  return stripeFetch(
    key,
    "GET",
    `/checkout/sessions/${sessionId}`,
    undefined,
    "2026-04-22.dahlia",
  );
}

/** Find a Stripe customer id by exact email (most recent first). */
export async function findCustomerByEmail(
  key: string,
  email: string,
): Promise<string | undefined> {
  // The list filter, NOT `/customers/search`: search reads a separate index
  // with up-to-a-minute lag, and it raced the e2e flow — the customer Autumn
  // creates at signup was invisible to search minutes later (live failure,
  // 2026-08-10). The list endpoint is read-your-writes consistent.
  const res = await stripeFetch<{ data: Array<{ id: string }> }>(
    key,
    "GET",
    `/customers?email=${encodeURIComponent(email)}&limit=1`,
  );
  return res.data?.[0]?.id;
}

/**
 * Cancel a subscription immediately AT STRIPE (DELETE — no proration
 * invoice, so it works on Managed Payments subscriptions, where Stripe
 * forbids merchant-created invoices and Autumn's own `cancel_immediately`
 * therefore 400s). On an unclocked customer the cancellation carries
 * real-world timestamps, which is what lets hosted Autumn's webhook
 * ingestion reflect the lapse immediately.
 */
export async function cancelSubscriptionNow(
  key: string,
  subscriptionId: string,
): Promise<void> {
  await stripeFetch(key, "DELETE", `/subscriptions/${subscriptionId}`);
}

/**
 * Fetch one subscription, pinned to dahlia so its `managed_payments` field
 * is present regardless of the account's default API version. A legacy
 * (pre-MoR) subscription reads absent/disabled; a Managed Payments purchase
 * reads enabled.
 */
export async function getSubscription(
  key: string,
  subscriptionId: string,
): Promise<
  SubscriptionLite & { managed_payments?: { enabled?: boolean } | null }
> {
  const raw = await stripeFetch<
    RawSubscription & { managed_payments?: { enabled?: boolean } | null }
  >(key, "GET", `/subscriptions/${subscriptionId}`, undefined, "2026-04-22.dahlia");
  return {
    ...normalizeSubscription(raw),
    managed_payments: raw.managed_payments,
  };
}

/** Extract the `cs_…` session id from a checkout.stripe.com URL. */
export function sessionIdFromUrl(url: string): string | undefined {
  return /cs_(?:test|live)_[A-Za-z0-9]+/.exec(url)?.[0];
}

/** Poll until the customer's subscriptions satisfy `predicate`. */
export async function waitForSubscriptions(
  key: string,
  customerId: string,
  predicate: (subs: SubscriptionLite[]) => boolean,
  { timeoutMs = 120_000, label = "subscription state" } = {},
): Promise<SubscriptionLite[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const subs = await listSubscriptions(key, customerId);
    if (predicate(subs)) return subs;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${label}; statuses: ${subs.map((s) => s.status).join(", ") || "none"}`,
      );
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
