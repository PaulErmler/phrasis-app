# Autumn Integration & Usage Tracking

This document describes how feature gating, usage quotas, and the Autumn billing SDK are wired together across the Phrasis codebase. Use it as a reference when adding new gated features, modifying quota enforcement, or debugging paywall/checkout flows.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Feature IDs](#feature-ids)
3. [Backend – Convex Usage Module](#backend--convex-usage-module)
4. [Backend – Autumn Component](#backend--autumn-component)
5. [Quota Sync Lifecycle](#quota-sync-lifecycle)
6. [Backend Enforcement (Mutations)](#backend-enforcement-mutations)
7. [Frontend – Quota Hook](#frontend--quota-hook)
8. [Frontend – UI Components](#frontend--ui-components)
9. [Frontend – Error Handling](#frontend--error-handling)
10. [Adding a New Gated Feature](#adding-a-new-gated-feature)
11. [Common Pitfalls](#common-pitfalls)

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
│  Mutation: useQuota(ctx, userId, featureId, amount)          │
│    1. checkQuota() against local cache                       │
│    2. decrementQuota() optimistically                        │
│    3. scheduler.runAfter(trackUsage) ──POST──▶ Autumn /track │
│    4. trackUsage fetches fresh entitlements, writes back      │
│                                                              │
│  syncQuotas action  ◀── called on app load                   │
│    GET /customers/:id ──▶ syncAllFeatures mutation            │
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
} as const;
```

These IDs **must** match the feature IDs configured in Autumn's dashboard. `FEATURE_IDS` is imported on both the server and client wherever quota checks are needed.

**Types of features:**

| Feature ID | Type | Description |
|---|---|---|
| `chat_messages` | Usage (metered) | Messages sent in chat, resets per interval |
| `courses` | Usage (metered) | Number of active courses |
| `sentences` | Usage (metered) | Number of sentences added from collections |
| `custom_sentences` | Usage (metered) | Number of custom cards approved via chat |
| `multiple_languages` | Boolean (feature flag) | Whether the user can add >2 languages per course |

Boolean features have `balance: 1` and `unlimited: false` when enabled, or `balance: 0` when disabled. The local `isAvailable` check (`balance > 0 || unlimited`) works for both types.

---

## Backend – Convex Usage Module

All quota logic lives in `convex/usage/`:

| File | Purpose |
|---|---|
| `helpers.ts` | Core functions: `checkQuota`, `decrementQuota`, `useQuota`, `syncAllFeatures` |
| `tracking.ts` | Node actions: `trackUsage` (POST to Autumn /track + re-sync), `syncQuotasForUser` |
| `actions.ts` | Public action: `syncQuotas` (called from frontend on app load) |
| `queries.ts` | Public query: `getMyQuotas` (reactive, powers `useFeatureQuota` hook) |
| `testOperations.ts` | Dev-only mutations for manually testing quota operations |

### Key functions in `helpers.ts`

- **`checkQuota(ctx, userId, featureId, amount)`** – read-only check. Returns `{ allowed, balance, synced }`. Returns `allowed: false` if no quota doc exists or the feature is missing.
- **`decrementQuota(ctx, userId, featureId, amount)`** – writes to the local cache. Does NOT validate; caller must check first.
- **`useQuota(ctx, userId, featureId, amount)`** – the main enforcement function. Combines check + decrement + schedules async Autumn tracking. Throws `ConvexError` with `code: 'USAGE_LIMIT'` when the limit is hit, or `code: 'QUOTA_NOT_SYNCED'` when no quota doc exists.
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

## Quota Sync Lifecycle

1. **On app load** – `app/app/(main)/layout.tsx` calls `syncQuotas` action once per session (guarded by a `useRef`). This fetches all entitlements from Autumn's `GET /customers/:userId` endpoint and writes them to the local `usageQuotas` table.

2. **After each tracked usage** – when `useQuota` is called in a mutation, it schedules `trackUsage` via `ctx.scheduler.runAfter(0, ...)`. The `trackUsage` action POSTs to Autumn's `/track` endpoint, then immediately re-fetches the customer's entitlements and syncs them back to Convex. This keeps the local cache consistent with Autumn's server-side state.

3. **Frontend reactivity** – `getMyQuotas` is a Convex query, so any write to `usageQuotas` automatically triggers re-renders in components using `useFeatureQuota`.

---

## Backend Enforcement (Mutations)

Every mutation that consumes a gated resource calls `useQuota`. The current enforcement points:

| Mutation | File | Feature ID | Amount |
|---|---|---|---|
| `sendMessage` | `convex/features/chat/messages.ts` | `CHAT_MESSAGES` | 1 |
| `approveCard` | `convex/features/chat/cardApprovals.ts` | `CUSTOM_SENTENCES` | 1 |
| `createCourse` | `convex/features/courses.ts` | `COURSES` | 1 |
| `duplicateCourse` | `convex/features/courses.ts` | `COURSES` | 1 |
| `addToUserDeck` | `convex/features/decks.ts` | `SENTENCES` | batch size |

The pattern is always:

```typescript
const userId = await requireAuthUserId(ctx);
await useQuota(ctx, userId, FEATURE_IDS.SOME_FEATURE, amount);
// ... proceed with the actual logic
```

If `useQuota` throws, the mutation aborts and the client receives the `ConvexError`.

**Boolean features** (like `MULTIPLE_LANGUAGES`) are NOT enforced via `useQuota`. Instead, the frontend uses `useFeatureQuota` to read the boolean state and conditionally limits the UI (e.g., max 2 languages vs. max 5).

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
- Once loaded, displays a title/message from `getPaywallContent()` (in `lib/autumn/paywall-content.tsx`).
- Footer has two buttons:
  - **"Not now"** – dismisses the dialog.
  - **"Upgrade to {plan}"** – calls `useCustomer().checkout({ productId, dialog: CheckoutDialog })` to initiate the Autumn checkout flow in a dialog.
- If `preview` is undefined after loading, shows a generic "Feature Unavailable" message.

### `LowQuotaDialog` (`components/autumn/low-quota-dialog.tsx`)

Shown when quota is low but not zero (1–3 remaining). Does NOT use `usePaywall` (which only works for actually-limited features). Instead uses `usePricingTable()` to find the next upgrade product.

- Identifies the upgrade product via `products.find(p => p.scenario === "upgrade" || (p.scenario === "new" && !p.properties?.is_free))`.
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
import { useQuota } from '../usage/helpers';
import { FEATURE_IDS } from '../features/featureIds';

// Inside the handler:
const userId = await requireAuthUserId(ctx);
await useQuota(ctx, userId, FEATURE_IDS.MY_NEW_FEATURE, 1);
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
If a user's `usageQuotas` doc doesn't exist yet (e.g., first visit before `syncQuotas` completes), `useFeatureQuota` returns `isAvailable: false` and `useQuota` throws `QUOTA_NOT_SYNCED`. The app calls `syncQuotas` on load in `app/app/(main)/layout.tsx` to handle this.

### Boolean vs metered features
Boolean features (like `multiple_languages`) have `balance: 1` when enabled and `balance: 0` when disabled. They are **not** decremented via `useQuota`. They are read-only on the frontend via `useFeatureQuota(...).isAvailable`. Don't call `useQuota` for boolean features — it would decrement the balance to 0 and effectively disable the feature.

### The `identify` function
Autumn identifies users by `user.subject` from the Convex auth identity. This must match the customer ID used in Autumn's dashboard. If auth changes, the mapping may break.

### Re-sync after checkout
After a user completes checkout via `CheckoutDialog`, Autumn updates their entitlements server-side. The local `usageQuotas` cache won't reflect this until the next `syncQuotas` call. Consider triggering a sync after checkout completes if immediate UI update is needed.

---

## File Reference

| File | Role |
|---|---|
| `convex/features/featureIds.ts` | Feature ID constants |
| `convex/usage/helpers.ts` | `checkQuota`, `useQuota`, `decrementQuota`, `syncAllFeatures` |
| `convex/usage/tracking.ts` | Autumn API calls: `trackUsage`, `fetchCustomerFeatures`, `syncQuotasForUser` |
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
