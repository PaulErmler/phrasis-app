# Autumn Integration & Usage Tracking

This document describes how feature gating, usage quotas, and the Autumn billing SDK are wired together across the Flexling codebase. Use it as a reference when adding new gated features, modifying quota enforcement, or debugging paywall/checkout flows.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Feature IDs](#feature-ids)
3. [Credit System](#credit-system)
4. [Backend – Convex Usage Module](#backend--convex-usage-module)
5. [Backend – Autumn Component](#backend--autumn-component)
6. [Quota Sync Lifecycle](#quota-sync-lifecycle)
7. [Backend Enforcement (Mutations)](#backend-enforcement-mutations)
8. [Stripe Managed Payments (merchant of record)](#stripe-managed-payments-merchant-of-record)
9. [Frontend – Quota Hook](#frontend--quota-hook)
10. [Frontend – UI Components](#frontend--ui-components)
11. [Frontend – Error Handling](#frontend--error-handling)
12. [Adding a New Gated Feature](#adding-a-new-gated-feature)
13. [Common Pitfalls](#common-pitfalls)

---

## Architecture Overview

The system uses a **two-layer** approach:

1. **Autumn (external)** – the source of truth for billing plans, entitlements, and checkout. Lives at `https://api.useautumn.com/v1`. Configured via the `@useautumn/convex` component and the `autumn-js/react` client SDK.
2. **Local Convex quota cache (`usageQuotas` table)** – a per-user document that mirrors Autumn's entitlements locally. This enables reactive UI updates and fast server-side enforcement without calling Autumn on every mutation.

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (React)                                            │
│                                                              │
│  useFeatureQuota(featureId) ──reads──▶ Convex usageQuotas    │
│  FeatureBadge / FeatureGatedButton / PaywallDialog           │
│  usePaywall / useCustomer / usePricingTable  (autumn-js)     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  Backend (Convex)                                            │
│                                                              │
│  Mutation: consumeQuota(ctx, userId, featureId, amount)          │
│    1. checkQuota() against local cache                       │
│    2. decrementQuota() optimistically                        │
│    3. scheduler.runAfter(trackUsage) ──POST──▶ Autumn /track │
│    4. trackUsage fetches fresh entitlements, writes back      │
│                                                              │
│  syncQuotas action  ◀── called on app load                   │
│    POST /customers (getOrCreate) ──▶ syncAllFeatures mutation │
└──────────────────────────────────────────────────────────────┘
```

---

## Feature IDs

All feature IDs are defined in a single file:

**`convex/features/featureIds.ts`**

```typescript
export const FEATURE_IDS = {
  CHAT_MESSAGES: 'chat_messages',
  COURSES: 'courses',
  SENTENCES: 'sentences',
  CUSTOM_SENTENCES: 'custom_sentences',
  MULTIPLE_LANGUAGES: 'multiple_languages',
  TRANSCRIPTIONS: 'transcriptions',
  CARD_EDITS: 'card_edits',
  TRANSLATION_AUTO_FILL: 'translation_auto_fill',
  AUDIO_REGENERATIONS: 'audio_regenerations',
  TRANSLATION_FLAGS: 'translation_flags',
  CREDITS: 'credits',
} as const;
```

These IDs **must** match the feature IDs configured in Autumn's dashboard and `autumn.config.ts`. `FEATURE_IDS` is imported on both the server and client wherever quota checks are needed.

**Types of features:**

| Feature ID | Type | Description |
|---|---|---|
| `chat_messages` | Usage (metered, consumable) | Messages sent in chat — billed in credits (see Credit System) |
| `courses` | Usage (metered, non-consumable) | Number of active courses |
| `sentences` | Usage (metered, consumable) | Sentences added from collections (free tier: 300 one-off + 50/month) |
| `custom_sentences` | Usage (metered, consumable) | Custom cards created/approved — billed in credits |
| `translation_auto_fill` | Usage (metered, consumable) | Auto-translate on custom card creation — billed in credits |
| `transcriptions` | Usage (metered, consumable) | Transcription uses, resets monthly |
| `card_edits` / `audio_regenerations` / `translation_flags` | Usage (metered, consumable, hidden) | Internal meters, resets monthly |
| `multiple_languages` | Boolean (feature flag) | Whether the user can add >2 languages per course (Pro only) |
| `credits` | Credit system | Shared pool consumed by the three credit-billed features above |

**How types map to the Autumn API response:**

- Metered features appear in the `balances` object of the customer response with fields `granted`, `remaining`, `usage`, `unlimited`. The `credits` credit-system feature also appears as a `balances` entry and syncs into the local cache like any other metered feature.
- Boolean features appear in the `flags` object with fields `id`, `plan_id`, `expires_at`, `feature_id`.

In the local `usageQuotas` cache, boolean features are stored as `{ balance: 1, included: 1, used: 0, unlimited: true }`. The `isAvailable` check (`balance > 0 || unlimited`) works for both types.

---

## Credit System

Since the credits rollout, `custom_sentences`, `translation_auto_fill`, and `chat_messages` are no longer granted as separate plan items. Instead, plans grant a shared `credits` pool (Free: 200 one-off + 30/month; Basic: 430/month; Pro: 1,030/month; Ultra: 3,030/month) and the `credits` feature in `autumn.config.ts` declares a `creditSchema` mapping each of those features to a credit cost (currently 1 credit per unit each). Monthly credits reset with the billing cycle (no rollover); one-off grants persist.

The odd-looking monthly grants are deliberate, not round-number misses. The pricing table lists each tier as what it ADDS over the one below (see `itemsAddedOver` in `components/autumn/pricing-table.tsx`), so the totals are tuned to make those increments round — and they chain, so changing one tier shifts every tier above it:

| Plan | Total/month | Renders as |
|---|---|---|
| Free | 30 | 30 credits per month |
| Basic | 430 | plus **400** credits per month |
| Pro | 1,030 | plus **600** credits per month |
| Ultra | 3,030 | plus **2,000** credits per month |

**Starter credits stay on the free plan.** Since `free` is `autoEnable`, every customer is attached to it at creation and receives the 200 one-off grant once. A customer who subscribes to a paid tier no longer holds `free` (verified in sandbox: a `pro_annual` customer's `subscriptions` contains only that plan), so paid-from-day-one subscribers get no starter credits — accepted. Do NOT "fix" this by adding a `one_off` credits item to Basic/Pro/Ultra: switching plans ends one entitlement and creates a new one, so that would grant a fresh 200 on every upgrade.

**Golden rule (from Autumn's docs): always check/track the UNDERLYING feature id, never `credits`.** Autumn converts tracked usage into credit deductions server-side via the `creditSchema`.

Client + server mirror this rule:

- `CREDIT_COSTS` in `convex/features/featureIds.ts` mirrors the `creditSchema` and is the single source of truth for conversions in app code.
- `resolveQuotaTarget` in `convex/usage/helpers.ts` redirects `checkQuota` / `decrementQuota` / `incrementQuota` (and therefore `consumeQuota` / `releaseQuota`) to the local `credits` balance (amount × credit cost) whenever the user's quota doc has a `credits` entry. The scheduled `trackUsage` still sends the underlying feature id.
- `useFeatureQuota` applies the same redirect on the client, returning balances in feature units (`credits / cost`).
- `toBillableFeature` in `lib/autumn/find-upgrade-product.ts` maps credit-billed features to the `credits` product item when searching for upgrade products (paywall / low-quota dialogs).

**Dynamic chat pricing:** a chat message costs 1 credit per started $0.005 (`CHAT_CREDIT_USD_STEP`) of actual LLM cost. `sendMessage` consumes 1 credit up-front via `consumeQuota(CHAT_MESSAGES, 1)`. `generateResponse` accumulates the real OpenRouter cost across all LLM steps (via a per-call `usageHandler` reading `providerMetadata.openrouter.usage.cost`; requires `usage: { include: true }` in `OPENROUTER_CHAT_EXTRA_BODY`) and then charges the remainder through the `chargeExtraChatCredits` internal mutation. The remainder is billed in whole `chat_messages` units (`ceil(cost / (step × creditCost)) - 1`), never in raw credits — `resolveQuotaTarget` and Autumn's `creditSchema` each multiply a `chat_messages` amount by its credit cost once, so passing credits would double-convert. That charge is applied without a balance check — the balance may go negative, which blocks the next message. Stream failures charge nothing extra; thread-title generation is intentionally not billed.

**Grandfathering:** existing subscribers stay on their old plan version (Autumn plan versioning — config pushes used `create_version` / no migration). Pre-credits-rollout customers have per-feature balances and no `credits` entry, so every code path above falls back to the legacy per-feature behavior automatically. Chat costs them a flat 1 `chat_messages` unit per message (`chargeExtraChatCredits` is a no-op without a `credits` balance). The same versioning applies to the Ultra rollout: Pro subscribers from before it keep 1,200 credits/month, and only new Pro subscriptions get 1,030.

---

## Backend – Convex Usage Module

All quota logic lives in `convex/usage/`:

| File | Purpose |
|---|---|
| `helpers.ts` | Core functions: `checkQuota`, `decrementQuota`, `incrementQuota`, `consumeQuota`, `releaseQuota`, `syncAllFeatures` |
| `tracking.ts` | Node actions: `trackUsage` (POST to Autumn /track + re-sync), `syncQuotasForUser`, `getOrCreateCustomer` |
| `actions.ts` | Public action: `syncQuotas` (called from frontend on app load) |
| `queries.ts` | Public query: `getMyQuotas` (reactive, powers `useFeatureQuota` hook) |
| `testing.ts` | E2E test hooks for the payment-overdue flow, gated on `E2E_TEST_HOOKS=1`: `resolveUserId`, `setBillingOverride`, `clearBillingOverride`, `getBillingDebugState` |

### Key functions in `helpers.ts`

- **`checkQuota(ctx, userId, featureId, amount)`** – read-only check. Returns `{ allowed, balance, synced }`. Returns `allowed: false` if no quota doc exists or the feature is missing.
- **`decrementQuota(ctx, userId, featureId, amount)`** – writes to the local cache. Does NOT validate; caller must check first.
- **`incrementQuota(ctx, userId, featureId, amount)`** – inverse local write used for release semantics (`balance += amount`, `used -= amount`, clamped at 0).
- **`consumeQuota(ctx, userId, featureId, amount)`** – the main enforcement function. Combines check + decrement + schedules async Autumn tracking. Throws `ConvexError` with `code: 'USAGE_LIMIT'` when the limit is hit, or `code: 'QUOTA_NOT_SYNCED'` when no quota doc exists.
- **`releaseQuota(ctx, userId, featureId, amount)`** – optimistic local release + async Autumn tracking with negative value (e.g. `-1` for releasing one course slot).
- **`syncAllFeatures(userId, features)`** – internal mutation that overwrites the `usageQuotas` doc with fresh data from Autumn.

### Schema

The `usageQuotas` table (in `convex/schema.ts`):

```typescript
usageQuotas: defineTable({
  userId: v.string(),
  features: v.record(v.string(), v.object({
    balance: v.number(),
    included: v.number(),
    used: v.number(),
    interval: v.optional(v.string()),
    unlimited: v.optional(v.boolean()),
  })),
  lastSyncedAt: v.number(),
}).index('by_userId', ['userId']),
```

Each user has at most one document. The `features` record is keyed by feature ID strings.

---

## Backend – Autumn Component

**`convex/autumn.ts`** configures the `@useautumn/convex` component:

```typescript
export const autumn = new Autumn(components.autumn, {
  secretKey: process.env.AUTUMN_SECRET_KEY!,
  identify: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return null;
    return {
      customerId: user.subject as string,
      customerData: { name: user.name, email: user.email },
    };
  },
});
```

This file exports Autumn's API functions (`track`, `check`, `checkout`, `listProducts`, etc.) which are used by the `autumn-js/react` hooks on the frontend. The `identify` function maps the authenticated Convex user to an Autumn customer via `user.subject`.

---

## Autumn REST API Contract

Our `tracking.ts` uses raw `fetch` calls (not the SDK) because Convex scheduled actions lack auth context. The Autumn REST API response format differs from the `autumn-js` SDK's normalised types.

### Customer response shape (`GET /customers/:id` or `POST /customers`)

```json
{
  "id": "user_subject_id",
  "subscriptions": [{ "plan_id": "free", "status": "active", ... }],
  "balances": {
    "chat_messages": {
      "feature_id": "chat_messages",
      "granted": 5,
      "remaining": 5,
      "usage": 0,
      "unlimited": false,
      "overage_allowed": false,
      "next_reset_at": 1776706479436
    }
  },
  "flags": {
    "multiple_languages": {
      "id": "flag_xxx",
      "plan_id": "pro",
      "expires_at": null,
      "feature_id": "multiple_languages"
    }
  }
}
```

Key points:
- **`balances`** contains metered features. Fields: `granted` (included amount), `remaining` (available balance), `usage` (consumed this period), `unlimited`, `overage_allowed`, `next_reset_at`.
- **`flags`** contains boolean features (added March 16, 2026). Fields: `id`, `plan_id`, `expires_at`, `feature_id`.
- There is **no `features` field** in the raw API. The `features` key is an SDK abstraction that merges `balances` + `flags`. Since we use raw `fetch`, we read `balances` and `flags` separately.

### `POST /customers` (getOrCreate) -- used by `syncQuotasForUser`

Idempotent: creates the customer if new, returns existing if known. With `autoEnable: true` on the free plan, new customers automatically get the free plan attached. Returns the full customer object including `balances` and `flags`.

### `GET /customers/:id` -- used by `trackUsage` (post-track re-sync)

Returns the customer object. Used after `POST /track` where the customer is guaranteed to exist.

### `POST /track` -- used by `trackUsage`

Records a usage event. As of March 17, 2026, this endpoint no longer auto-creates customers. The customer must already exist (ensured by calling `POST /customers` during sync/app load).

### Field mapping: Autumn API → local `FeatureState`

| Autumn raw field | Local `FeatureState` field |
|---|---|
| `balances[id].remaining` | `balance` |
| `balances[id].granted` | `included` |
| `balances[id].usage` | `used` |
| `balances[id].unlimited` | `unlimited` |
| (no interval in raw balances) | `interval` (unused) |
| `flags[id]` (presence) | `{ balance: 1, included: 1, used: 0, unlimited: true }` |

### v1.2 vs v2.x customer shapes (why both)

`GET /customers/:id` returns one of two unrelated shapes depending on the `x-api-version` header, and the two families disagree about where state lives. Verified 2026-07-26 against one live customer, same instant:

| Concept | v1.x `products[]` | v2.x `subscriptions[]` |
|---|---|---|
| product id | `id` | `plan_id` (`id` is the row id) |
| add-on | `is_add_on` | `add_on` |
| free plan | `is_default` | `auto_enable` |
| trialing | `status: "trialing"` | `status: "active"` + `trial_ends_at` |
| past due | `status: "past_due"` | `status: "active"` + `past_due: true` |
| trial end | `current_period_end` | `trial_ends_at` |

v2 has NO `"trialing"` and NO `"past_due"` status — it keeps `status` as the lifecycle state and moves both into dedicated fields. So a check against `status` alone is blind on v2, and one against the boolean alone is blind on v1. Every consumer reads the version-independent `AutumnPlan` from `lib/autumn/customer-shape.ts` instead, and that file is the only place either set of raw field names appears.

We can't simply standardise on one version: the client SDK is pinned to v1.2 (`LATEST_API_VERSION` in autumn-js, not overridable through `useCustomer()`), while `convex/usage/tracking.ts` needs v2 for `balances`/`flags` — v1.2 returns `features` instead.

---

## Quota Sync Lifecycle

1. **On app load** – `app/app/(main)/layout.tsx` calls `syncQuotas` action once per session (guarded by a `useRef`). This calls `POST /customers` (getOrCreate) to ensure the customer exists in Autumn and fetch all entitlements, then writes them to the local `usageQuotas` table. For new users, this idempotently creates the customer and auto-enables the free plan.

2. **After each tracked usage** – when `consumeQuota` or `releaseQuota` is called in a mutation, it schedules `trackUsage` via `ctx.scheduler.runAfter(0, ...)` (positive for consume, negative for release). The `trackUsage` action POSTs to Autumn's `/track` endpoint, then fetches the customer via `GET /customers/:id` and syncs back to Convex. This keeps the local cache consistent with Autumn's server-side state.

3. **Frontend reactivity** – `getMyQuotas` is a Convex query, so any write to `usageQuotas` automatically triggers re-renders in components using `useFeatureQuota`.

---

## Backend Enforcement (Mutations)

Mutations that change metered usage call `consumeQuota` or `releaseQuota`. Only non-archived courses count toward the course limit (archiving a course releases its `COURSES` quota; unarchiving re-consumes it). The current enforcement points:

| Mutation | File | Feature ID | Amount |
|---|---|---|---|
| `sendMessage` | `convex/features/chat/messages.ts` | `CHAT_MESSAGES` | 1 |
| `approveCard` | `convex/features/chat/cardApprovals.ts` | `CUSTOM_SENTENCES` | 1 |
| `createCustomText` | `convex/features/customTexts.ts` | `CUSTOM_SENTENCES` | 1 |
| `createCustomTextsBatch` | `convex/features/customTexts.ts` | `CUSTOM_SENTENCES` | accepted batch size |
| `autoFillTranslations` (via `consumeAutoFillQuota`) | `convex/features/customTexts.ts` | `TRANSLATION_AUTO_FILL` | 1 |
| `transcribeAudio` (via `consumeTranscriptionQuota`) | `convex/features/chat/transcribe.ts` | `TRANSCRIPTIONS` | 1 |
| `editCard` | `convex/features/scheduling.ts` | `CARD_EDITS` | 1 |
| `regenerateCardAudio` | `convex/features/scheduling.ts` | `AUDIO_REGENERATIONS` | 1 |
| `flagTranslation` | `convex/features/scheduling.ts` | `TRANSLATION_FLAGS` | 1 |
| `createCourse` | `convex/features/courses.ts` | `COURSES` | consume 1 |
| `completeOnboarding` (course creation) | `convex/features/courses.ts` | `COURSES` | consume 1 |
| `unarchiveCourse` | `convex/features/courses.ts` | `COURSES` | consume 1 |
| `archiveCourse` | `convex/features/courses.ts` | `COURSES` | release 1 (track `-1`) |
| `addCardsFromCollection` | `convex/features/decks.ts` | `SENTENCES` | batch size |
| `addSingleTextFromCollection` | `convex/features/decks.ts` | `SENTENCES` | 1 |

Typical consume pattern:

```typescript
const userId = await requireAuthUserId(ctx);
await consumeQuota(ctx, userId, FEATURE_IDS.SOME_FEATURE, amount);
// ... proceed with the actual logic
```

Release pattern:

```typescript
const userId = await requireAuthUserId(ctx);
await releaseQuota(ctx, userId, FEATURE_IDS.SOME_FEATURE, amount);
```

If `consumeQuota` or `releaseQuota` throws, the mutation aborts and the client receives the `ConvexError`.

**Boolean features** (like `MULTIPLE_LANGUAGES`) are NOT enforced via `consumeQuota`. Instead, the frontend uses `useFeatureQuota` to read the boolean state and conditionally limits the UI (e.g., max 2 languages vs. max 3).

---

## Past-due (dunning) flow

When Autumn reports a plan as past due, `syncAllFeatures` stamps `pastDueSince` on the user's `usageQuotas` doc (and clears it once the state recovers). Everything below keys off that field.

**No grace window.** From the moment the synced state shows past due, `PaymentOverdueDialog` (`components/autumn/payment-overdue-dialog.tsx`, mounted once in `BillingGate` from the /app layout) hard-blocks the app: no dismiss button, no close X, escape and outside clicks are swallowed. The dialog is UX only — the authoritative backstop is `assertBillingCurrent` in `convex/usage/helpers.ts`, which runs inside `consumeQuota` and fails every quota-consuming mutation with `PAYMENT_PAST_DUE` while `pastDueSince` is set.

**Two exits, and only two:**

1. **Pay the outstanding invoice** (`pastDueInvoiceUrl`, the Stripe-hosted page). This is the CTA because it is the only action that actually settles the debt — the billing portal merely swaps the card on file and waits for Stripe's next retry.
2. **Cancel**, dropping to Free immediately, via the `cancelOverdueSubscription` action (`convex/billing.ts`). Behind a confirmation step because it archives every active course but one.

**`cancelOverdueSubscription` outcomes** (the past-due state is re-derived from Autumn server-side, never trusted from the client):

- `cancelled` — the plan was past due with an unsettled invoice; it is cancelled immediately and Stripe voids the outstanding invoice.
- `recovered` — nothing needed cancelling: either Autumn no longer reports a past-due plan (payment landed, Stripe's retry succeeded, or a previous partial run already cancelled), or the plan still reads past_due but the expanded invoices show nothing unpaid — i.e. the user just paid the hosted invoice and Autumn's subscription state is lagging the Stripe webhook. Cancelling in that window would destroy a subscription that was just paid for, so the server refuses. Both branches re-sync the quota mirror first so a stale block clears instead of stranding the user.

**Admin routes are excluded** from the dialog: /app/admin nests under the same layout, and an admin whose own account goes past due would otherwise lose access to the dashboard. `requireAdmin` still guards the underlying data.

**Course auto-archive is deferred while past due.** The auto-archive in `syncAllFeatures` is deliberately suppressed during the past-due window; it runs in the follow-on sync after a cancel, once the plan really has shrunk to Free. That is the archival the cancel confirmation warns about.

E2E coverage: `e2e/payment-overdue.spec.ts` forces the synced past-due state via the `E2E_TEST_HOOKS`-gated helpers in `convex/usage/testing.ts`.

---

## Stripe Managed Payments (merchant of record)

Managed Payments makes **Stripe** the seller of record for paid subscriptions:
Stripe calculates, charges, and remits indirect tax in 80+ countries, and owns
fraud, disputes, and transaction-level support. Autumn has no first-class support
for it — the only activation path is to forward Stripe's `managed_payments` field
onto the Checkout Session Autumn creates.

**Kill switch:** the Convex env var `AUTUMN_MANAGED_PAYMENTS`. Only the literal
string `'true'` enables it; `npx convex env unset AUTUMN_MANAGED_PAYMENTS` reverts
checkout to the previous behaviour on the next call. Read per call (not at module
load) so the switch doesn't wait on isolate recycling.

**Where it is injected.** One file — `convex/billing.ts` — deliberately
server-side only, so the browser can neither enable nor suppress it:

- `attachNewPlan` (the first-purchase path, the only flow that can actually be
  MoR — see below) adds `checkout_session_params` while the flag is on, and
  always sends `redirect_mode: 'always'` (flag or no flag): `'if_required'`
  would bill a lapsed subscriber's surviving card directly, creating a
  subscription with no Checkout Session — charged on button click without any
  confirmation step, and (with the flag on) silently **not**
  merchant-of-record. With `'always'`, Stripe's hosted page is both the MoR
  carrier and the explicit price+tax confirmation for every first purchase.
- `switchPlanDuringTrial` adds `checkout_session_params` to its
  `/billing.attach` body too (usually inert — a trialing customer has a card on
  file, so that branch rarely produces a session).

The legacy `attach`/`checkout` actions in `convex/autumn.ts` inject **nothing**:
their path cannot carry MoR (API version, below), so injecting there could only
produce Stripe 400s. Instead BOTH carry a guard
(`guardFirstPurchaseOffLegacyPath`) — while the flag is on, a first purchase
(no paid plan, no running trial) is rejected with a "please refresh" error, so
a stale client can never complete a first purchase without merchant of record.
`checkout` is guarded too because for a card-less customer the v1.2 preview
*itself* creates the Stripe session and autumn-js redirects straight to it
(dialog never opens) — the sandbox findings below show the MoR error surfacing
from `autumn:checkout` for exactly this reason. Trialing customers and payers
pass the guard: their calls never create sessions, and the dialog needs the
preview. The public actions also no longer accept `checkoutSessionParams` from
the client at all: the component would forward it verbatim onto the Stripe
session, letting any authenticated user pass
`managed_payments: {enabled: false}` and shift the sale's tax liability onto
us.

**Casing is load-bearing and looks wrong.** The `/billing.attach` bodies in
`convex/billing.ts` are hand-written snake_case for the raw REST API — nothing
case-converts them, and the children of `checkout_session_params` are forwarded
to Stripe verbatim. `MANAGED_PAYMENTS_SESSION_PARAMS`
(`lib/autumn/managed-payments.ts`) must stay snake_case; a "consistency"
refactor to camelCase silently breaks MoR (or turns it into a Stripe 400).

**Autumn's own session params win the merge.** Server-side Autumn does
`{...checkoutSessionParams, ...params}`. It never sets `managed_payments`, so ours
survives — but when the Autumn org has **automatic tax enabled**, Autumn bakes in
`automatic_tax`, `tax_id_collection`, and `customer_update`, all of which are
*forbidden* under Managed Payments and cannot be overridden from our side. Autumn's
automatic tax must therefore stay **off**, which is correct anyway: Stripe now does
the tax.

**Dashboard prerequisites** (none of these live in the repo):

1. Managed Payments terms of service accepted at `dashboard.stripe.com/settings/managed-payments`.
2. The Autumn↔Stripe link must be a **secret-key** connection — Managed Payments
   does not support platform-controlled/Connect accounts.
3. An eligible `tax_code` set on every Stripe product Autumn created, in **both**
   test and live mode. `txcd_10103000` (*SaaS – personal use*) fits our plans —
   personal-use rather than business-use because AGB §1.2/§2.3 restrict the
   Services to consumers. Dashboard → Product catalog → ⋯ → Edit product →
   Product tax code; eligible codes are labelled `Eligible for Managed Payments`.

   > ⚠️ **Recurring footgun.** Autumn never sets `tax_code` when it creates
   > Stripe products — it only reads the field for tax previews. So *every new
   > paid plan added to `autumn.config.ts` needs its tax code set by hand in
   > Stripe*, or checkout for that plan fails with:
   > `Invalid line_items[0]: the product tax code is missing.`
   > Add it to the checklist whenever a plan is added.
4. Stripe → Tax settings → **"Include tax in prices" = Automatic**
   (`defaults.tax_behavior: inferred_by_currency`). Automatic infers *exclusive*
   for USD/CAD and *inclusive* for every other currency, which is the local
   convention in each market. Autumn never sets `tax_behavior` on the prices it
   creates, so this dashboard default is what actually governs.

   **It keys off the Price's currency, not the customer's country.** Stripe:
   *"if your price is in USD and you use the inferred setting, the behavior is
   determined by your USD configuration, even if the customer pays in EUR."*
   Adaptive Pricing (always on under Managed Payments) only changes the
   presentment currency, not the tax behaviour. So with EUR-only plans every
   customer gets tax-inclusive, including US ones — US sales tax then comes out
   of margin. Genuinely exclusive US pricing requires a USD price on the plan
   via `additional_currencies` in `autumn.config.ts`.

   Note `tax_behavior` **cannot be changed** once a Price is created as inclusive
   or exclusive, so get this right before live-mode prices exist.

**Scope limit — new Checkout purchases only.** Stripe cannot convert existing
subscriptions, and Autumn skips Checkout entirely when the customer already has a
usable card (upgrades and downgrades become direct Stripe subscription updates). A
permanently mixed estate of MoR and non-MoR subscriptions is the expected steady
state, not a bug.

**Immediate cancels on MoR subscriptions fail in Autumn** (live-verified
2026-08-10): Autumn's `cancel_immediately` means "cancel with prorated refund",
and creating that refund invoice is forbidden under Managed Payments —
`(Stripe Error) Invoices cannot be created for Subscriptions with Managed
Payments enabled` (400). Production is unaffected today: the only immediate
cancel in the app, `cancelOverdueSubscription`, acts on past-due subscriptions
where Stripe VOIDS the existing invoice instead of creating one (proven live by
the billing-clock dunning journey). But never add an immediate-cancel feature
for active MoR subscriptions on Autumn's `/cancel` — a Stripe-side DELETE
(which invoices nothing) is the working alternative, and end-of-cycle cancels
are unaffected.

**Sandbox findings (2026-08-09), first run with the flag on:**

```
[CONVEX A(autumn:checkout)] [LOG] 'ERROR' '[Autumn] (Stripe Error)
You specified a Stripe-Account header, but Managed Payments cannot be used with Connect.'
```

Two things follow from that one line:

- **The blocker is the Connect link, not the API version.** Autumn's
  `createStripeCli` prefers a stored secret key and otherwise falls back to a
  Connect account ID sent as the `Stripe-Account` header. That header is present,
  so the org is linked to Stripe through the Connect/OAuth flow — which Managed
  Payments does not support at all. Fix in the Autumn dashboard
  (`app.useautumn.com/sandbox/dev?tab=stripe`): connect the Stripe **secret key**
  instead. Until then no amount of parameter plumbing helps.
- **The passthrough itself works.** Stripe recognised `managed_payments` at every
  stage, so the params survive every hop (component → autumn-js → Autumn →
  Stripe). Nothing in *our* code needs to change.
- Note it surfaced from `autumn:checkout`, i.e. the preview *does* reach Stripe.
  (At the time the flag was injected on the legacy `checkout`/`attach` actions
  too; that injection was later removed — the legacy path can never carry MoR,
  so it could only ever produce this class of error.)

Clearing the Connect link and setting product tax codes then surfaced the
**blocking** error:

```
'[Autumn] (Stripe Error) Managed Payments is not supported on API version
2025-02-24.acacia. Update your API version, or set the API Version of this
request to 2025-03-31.basil or greater.'
```

**This is upstream in Autumn and has no configuration seam on our side.** The
chain: `@useautumn/convex` builds `new AutumnSDK({ secretKey, url })` — no
version option — so autumn-js sends its `LATEST_API_VERSION = "1.2"`, which
routes to Autumn's legacy `handleCreateCheckout.ts`, which calls
`createStripeCli({ org, env, legacyVersion: true })`, pinning
`2025-02-24.acacia`. Managed Payments requires `2025-03-31.basil`+.

**How we work around it: `billing.attachNewPlan`.** Only the *first* paid
purchase makes Autumn build a Checkout Session (`redirect_mode: 'always'`
guarantees it even when a saved card survived — see above). So exactly that one
flow is routed to `POST /billing.attach` at api version `2.1.0`, whose Stripe
client carries no `legacyVersion` pin. Everything else stays on the legacy
path.

That split is deliberate, not laziness:

- **Upgrades/downgrades can't be MoR anyway.** Stripe cannot convert an existing
  subscription, and Autumn updates those in place without a Checkout Session.
- **v2 has no `scenario`.** The v1.2 `/checkout` preview's `product.scenario`
  (`upgrade | downgrade | renew | cancel | new | active | scheduled`) drives the
  dialog copy, the pricing-table CTA labels, and every branch of
  `switchPlanDuringTrial`. v2 offers only `attach_action`
  (`activate | upgrade | downgrade | none | purchase`), which collapses
  renew/active/scheduled and has no `cancel` — the exact distinctions
  `e2e/billing.spec.ts` steps 4–6 exist to protect. Keeping the legacy preview
  keeps that classifier.
- **`switchPlanDuringTrial`'s preview is safe on the legacy path** precisely
  because a trialing customer has a card on file, so Autumn classifies the call
  as an upgrade/downgrade and builds no session. That is why it never hit this
  error.

Client routing lives in `hooks/use-new-plan-checkout.ts`, used by the pricing
table and the paywall/low-quota dialogs: a first purchase
(`!hasPaidPlan && !onTrial`, paid product) calls `billing.attachNewPlan` and
redirects to the returned `payment_url`; everything else calls `checkout()` +
CheckoutDialog as before. Routing *before* `checkout()` is mandatory, not
style: for card-less customers the preview would itself create the (legacy,
non-MoR-capable) session and redirect — the dialog never opens, so a
dialog-side branch could not intercept it. The routing needs no server flag —
it is deterministic from the customer's own trial state (nothing to race), and
first purchases always take v2, which behaves identically with MoR off (the
env flag only controls the session params server-side). It is a hint only:
`attachNewPlan` re-derives everything server-side and rejects trialing
customers and existing payers outright, and the legacy-path guard (above)
catches stale clients.

> ⚠️ **`customize: { free_trial: null }`** is our reading of v2's
> `object | null` type as the equivalent of v1.2's `free_trial: false` — it is
> what stops a repeat trial on this path. A wrong reading either grants a
> second trial (the hole `gateTrialArgs` exists to close) or wrongly denies a
> first one. `e2e/billing-clock.spec.ts` ("lapsed repurchase … grants no
> second trial") verifies it against live Stripe: the repurchased
> subscription must come back `active` with `trial_end: null`.

> 🚨 **Upstream regression: the legacy `/attach` can no longer suppress a
> trial at all** (found 2026-08-09 by the billing-clock e2e, journey C;
> probed live the same day). The exact behavior matrix on v1.2:
>
> - `/checkout` (preview): `free_trial: false` still **works** — the preview
>   suppresses the plan's trial. `null` → 400 "free_trial: Invalid input".
> - `/attach`: `false` passes validation but is **silently lost** in
>   Autumn's v1.2→v2 translation (`freeTrialParamsV0ToV1` handles
>   undefined/null/object — a boolean falls through), so the plan's
>   configured trial applies anyway. `null` → the same 400. Live effect: a
>   PAYING customer upgrading Basic→Pro got a full "unused Basic Annual"
>   credit note **plus Pro's 7-day free trial**, €0 due — the cross-plan
>   trial hole `gateTrialArgs` closes, reopened upstream, with a refund
>   attached.
> - v2 `/billing.attach` with `customize.free_trial: null` works (what
>   attachNewPlan and switchPlanDuringTrial already use).
>
> Our fix (convex/autumn.ts): previews keep `freeTrial: false` on the legacy
> path; the `attach` action routes trial-suppressed **cross-plan switches to
> a paid target** (target not currently held AND not the free plan) through
> v2 via `attachViaV2NoTrial` — upgrades stay immediate-with-proration,
> downgrades stay scheduled-at-period-end, and the response is wrapped in
> the component's `{data, error}` container so autumn-js's redirect/refetch
> handling is unchanged. Renew (re-attaching a held plan) and cancel-to-Free
> stay fully legacy — v2's `attach_action` has no cancel, and free has no
> trial to suppress. NOTE the free target cannot be detected via "is it
> held": a paying customer does not hold `free` (see the starter-credits
> section above), so `attach` asks Autumn's product record
> (`GET /products/:id` → `is_default`/`properties.is_free`) and fails closed
> if it can't be read. Pinned by convex/tests/billing/trialGate.test.ts +
> managedPayments.test.ts (incl. "keeps cancel-to-Free on the legacy path
> for a real payer", whose fixture holds ONLY the paid plan), and live by
> journey C's "upgrade … in place" e2e (post-upgrade status must be
> `active`, not `trialing`).

The time-driven states around all of this — trial conversion, the scheduled
Free executing at period end, the lapsed-customer repurchase, a REAL
`past_due` from a failed renewal — are covered by `e2e/billing-clock.spec.ts`
on genuine Stripe **test clocks**: the spec pre-creates the clocked Stripe
customer and hands it to Autumn via `usage/testing:relinkStripeCustomer`
before the first purchase (needs a Stripe test-mode secret key —
`STRIPE_TEST_SECRET_KEY` in the env, or auto-picked-up from `.env.local`;
self-skips without one, refuses live keys).

**Test clocks accelerate Stripe only.** Hosted Autumn ingests event-driven
changes from clocked customers (payment failures → `past_due`, invoice.paid,
API cancels), but its `trialing`/`scheduled` statuses derive from its stored
**real-world** dates — a clock-driven trial end or scheduled-plan start does
not flip Autumn's state until the real date arrives. The spec therefore
asserts Stripe-side effects after clock advances and produces Autumn-side
transitions via Autumn's API (`usage/testing:cancelPlanNow`, immediate
cancel) or real payment events. Its journey C additionally
reconstructs a
**grandfathered legacy customer** — subscription created via Autumn's v1.2
`/attach` with a card on file (`usage/testing:legacyAttachPlan`), so non-MoR
by construction — and proves the mixed estate works with the flag on:
in-place upgrade (same subscription id, still non-MoR), scheduled
downgrade + renew, the annual renewal charging the saved card, and cancel to
Free at period end.

> ⚠️ **Autumn does not ingest Stripe-side deletions of Managed Payments
> subscriptions** (probed live twice, 2026-08-10: a trialing MoR
> subscription DELETEd at Stripe left Autumn reporting `trialing` 40+
> minutes later, with `customer.subscription.deleted` fired and fully
> delivered). Test-side this rules out Stripe-side deletes as a lapse
> mechanism (journey D uses `cancelPlanNow` instead). Product-side it means
> an MoR subscription cancelled at Stripe outside Autumn (support action,
> fraud/dispute cancellation) leaves the customer with paid access in
> Autumn — and therefore in our quota mirror — indefinitely. Worth raising
> with Autumn alongside the legacyVersion report below. Two spellings of
> Stripe cancellation state, while we're at it: Autumn's scheduled
> cancel-to-Free sets `cancel_at` (= period end) on the subscription, NOT
> `cancel_at_period_end` — check both when asserting.

**The upstream fix would make all of this unnecessary:** Autumn dropping
`legacyVersion: true` in
`server/src/internal/customers/add-product/handleCreateCheckout.ts`, or exposing
an API-version option on the Convex component. Report drafted; if they ship it,
delete `attachNewPlan`, `hooks/use-new-plan-checkout.ts`, and the legacy-path
guard, and go back to plain `checkout()` + `attach()`.

---

## Frontend – Quota Hook

**`components/feature_tracking/useFeatureQuota.ts`**

```typescript
export function useFeatureQuota(featureId: string): FeatureQuotaInfo
```

Returns: `{ balance, included, used, unlimited, isAvailable, isLoading }`

Behavior:
- **`quotas === undefined`** (Convex query still loading): returns `isAvailable: true, isLoading: true`. This prevents a flash of "locked" UI. The backend mutation is the authoritative gate.
- **`quotas === null`** (no quota doc synced yet): returns `isAvailable: false, isLoading: false`.
- **Feature not found in doc**: returns `isAvailable: false, isLoading: false`.
- **Feature found**: `isAvailable = unlimited || balance > 0`.

---

## Frontend – UI Components

### `FeatureBadge` (`components/feature_tracking/FeatureBadge.tsx`)

A small inline badge showing remaining quota. Behavior:
- **Hidden** while loading, when unlimited, or when balance > 3 (`LOW_BALANCE_THRESHOLD`).
- **Amber badge** (`"N left"`) when 1–3 remaining. Clicking opens `LowQuotaDialog`.
- **Red badge** (`"Limit reached"`) when 0 remaining. Clicking opens `PaywallDialog`.

### `FeatureGatedButton` (`components/feature_tracking/FeatureGatedButton.tsx`)

A button wrapper that adapts based on quota:
- **Quota available**: renders normally, delegates click to `onAction`. Shows an optional `FeatureBadge`.
- **Quota exhausted**: renders as an "Upgrade" button with a lock icon. Clicking opens `PaywallDialog`.

Used in `CourseMenu` for the "Create New Course" button.

### `PaywallDialog` (`components/autumn/paywall-dialog.tsx`)

Shown when a feature limit is fully reached (balance = 0). Uses `usePaywall({ featureId })` from `autumn-js/react` to fetch Autumn's paywall preview (which includes the next product/plan to upgrade to).

- Shows a spinner only while `isLoading` is true.
- Once loaded, displays a title from `getPaywallTitle()` and a message from `getPaywallMessage()` (both in `lib/autumn/paywall-content.tsx`).
- Products from the paywall preview are filtered with `filterProductsByFeatureIncrease()` so the suggested plan actually raises the limit for that feature. If that filter removes every product (e.g. the next tier is Basic but both Free and Basic grant the same number of active courses), **`PaywallDialog` falls back to `usePricingTable()`** and `findUpgradeProductFromPricingTable()` in `lib/autumn/find-upgrade-product.ts`—the same resolution path as `LowQuotaDialog`—so checkout can still offer a real upgrade (e.g. Pro).
- Footer has two buttons:
  - **"Not now"** – dismisses the dialog.
  - **"Upgrade to {plan}"** – calls `useCustomer().checkout({ productId, dialog: CheckoutDialog })` to initiate the Autumn checkout flow in a dialog.
- If `preview` is undefined after loading, shows a generic "Feature Unavailable" message.

### `LowQuotaDialog` (`components/autumn/low-quota-dialog.tsx`)

Shown when quota is low but not zero (1–3 remaining). Does NOT use `usePaywall` (which only works for actually-limited features). Instead uses `usePricingTable()` to find the next upgrade product.

- Identifies the upgrade product via `findUpgradeProductFromPricingTable()` (`lib/autumn/find-upgrade-product.ts`).
- Footer has two buttons:
  - **"Not now"** – dismisses the dialog.
  - **"Upgrade to {plan}"** – same checkout flow as `PaywallDialog`.

### `CheckoutDialog` (`components/autumn/checkout-dialog.tsx`)

The Autumn-provided checkout UI rendered as a dialog. Passed to `checkout({ dialog: CheckoutDialog })` so the checkout form appears inline rather than redirecting.

### `CourseLanguageSettings` (`components/course/CourseLanguageSettings.tsx`)

Uses `useFeatureQuota(FEATURE_IDS.MULTIPLE_LANGUAGES)` to determine language limits:
- **Has feature**: max 3 total languages, max 2 per group.
- **Doesn't have feature**: max 2 total languages, max 1 per group.
- **Grandfathering**: if a saved course already exceeds the current caps (legacy Pro courses created when the limit was 5), the editor raises its limits to the existing language counts — nothing is force-removed; adding more is disabled instead.
- Shows an inline upgrade banner with lock icon when the feature is not available.

---

## Frontend – Error Handling

When a backend mutation throws `USAGE_LIMIT`, the frontend catches it:

### Chat messages (`hooks/use-send-message.ts`)

```typescript
if (error instanceof ConvexError && error.data?.code === 'USAGE_LIMIT') {
  const featureId = error.data?.featureId ?? FEATURE_IDS.CHAT_MESSAGES;
  onUsageLimit?.(featureId);
}
```

The `onUsageLimit` callback (passed from `ChatPanel`) opens the `PaywallDialog`.

### Card approvals (`hooks/use-card-approvals.ts`)

```typescript
if (error instanceof ConvexError && error.data?.code === 'USAGE_LIMIT') {
  setUsageLimitHit(true);
}
```

The `usageLimitHit` state triggers `PaywallDialog` rendering in `CardApproval.tsx`.

---

## Adding a New Gated Feature

Follow these steps to gate a new feature behind Autumn:

### 1. Configure in Autumn dashboard
Create the feature in Autumn's dashboard with the desired limits per plan tier. Note the feature ID string.

### 2. Add the feature ID
In `convex/features/featureIds.ts`, add the new ID:
```typescript
export const FEATURE_IDS = {
  // ... existing
  MY_NEW_FEATURE: 'my_new_feature',
} as const;
```

### 3. Backend enforcement (for metered features)
In the relevant mutation, add:
```typescript
import { consumeQuota } from '../usage/helpers';
import { FEATURE_IDS } from '../features/featureIds';

// Inside the handler:
const userId = await requireAuthUserId(ctx);
await consumeQuota(ctx, userId, FEATURE_IDS.MY_NEW_FEATURE, 1);
```

### 4. Frontend gating
Use the existing components:

```tsx
// Read quota state
const { isAvailable, balance } = useFeatureQuota(FEATURE_IDS.MY_NEW_FEATURE);

// Show a badge (auto-hides when balance > 3)
<FeatureBadge featureId={FEATURE_IDS.MY_NEW_FEATURE} />

// Gate a button
<FeatureGatedButton featureId={FEATURE_IDS.MY_NEW_FEATURE} onAction={handleClick}>
  Do Thing
</FeatureGatedButton>

// Manual paywall trigger
<PaywallDialog open={open} setOpen={setOpen} featureId={FEATURE_IDS.MY_NEW_FEATURE} />
```

### 5. Handle errors (for mutation-triggered limits)
If the feature is consumed via a mutation (not just UI-gated), catch the `USAGE_LIMIT` error:
```typescript
if (error instanceof ConvexError && error.data?.code === 'USAGE_LIMIT') {
  // Show PaywallDialog or appropriate feedback
}
```

### 6. Add translations
Add entries in `messages/en.json` and `messages/de.json` for any new user-facing strings (badge text, dialog copy, etc.).

---

## Common Pitfalls

### `usePaywall` vs `usePricingTable`
- `usePaywall({ featureId })` only returns product data when the feature is actually at its limit. If you call it for a feature that still has balance, `preview` will be `undefined`. This is why `LowQuotaDialog` uses `usePricingTable()` instead.
- If `PaywallDialog` shows a spinner forever, check that `isLoading` is being distinguished from `preview === undefined`.

### Optimistic defaults in `useFeatureQuota`
While the Convex query is loading (`quotas === undefined`), the hook returns `isAvailable: true` to avoid UI flicker. The **backend mutation is the authoritative gate**. Never rely solely on the frontend check for security-critical enforcement.

### Quota doc not synced
If a user's `usageQuotas` doc doesn't exist yet (e.g., first visit before `syncQuotas` completes), `useFeatureQuota` returns `isAvailable: false` and `consumeQuota` throws `QUOTA_NOT_SYNCED`. The app calls `syncQuotas` on load in `app/app/(main)/layout.tsx` to handle this.

### Boolean vs metered features
Boolean features (like `multiple_languages`) have `balance: 1` when enabled and `balance: 0` when disabled. They are **not** decremented via `consumeQuota`. They are read-only on the frontend via `useFeatureQuota(...).isAvailable`. Don't call `consumeQuota` for boolean features — it would decrement the balance to 0 and effectively disable the feature.

### The `identify` function
Autumn identifies users by `user.subject` from the Convex auth identity. This must match the customer ID used in Autumn's dashboard. If auth changes, the mapping may break.

### Re-sync after checkout
After a user completes checkout via `CheckoutDialog`, Autumn updates their entitlements server-side. The local `usageQuotas` cache won't reflect this until the next `syncQuotas` call. Consider triggering a sync after checkout completes if immediate UI update is needed.

---

## File Reference

| File | Role |
|---|---|
| `convex/features/featureIds.ts` | Feature ID constants |
| `convex/usage/helpers.ts` | `checkQuota`, `consumeQuota`, `releaseQuota`, `decrementQuota`, `incrementQuota`, `syncAllFeatures` |
| `convex/usage/tracking.ts` | Autumn API calls: `trackUsage`, `fetchCustomerData`, `getOrCreateCustomer`, `syncQuotasForUser`, `toFeaturesRecord` |
| `convex/usage/actions.ts` | Public `syncQuotas` action |
| `convex/usage/queries.ts` | Public `getMyQuotas` query |
| `convex/autumn.ts` | Autumn component config and API exports |
| `convex/schema.ts` | `usageQuotas` table definition |
| `components/feature_tracking/useFeatureQuota.ts` | React hook for reading quota state |
| `components/feature_tracking/FeatureBadge.tsx` | Inline badge showing remaining uses |
| `components/feature_tracking/FeatureGatedButton.tsx` | Button that shows paywall when exhausted |
| `components/autumn/paywall-dialog.tsx` | Full limit-reached dialog with upgrade |
| `components/autumn/low-quota-dialog.tsx` | Low balance warning dialog with upgrade |
| `components/autumn/checkout-dialog.tsx` | Autumn checkout UI wrapper |
| `lib/autumn/paywall-content.tsx` | Generates title/message from Autumn preview data |
| `app/app/(main)/layout.tsx` | Calls `syncQuotas` on app load |
| `hooks/use-send-message.ts` | Catches `USAGE_LIMIT` errors for chat |
| `hooks/use-card-approvals.ts` | Catches `USAGE_LIMIT` errors for card approval |
| `messages/en.json` / `messages/de.json` | Translation keys for all quota UI |
