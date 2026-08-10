import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import { Autumn } from "@useautumn/convex";
import { getTrialState, type TrialState } from "../lib/autumn/trial-eligibility";
import { normalizePlans } from "../lib/autumn/customer-shape";
import { MANAGED_PAYMENTS_SESSION_PARAMS } from "../lib/autumn/managed-payments";
import { autumnFetchRaw } from "./usage/autumnClient";

const secretKey = (() => {
  const key = process.env.AUTUMN_SECRET_KEY;
  if (!key) throw new Error('Missing required Convex environment variable: AUTUMN_SECRET_KEY');
  return key;
})();

/**
 * Kill switch for Stripe Managed Payments (merchant of record) — see
 * lib/autumn/managed-payments.ts for what it does and the constraints.
 *
 * Read per call rather than at module load so `npx convex env set/unset
 * AUTUMN_MANAGED_PAYMENTS` takes effect without waiting on isolate
 * recycling. Managed Payments params ride only on v2 `/billing.attach`
 * calls — convex/billing.ts (attachNewPlan, switchPlanDuringTrial) and
 * `attachViaV2NoTrial` below: the legacy path these actions otherwise call
 * (autumn-js pins `x-api-version: 1.2`) builds its Stripe client on
 * 2025-02-24.acacia, and Stripe rejects `managed_payments` before
 * 2025-03-31.basil — so injecting it there could never work. In this file
 * the flag drives `guardFirstPurchaseOffLegacyPath` (keeping first
 * purchases from slipping past MoR onto the legacy path) and the session
 * params on `attachViaV2NoTrial`.
 */
function managedPaymentsEnabled(): boolean {
  return process.env.AUTUMN_MANAGED_PAYMENTS === 'true';
}

export const autumn = new Autumn(components.autumn, {
  secretKey,
  identify: async (ctx: {
    auth: { getUserIdentity: () => Promise<Record<string, unknown> | null> };
  }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return null

    return {
      customerId: user.subject as string,
      customerData: {
        name: user.name as string,
        email: user.email as string,
      },
    };
  },
});

/**
 * Public actions required by our autumn-js react hooks — and ONLY those.
 *
 * `autumn.api()` offers the component's full surface (track, cancel, usage,
 * setupPayment, entities, referrals, ...), but every one of these is a
 * PUBLIC action scoped to the caller's own Autumn customer. `track` in
 * particular accepts an unbounded `value: number` — and Autumn credits
 * negative values (our own refund path relies on that: releaseQuota tracks
 * `-amount`) — so exporting it let any authenticated user grant themselves
 * usage from the browser console. No client code ever called the removed
 * ones (the hooks use exactly the four below plus attach/checkout further
 * down; all real usage tracking is server-side via
 * internal.usage.tracking.trackUsage), so they are simply not exported.
 * autumn-js only dereferences `convexApi.<name>` at call time, so the
 * missing endpoints are inert unless something actually calls them.
 */
export const { createCustomer, listProducts, billingPortal } = autumn.api();

/**
 * Server-side trial gate for `attach` / `checkout`.
 *
 * Autumn's built-in trial dedup is per-plan only, and the anti-hopping
 * policy (one trial ever, across all plans — see
 * lib/autumn/trial-eligibility.ts) used to live purely in the client via
 * `checkoutTrialParams()`. Anyone invoking these public actions directly
 * could therefore collect a fresh trial on every plan. The gate re-derives
 * eligibility here, where the calls actually execute, from the durable
 * `trials_used` record:
 *
 * - trial-eligible (never trialed, no paid plan): args pass through and
 *   Autumn starts the plan's configured trial.
 * - currently trialing: `attach` is rejected — plan switches (including
 *   dropping to the Free plan, which is scheduled at trial end) must go
 *   through `switchPlanDuringTrial` (convex/billing.ts), which carries the
 *   running trial over instead of granting a fresh one. `checkout` (the
 *   dialog's preview) proceeds with `freeTrial: false` so no checkout
 *   session that grants a new trial can be completed; the dialog overrides
 *   preview copy/amounts for trialing users anyway.
 * - everyone else: `freeTrial: false` is forced, mirroring what the
 *   well-behaved client already sends.
 *
 * How that "no trial" intent actually reaches Autumn — an
 * upstream-regression workaround, probed live on 2026-08-09:
 *
 * - v1.2 `/checkout` (the preview): `free_trial: false` still WORKS — the
 *   preview suppresses the plan's trial. `null` is rejected
 *   ("free_trial: Invalid input").
 * - v1.2 `/attach` (the money call): `false` passes validation but is
 *   silently LOST in Autumn's v1.2→v2 translation (`freeTrialParamsV0ToV1`
 *   has no boolean branch), so the plan's configured trial applies anyway —
 *   a paying upgrader got a full "unused plan" credit note plus a fresh
 *   7-day trial. `null` is rejected by the same request schema. The legacy
 *   attach therefore CANNOT express "no trial" at all.
 * - v2 `/billing.attach` with `customize: { free_trial: null }` works
 *   (already relied on by billing.ts attachNewPlan/switchPlanDuringTrial).
 *
 * So: previews keep `false` on the legacy path, and the attach action
 * routes trial-suppressed cross-plan switches through v2 (see
 * attachViaV2NoTrial below). The gated `freeTrial: false` doubles as that
 * routing signal.
 */
