# Autumn Integration & Usage Tracking

This document describes how feature gating, usage quotas, and the Autumn billing SDK are wired together across the Phrasis codebase. Use it as a reference when adding new gated features, modifying quota enforcement, or debugging paywall/checkout flows.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Feature IDs](#feature-ids)
3. [Credit System](#credit-system)
4. [Backend – Convex Usage Module](#backend--convex-usage-module)
5. [Backend – Autumn Component](#backend--autumn-component)
6. [Quota Sync Lifecycle](#quota-sync-lifecycle)
7. [Backend Enforcement (Mutations)](#backend-enforcement-mutations)
8. [Frontend – Quota Hook](#frontend--quota-hook)
9. [Frontend – UI Components](#frontend--ui-components)
10. [Frontend – Error Handling](#frontend--error-handling)
11. [Adding a New Gated Feature](#adding-a-new-gated-feature)
12. [Common Pitfalls](#common-pitfalls)

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

Since the credits rollout, `custom_sentences`, `translation_auto_fill`, and `chat_messages` are no longer granted as separate plan items. Instead, plans grant a shared `credits` pool (Free: 200 one-off + 30/month; Basic: 400/month; Pro: 1,200/month) and the `credits` feature in `autumn.config.ts` declares a `creditSchema` mapping each of those features to a credit cost (currently 1 credit per unit each). Monthly credits reset with the billing cycle (no rollover); one-off grants persist.

**Golden rule (from Autumn's docs): always check/track the UNDERLYING feature id, never `credits`.** Autumn converts tracked usage into credit deductions server-side via the `creditSchema`.

Client + server mirror this rule:

- `CREDIT_COSTS` in `convex/features/featureIds.ts` mirrors the `creditSchema` and is the single source of truth for conversions in app code.
- `resolveQuotaTarget` in `convex/usage/helpers.ts` redirects `checkQuota` / `decrementQuota` / `incrementQuota` (and therefore `consumeQuota` / `releaseQuota`) to the local `credits` balance (amount × credit cost) whenever the user's quota doc has a `credits` entry. The scheduled `trackUsage` still sends the underlying feature id.
- `useFeatureQuota` applies the same redirect on the client, returning balances in feature units (`credits / cost`).
- `toBillableFeature` in `lib/autumn/find-upgrade-product.ts` maps credit-billed features to the `credits` product item when searching for upgrade products (paywall / low-quota dialogs).

**Dynamic chat pricing:** a chat message costs 1 credit per started $0.005 (`CHAT_CREDIT_USD_STEP`) of actual LLM cost. `sendMessage` consumes 1 credit up-front via `consumeQuota(CHAT_MESSAGES, 1)`. `generateResponse` accumulates the real OpenRouter cost across all LLM steps (via a per-call `usageHandler` reading `providerMetadata.openrouter.usage.cost`; requires `usage: { include: true }` in `OPENROUTER_CHAT_EXTRA_BODY`) and then charges the remainder (`ceil(cost / step) - 1`) through the `chargeExtraChatCredits` internal mutation. That charge is applied without a balance check — the balance may go negative, which blocks the next message. Stream failures charge nothing extra; thread-title generation is intentionally not billed.

**Grandfathering:** existing subscribers stay on their old plan version (Autumn plan versioning — config pushes used `create_version` / no migration). Their customers have per-feature balances and no `credits` entry, so every code path above falls back to the legacy per-feature behavior automatically. Chat costs them a flat 1 `chat_messages` unit per message (`chargeExtraChatCredits` is a no-op without a `credits` balance).

---

## Backend – Convex Usage Module

All quota logic lives in `convex/usage/`:

| File | Purpose |
|---|---|
| `helpers.ts` | Core functions: `checkQuota`, `decrementQuota`, `incrementQuota`, `consumeQuota`, `releaseQuota`, `syncAllFeatures` |
| `tracking.ts` | Node actions: `trackUsage` (POST to Autumn /track + re-sync), `syncQuotasForUser`, `getOrCreateCustomer` |
| `actions.ts` | Public action: `syncQuotas` (called from frontend on app load) |
| `queries.ts` | Public query: `getMyQuotas` (reactive, powers `useFeatureQuota` hook) |
| `testOperations.ts` | Dev-only mutations for manually testing quota operations |

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

---

## Quota Sync Lifecycle

1. **On app load** – `app/app/(main)/layout.tsx` calls `syncQuotas` action once per session (guarded by a `useRef`). This calls `POST /customers` (getOrCreate) to ensure the customer exists in Autumn and fetch all entitlements, then writes them to the local `usageQuotas` table. For new users, this idempotently creates the customer and auto-enables the free plan.

2. **After each tracked usage** – when `consumeQuota` or `releaseQuota` is called in a mutation, it schedules `trackUsage` via `ctx.scheduler.runAfter(0, ...)` (positive for consume, negative for release). The `trackUsage` action POSTs to Autumn's `/track` endpoint, then fetches the customer via `GET /customers/:id` and syncs back to Convex. This keeps the local cache consistent with Autumn's server-side state.

3. **Frontend reactivity** – `getMyQuotas` is a Convex query, so any write to `usageQuotas` automatically triggers re-renders in components using `useFeatureQuota`.

---

## Backend Enforcement (Mutations)

Mutations that change metered usage call `consumeQuota` or `releaseQuota`. The current enforcement points:

| Mutation | File | Feature ID | Amount |
|---|---|---|---|
| `sendMessage` | `convex/features/chat/messages.ts` | `CHAT_MESSAGES` | 1 |
| `approveCard` | `convex/features/chat/cardApprovals.ts` | `CUSTOM_SENTENCES` | 1 |
| `createCourse` | `convex/features/courses.ts` | `COURSES` | consume 1 |
| `completeOnboarding` (course creation) | `convex/features/courses.ts` | `COURSES` | consume 1 |
| `unarchiveCourse` | `convex/features/courses.ts` | `COURSES` | consume 1 |
| `archiveCourse` | `convex/features/courses.ts` | `COURSES` | release 1 (track `-1`) |
| `addToUserDeck` | `convex/features/decks.ts` | `SENTENCES` | batch size |

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

**Boolean features** (like `MULTIPLE_LANGUAGES`) are NOT enforced via `consumeQuota`. Instead, the frontend uses `useFeatureQuota` to read the boolean state and conditionally limits the UI (e.g., max 2 languages vs. max 5).

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
- **Has feature**: max 5 total languages, max 3 per group.
- **Doesn't have feature**: max 2 total languages, max 1 per group.
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