export async function gateTrialArgs<T extends { freeTrial?: boolean }>(
  ctx: ActionCtx,
  kind: 'attach' | 'checkout',
  args: T,
): Promise<{
  gated: T;
  state: TrialState | null;
  customer: { products?: unknown; trials_used?: unknown } | null;
}> {
  const identity = await ctx.auth.getUserIdentity();
  // Unauthenticated calls are rejected by the component's identify().
  if (!identity) return { gated: args, state: null, customer: null };

  const res = await autumnFetchRaw(
    'GET',
    `/customers/${encodeURIComponent(identity.subject)}?expand=trials_used`,
    undefined,
    '1.2',
  );
  // Unknown customer — nothing attached yet, so no trial history either.
  if (res.status === 404) {
    return { gated: args, state: getTrialState(null), customer: null };
  }
  if (!res.ok) {
    console.error(`Autumn trial-gate customer fetch failed (${res.status}): ${res.text}`);
    throw new Error('Could not verify trial eligibility — please retry');
  }
  const customer = res.json as {
    products?: unknown;
    trials_used?: unknown;
  };

  const state = getTrialState(customer);
  if (state.trialEligible) return { gated: args, state, customer };
  if (state.onTrial && kind === 'attach') {
    throw new Error(
      'Plan switches during a trial must go through switchPlanDuringTrial',
    );
  }
  return { gated: { ...args, freeTrial: false }, state, customer };
}

const customerDataValidator = v.object({
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  fingerprint: v.optional(v.string()),
});

/**
 * `check` for the paywall preview (usePaywall calls it with
 * `withPreview: true`). Registered by hand instead of re-exported from
 * `autumn.api()` so that `sendEvent` is force-disabled: with
 * `sendEvent: true` the component's check RECORDS a usage event of
 * `requiredBalance` (an unbounded, sign-free number), which would be the
 * same self-service balance manipulation as the removed public `track`.
 * The client only ever previews.
 */
export const check = action({
  args: {
    // Mirrors the component's CheckArgs (not exported by the package),
    // minus nothing — sendEvent is accepted but ignored.
    productId: v.optional(v.string()),
    featureId: v.optional(v.string()),
    requiredBalance: v.optional(v.number()),
    sendEvent: v.optional(v.boolean()),
    withPreview: v.optional(v.boolean()),
    entityId: v.optional(v.string()),
    customerData: v.optional(customerDataValidator),
    entityData: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await autumn.check(ctx, { ...args, sendEvent: false });
  },
});

/**
 * Mirrors the component's AttachArgs / CheckoutArgs (not exported by the
 * package), minus the fields deliberately rejected at the validator:
 *
 * - `checkoutSessionParams` (raw Stripe Checkout Session params, forwarded
 *   verbatim): on a public action it would let any authenticated user inject
 *   session params — including `managed_payments: {enabled: false}`, which
 *   would put the tax liability for that sale on us instead of Stripe.
 * - `productIds` (multi-product attach): nothing in the app sends it, and the
 *   trial gate's v2 reroute keys on `productId` — an attach via `productIds`
 *   would fall through to the legacy path, where "no trial" is silently lost
 *   (the exact live incident of 2026-08-09).
 * - `forceCheckout`: nothing in the app sends it, and it would let any caller
 *   demand a Checkout Session on the legacy path, which can never carry
 *   merchant of record.
 */
const checkoutSharedArgs = {
  productId: v.optional(v.string()),
  entityId: v.optional(v.string()),
  options: v.optional(
    v.array(v.object({ featureId: v.string(), quantity: v.number() })),
  ),
  freeTrial: v.optional(v.boolean()),
  successUrl: v.optional(v.string()),
  customerData: v.optional(customerDataValidator),
  entityData: v.optional(v.any()),
  reward: v.optional(v.string()),
  invoice: v.optional(v.boolean()),
};

/**
 * Stale-client guard, applied to BOTH legacy actions while Managed Payments
 * is on. A first purchase (no paid plan, no running trial) is the only flow
 * that makes Autumn create a Stripe Checkout Session on this path — and the
 * legacy path cannot make that session merchant-of-record (see
 * managedPaymentsEnabled above). It isn't just `attach`: for a customer
 * without a usable card, the v1.2 `/checkout` PREVIEW itself creates the
 * session and autumn-js redirects straight to it (verified in the sandbox —
 * the MoR error surfaced from `autumn:checkout`). The client therefore
 * routes first purchases to `billing.attachNewPlan` before ever calling
 * these (hooks/use-new-plan-checkout.ts); anything still landing here is a
 * stale bundle, and letting it through would sell without merchant of
 * record. Trialing customers and existing payers pass — their calls never
 * create sessions, and the dialog needs the preview.
 */
function guardFirstPurchaseOffLegacyPath(state: TrialState | null): void {
  if (
    managedPaymentsEnabled() &&
    state &&
    !state.hasPaidPlan &&
    !state.onTrial
  ) {
    throw new Error('Checkout has been updated — please refresh the page');
  }
}

/**
 * Attach with the trial suppressed, via v2 `/billing.attach` — the ONLY
 * endpoint that can still express "no trial" (see the gateTrialArgs doc):
 * `customize.free_trial: null`. Used for cross-plan switches by non-eligible
 * customers, where the legacy attach would wrongly grant the target plan's
 * configured trial (with a full credit note for the old plan on upgrades).
 *
 * v2 semantics match the legacy path for these cases: upgrades switch
 * immediately with proration, downgrades are scheduled at period end. The
 * return value mimics the component's `{ data, error }` container so
 * autumn-js's attach handling (checkout_url redirect, cache refetch, dialog
 * close) works unchanged; payer switches are in-place subscription updates,
 * so no payment_url is expected.
 */
async function attachViaV2NoTrial(
  ctx: ActionCtx,
  args: { productId?: string; options?: { featureId: string; quantity: number }[] },
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('Not authenticated');
  if (!args.productId) throw new Error('productId is required');

  const res = await autumnFetchRaw(
    'POST',
    '/billing.attach',
    {
      customer_id: identity.subject,
      plan_id: args.productId,
      redirect_mode: 'if_required',
      customize: { free_trial: null },
      ...(args.options?.length
        ? {
            options: args.options.map((o) => ({
              feature_id: o.featureId,
              quantity: o.quantity,
            })),
          }
        : {}),
      // Defensive: a payer switch never creates a Checkout Session, but if
      // Autumn ever does on this path, it must carry merchant of record.
      ...(managedPaymentsEnabled()
        ? { checkout_session_params: MANAGED_PAYMENTS_SESSION_PARAMS }
        : {}),
    },
    '2.1.0',
  );
  const json =
    typeof res.json === 'object' && res.json !== null
      ? (res.json as { payment_url?: string | null; message?: string; code?: string })
      : { message: res.text.slice(0, 200) };
  if (!res.ok) {
    console.error(`Autumn v2 attach failed (${res.status}): ${res.text}`);
    return {
      data: null,
      error: {
        message: json.message ?? `Autumn attach failed (${res.status})`,
        code: json.code ?? 'attach_failed',
      },
    };
  }
  // Refresh the quota mirror so the switch's new allowances apply without
  // waiting for the next mount-time sync — the common entry point here is
  // the low-quota dialog, where stale quotas would keep the feature locked.
  // Scheduled rather than awaited: the confirm shouldn't block on it, and
  // the sync lives in the node runtime.
  await ctx.scheduler.runAfter(0, internal.usage.tracking.syncQuotasInternal, {
    userId: identity.subject,
  });

  return {
    data: { ...json, checkout_url: json.payment_url ?? undefined },
    error: null,
  };
}

/**
 * Is `productId` the free (default) plan? Asked of Autumn, not the customer
 * payload: a paying customer's `products` does NOT contain the free plan
 * (verified in the sandbox — see documentation/autumn-usage-tracking.md), so
 * "is the target held" can never identify a cancel-to-Free. Fails closed —
 * with an unreachable product record the attach cannot be routed safely.
 */
async function isFreeProduct(productId: string): Promise<boolean> {
  const res = await autumnFetchRaw(
    'GET',
    `/products/${encodeURIComponent(productId)}`,
    undefined,
    '1.2',
  );
  if (!res.ok) {
    console.error(`Autumn product fetch failed (${res.status}): ${res.text}`);
    throw new Error('Could not verify the selected plan — please retry');
  }
  const product = res.json as {
    is_default?: boolean;
    properties?: { is_free?: boolean };
  };
  return product.is_default === true || product.properties?.is_free === true;
}

/**
 * The v2 reroute forwards only `productId` and `options` — the rest of the
 * validator's surface has no verified v2 equivalent. Nothing in the app
 * sends these on an attach; refuse them loudly rather than silently
 * dropping e.g. a referral reward.
 */
const ATTACH_ARGS_UNSUPPORTED_ON_V2 = [
  'entityId',
  'entityData',
  'customerData',
  'successUrl',
  'reward',
  'invoice',
  'metadata',
] as const;

function rejectArgsUnsupportedOnV2(args: Record<string, unknown>): void {
  const present = ATTACH_ARGS_UNSUPPORTED_ON_V2.filter(
    (key) => args[key] !== undefined,
  );
  if (present.length > 0) {
    throw new Error(
      `Not supported on this plan switch: ${present.join(', ')}`,
    );
  }
}

/**
 * Backstop behind `guardFirstPurchaseOffLegacyPath` for the one case that
 * guard exempts: a payer whose card is gone. Their legacy preview/attach
 * DOES build a Checkout Session (the same cardless mechanism the guard doc
 * describes) and autumn-js redirects to it on `data.url` / `checkout_url` —
 * a session the legacy path can never make merchant-of-record. Refuse the
 * redirect instead of completing a sale whose tax liability lands on us.
 * Trialing customers and card-holding payers never get a session here, so
 * they are unaffected.
 */
export function rejectLegacySessionUnderManagedPayments(result: unknown): void {
  if (!managedPaymentsEnabled()) return;
  const data = (
    result as { data?: { url?: unknown; checkout_url?: unknown } | null } | null
  )?.data;
  if (
    typeof data?.url === 'string' ||
    typeof data?.checkout_url === 'string'
  ) {
    throw new Error(
      'No usable payment method on file — please update your payment details in the billing portal, then try again',
    );
  }
}

export const attach = action({
  args: { ...checkoutSharedArgs, metadata: v.optional(v.object({})) },
  handler: async (ctx, args) => {
    const { gated, state, customer } = await gateTrialArgs(ctx, 'attach', args);
    guardFirstPurchaseOffLegacyPath(state);
    // Trial-suppressed CROSS-PLAN switches to a PAID target must go to v2 —
    // the legacy attach can no longer suppress the target's configured
    // trial. Renew (re-attaching a held plan to un-schedule a pending
    // switch) and cancel-to-Free stay on the legacy path, whose scheduling
    // semantics they depend on; free has no trial to suppress, and a payer
    // never HOLDS free, so the target is asked of Autumn's product record,
    // not of `targetIsHeld`.
    if (gated.freeTrial === false && gated.productId) {
      const targetIsHeld = normalizePlans(customer).some(
        (p) => p.planId === gated.productId,
      );
      if (!targetIsHeld && !(await isFreeProduct(gated.productId))) {
        rejectArgsUnsupportedOnV2(gated);
        return await attachViaV2NoTrial(ctx, gated);
      }
    }
    const result = await autumn.attach(ctx, gated);
    rejectLegacySessionUnderManagedPayments(result);
    return result;
  },
});

export const checkout = action({
  args: checkoutSharedArgs,
  handler: async (ctx, args) => {
    const { gated, state } = await gateTrialArgs(ctx, 'checkout', args);
    guardFirstPurchaseOffLegacyPath(state);
    // Previews stay legacy: `freeTrial: false` still works on /checkout
    // (probed 2026-08-09), and the dialog needs the v1.2 `scenario`.
    const result = await autumn.checkout(ctx, gated);
    rejectLegacySessionUnderManagedPayments(result);
    return result;
  },
});
