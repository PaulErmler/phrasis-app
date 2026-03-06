# Usage Tracking

## Overview

Usage tracking enforces plan limits on metered features (chat messages, courses, sentences, custom sentences). Autumn is the source of truth for billing and entitlements. Because Convex mutations and queries cannot make HTTP calls, we maintain a local cache of quota state in the `usageQuotas` table so mutations can check limits synchronously. Tracking is sent to Autumn asynchronously via scheduled actions.

## Architecture

```
Mutation                      Convex DB                 Autumn API
  │                              │                          │
  ├── read usageQuotas ─────────>│                          │
  │<── features.chat_messages ───│                          │
  │                              │                          │
  │  (balance >= amount?)        │                          │
  │  YES: patch feature entry ──>│                          │
  │       scheduler.runAfter ────┼──── trackUsage ─────────>│
  │                              │<── POST /v1/track        │
  │                              │<── GET /v1/customers/{id}│
  │                              │<── syncAllFeatures       │
  │  NO: throw USAGE_LIMIT      │                          │
```

### Key constraints

- **Queries and mutations** cannot make HTTP calls. All Autumn API communication happens in actions.
- **Scheduled actions** lose auth context, so `trackUsage` takes `userId` explicitly and calls the Autumn REST API directly with `AUTUMN_SECRET_KEY` (bypassing the SDK's `identify` flow).
- **Sync strategy**: Always overwrite local values with Autumn's response. No min-based reconciliation. The brief window between a local decrement and the Autumn sync (~200ms) is accepted.

## Autumn Features & Plans

Defined in `autumn.config.ts`. Features with their plan limits:

| Feature | Type | Free | Basic ($8/mo) | Pro ($19/mo) | Reset |
|---|---|---|---|---|---|
| `chat_messages` | metered, consumable | 5 | 40 | 100 | monthly |
| `courses` | metered, non-consumable | 1 | 2 | 5 | never |
| `sentences` | metered, consumable | 150 | 300 | 1000 | monthly |
| `custom_sentences` | metered, consumable | 10 | 50 | 200 | monthly |
| `reviews` | metered, consumable | - | - | - | not tracked |
| `multiple_languages` | boolean | no | no | no | - |

### What is NOT tracked

- **Reviews** (`reviewCard`): Not tracked. Unlimited across all plans.
- **Cards from custom collections**: Always allowed. Custom content is gated at creation time (e.g. `approveCard` tracks `custom_sentences`). Adding those cards to a deck via `addCardsFromCollection` does not consume `sentences` quota.

## Schema

`usageQuotas` table in `convex/schema.ts`. **One document per user** containing all features as a record:

```typescript
usageQuotas: defineTable({
  userId: v.string(),
  features: v.record(
    v.string(),
    v.object({
      balance: v.number(),
      included: v.number(),
      used: v.number(),
      interval: v.optional(v.string()),
      unlimited: v.optional(v.boolean()),
    }),
  ),
  lastSyncedAt: v.number(),
}).index('by_userId', ['userId']),
```

The `features` record is keyed by feature ID (e.g. `"chat_messages"`, `"courses"`) and mirrors what Autumn returns from `GET /customers/{id}`. There is no hardcoded list of tracked features — whatever Autumn returns is stored.

## Files

| File | Purpose |
|---|---|
| `convex/usage/helpers.ts` | Mutation-safe helpers (no HTTP). Check, decrement, and sync feature entries. |
| `convex/usage/tracking.ts` | Internal actions and shared Autumn API utilities. Track usage, sync entitlements. |
| `convex/usage/actions.ts` | Public actions callable from the client. Sync quotas, fetch live entitlements. |
| `convex/usage/queries.ts` | Reactive query to read the local quota document for the UI. |
| `convex/usage/testOperations.ts` | Test mutations/actions for the prototype page. |
| `app/tracking-prototype/page.tsx` | Prototype UI to exercise and visualize the tracking system. |

## `convex/usage/helpers.ts`

Mutation-safe functions that read/write the `usageQuotas` table. No HTTP calls.

### Types

```typescript
type FeatureState = {
  balance: number;
  included: number;
  used: number;
  interval?: string;
  unlimited?: boolean;
};
```

### Exported helpers (plain async functions)

**`checkQuota(ctx, userId, featureId, amount?)`**

Reads the user's quota document and looks up the feature entry. Returns `{ allowed: boolean, balance: number, synced: boolean }`. Does not modify anything. If no document exists (`synced: false`), returns `allowed: false`. Respects the `unlimited` flag.

**`decrementQuota(ctx, userId, featureId, amount?)`**

Patches the feature entry within the document: `balance -= amount`, `used += amount`. Throws if no document or feature entry exists.

**`useQuota(ctx, userId, featureId, amount?)`**

Combined check + decrement + auto-schedules `trackUsage`. This is the primary API for mutations. Returns `{ balance: number }`.

Throws structured `ConvexError` with:
- `code: 'QUOTA_NOT_SYNCED'` if no local document exists
- `code: 'USAGE_LIMIT'` if balance is insufficient (includes `balance` in error data)

### Registered Convex functions

**`syncAllFeatures`** (internalMutation)

Overwrites the entire `features` record with values from Autumn's `GET /customers` response. Called during full sync. Creates the document if it doesn't exist.

**`resetQuotas`** (internalMutation)

Deletes the quota document for a user. Testing only.

## `convex/usage/tracking.ts`

Internal actions and shared Autumn API utilities. Requires `"use node"` for `fetch`. Not callable from clients directly.

### Autumn REST API endpoints used

- `POST https://api.useautumn.com/v1/track` — record a usage event
- `GET https://api.useautumn.com/v1/customers/{customer_id}` — get all features in a single request (used after track, for full sync, and for live entitlements)

All require `Authorization: Bearer <AUTUMN_SECRET_KEY>`.

### Registered functions

**`trackUsage`** (internalAction)

Args: `{ userId, featureId, value }`. Called from mutations via `scheduler.runAfter(0, ...)`.

1. `POST /v1/track` with `{ customer_id, feature_id, value }`
2. `GET /v1/customers/{customer_id}` to fetch updated state for all features
3. Calls `syncAllFeatures` to overwrite the entire local features record

If either API call fails, logs the error and returns without syncing.

**`syncQuotasInternal`** (internalAction)

Args: `{ userId }`. Full sync of all features for a given user. For use in scheduled jobs or internal flows where auth context is unavailable.

### Shared utilities (exported for use in `actions.ts`)

- **`fetchCustomerFeatures(secretKey, userId)`** — `GET /customers/{id}`, returns raw Autumn feature entries or `null` on error
- **`toFeaturesRecord(autumnFeatures)`** — converts Autumn's response format to the local `Record<string, FeatureState>`
- **`syncQuotasForUser(ctx, userId)`** — fetches all features and calls `syncAllFeatures`

## `convex/usage/actions.ts`

Public actions callable from the client. Requires `"use node"`. Imports shared utilities from `tracking.ts`.

**`syncQuotas`** (public action)

No args (identifies user from auth context). Calls `syncQuotasForUser` to fetch all features from Autumn and overwrite the entire local document.

**`getAutumnEntitlements`** (public action)

No args (identifies user from auth context). Makes a single `GET /customers/{customer_id}` call and returns the features as a `Record<string, FeatureState>` without writing to DB. Used by the prototype UI for side-by-side comparison.

## `convex/usage/queries.ts`

**`getMyQuotas`** (public query)

Returns `{ features: Record<string, FeatureState>, lastSyncedAt: number } | null` for the authenticated user. Reactive — updates in real time as sync mutations write back. Returns `null` if not authenticated or no quotas synced yet.

## Feature-to-Mutation Mapping

Which mutations should call `useQuota` when integrated into production code:

| Feature | Mutation(s) | Amount | Notes |
|---|---|---|---|
| `chat_messages` | `sendMessage` | 1 | Decrement before scheduling AI response |
| `courses` | `createCourse`, `completeOnboarding` | 1 | Balance represents remaining course slots |
| `sentences` | `addCardsFromCollection` | batch size | Only for non-custom collections |
| `custom_sentences` | `approveCard` | 1 | Gated at card creation time |

### Integration pattern for production mutations

```typescript
import { useQuota } from '../usage/helpers';

export const sendMessage = mutation({
  args: { /* ... */ },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    // Check and decrement quota (also schedules trackUsage)
    await useQuota(ctx, user._id, 'chat_messages', 1);

    // ... existing sendMessage logic ...
  },
});
```

For `addCardsFromCollection`, skip quota check if the source is a custom collection:

```typescript
const collection = await ctx.db.get(collectionId);
const isCustom = collection?.name?.startsWith('Chat:') || /* other custom check */;

if (!isCustom) {
  await useQuota(ctx, user._id, 'sentences', batchSize);
}
```

## `convex/usage/testOperations.ts`

Test mutations that exercise the quota system without full business logic:

| Function | Type | Feature | Notes |
|---|---|---|---|
| `simulateChatMessage` | mutation | `chat_messages` | Uses 1 |
| `simulateSentence` | mutation | `sentences` | Optional `count` arg |
| `simulateCustomSentence` | mutation | `custom_sentences` | Uses 1 |
| `simulateCourse` | mutation | `courses` | Uses 1 |
| `checkFeatureQuota` | mutation | any | Check without consuming |
| `resetMyQuotas` | action | all | Deletes local document |

All simulate mutations return `{ allowed: boolean, balance: number }` — they catch `USAGE_LIMIT` and `QUOTA_NOT_SYNCED` errors and return `allowed: false` instead of throwing.

## Frontend Feature Gating

Autumn provides a React hook (`useCustomer`) and a `PaywallDialog` component for client-side availability checks and upgrade flows. These complement the server-side quota system — Autumn's data is the source for UI badges and pre-click blocking, while the Convex mutations are the authoritative enforcement point.

**Auth timing**: `useCustomer()` calls Autumn's `identify()` on mount and needs the Convex auth token to be ready. `authClient.useSession()` resolves before the Convex client has exchanged the Better Auth token for a Convex auth token, so gating on session alone is insufficient — on a cold page load `useCustomer()` would fire before the token is available and `customer` would stay `null`.

Always wait for **both** the Better Auth session and Convex auth before mounting the component containing `useCustomer()`:

```tsx
import { useConvexAuth } from 'convex/react';
import { authClient } from '@/lib/auth-client';

export default function MyPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();

  if (sessionPending || convexAuthLoading) return <Spinner />;
  if (!session || !isAuthenticated) return null; // or sign-in prompt

  return <AuthenticatedContent />;   // useCustomer() lives here
}
```

### `useCustomer` hook

```tsx
import { useCustomer } from 'autumn-js/react';

const { customer, isLoading } = useCustomer();
```

`customer.features` is a record keyed by feature ID (e.g. `"chat_messages"`) with the same shape returned by Autumn's `GET /customers` endpoint. Each entry has:

```typescript
{
  balance?: number | null;   // remaining units
  unlimited?: boolean;       // true on unlimited plans
  usage?: number;            // units consumed this period
  included_usage?: number;   // included units on current plan
  interval?: string;         // reset interval, e.g. "month"
}
```

Data is fetched via SWR (cached, reactive). On first page load the data may be briefly `null` while the request completes; design UI to handle this gracefully (no badge shown until loaded).

### Deriving availability

```typescript
const feature = customer?.features['chat_messages'];
const isAvailable = feature
  ? (feature.unlimited === true || (feature.balance ?? 0) > 0)
  : true; // default to available while loading — server enforces the real limit
```

Default to `true` while `customer` is `null` so no false "locked" state appears during load. The Convex mutation is always the authoritative check; this is UI-only.

### Showing availability badges

```tsx
const feature = customer?.features[featureId];

{feature && (
  feature.unlimited ? (
    <Badge variant="secondary">Unlimited</Badge>
  ) : (feature.balance ?? 0) > 0 ? (
    <Badge className="text-green-600">{feature.balance} left</Badge>
  ) : (
    <Badge variant="destructive">Limit reached</Badge>
  )
)}
```

Only render the badge once `customer` is loaded (`feature` is not undefined) to avoid a flash of "0 left" before data arrives.

### Opening the paywall

`PaywallDialog` from `autumn-js/react` shows the user their upgrade options for a specific feature. It is a controlled component:

```tsx
import { PaywallDialog } from 'autumn-js/react';

const [paywallFeatureId, setPaywallFeatureId] = useState<string | null>(null);

// Trigger it:
setPaywallFeatureId('chat_messages');

// Render at the bottom of the page:
<PaywallDialog
  open={paywallFeatureId !== null}
  setOpen={(open) => { if (!open) setPaywallFeatureId(null); }}
  featureId={paywallFeatureId ?? ''}
/>
```

### Two trigger points

**1. Pre-click (Autumn shows 0 balance):** Skip the mutation entirely and open the paywall immediately.

```tsx
const handleAction = () => {
  const feature = customer?.features['chat_messages'];
  const isAvailable = feature?.unlimited || (feature?.balance ?? 1) > 0;

  if (!isAvailable) {
    setPaywallFeatureId('chat_messages');
    return;
  }

  // proceed with mutation
};
```

**2. Post-mutation (server returns USAGE_LIMIT):** Catch the error code and open the paywall reactively.

```tsx
try {
  await sendMessage(args);
} catch (e) {
  if (e instanceof ConvexError && e.data?.code === 'USAGE_LIMIT') {
    setPaywallFeatureId('chat_messages');
  }
}
```

Both patterns are implemented in `app/tracking-prototype/page.tsx` and can be used as a reference.

### Integration checklist for a feature-gated action

1. Gate the page/component on `authClient.useSession()` before using `useCustomer()`.
2. Call `useCustomer()` to get `customer`.
3. Derive `isAvailable` from `customer.features[featureId]`.
4. Render an availability badge in the UI.
5. On action trigger: if `!isAvailable`, open `PaywallDialog` instead of calling the mutation.
6. On mutation error with `code === 'USAGE_LIMIT'`: open `PaywallDialog`.
7. Place `<PaywallDialog>` once at the page level, controlled by a single `paywallFeatureId` state value.

## Prototype UI

`app/tracking-prototype/page.tsx` — accessible at `/tracking-prototype`.

### Controls

- **Sync from Autumn**: Calls `syncQuotas` action. Fetches the customer object (single API call) and writes all features to one local document.
- **Fetch Autumn Live**: Calls `getAutumnEntitlements` action. Shows live Autumn state alongside local state for comparison.
- **Reset Local**: Calls `resetMyQuotas` action. Deletes the local quota document.

### Per-feature cards

The UI renders a card for every feature found in the union of local data, Autumn data, and the known features in `FEATURE_META`. This means new features added in Autumn automatically appear without code changes.

Each card shows:
- **Availability badge**: Live balance from `useCustomer()` — "X left" (green), "Limit reached" (red), or "Unlimited". Visible immediately on page load without any button click.
- **Local (Convex)**: Balance, Used, Included. Shows "Not synced yet" if no entry exists.
- **Autumn (Live)**: Balance, Used, Included, unlimited/interval badges. Only visible after "Fetch Autumn Live".
- **Diff indicator**: "In sync" (green) or drift amounts (amber) when both local and Autumn data are present.
- **Simulate / Upgrade button**: "Use 1 {label}" when available; "Upgrade to use {label}" (with lock icon) when balance is 0, which opens the paywall directly without running the mutation.

### Testing workflow

1. Navigate to `/tracking-prototype`
2. Click **Sync from Autumn** to populate local quotas — availability badges appear immediately from `useCustomer()`
3. Use **Simulate** buttons to consume units — observe local balance decrementing immediately
4. When a limit is reached, the **PaywallDialog** opens automatically
5. Click **Fetch Autumn Live** to compare — after ~200ms the Autumn state should match
6. Click **Reset Local** to clear and re-test the initial sync flow

## Sync timing

| Trigger | What happens |
|---|---|
| User lands on prototype page | `getMyQuotas` query runs reactively; `useCustomer()` fetches live Autumn state via SWR |
| "Sync from Autumn" clicked | Single `GET /customers` call, entire features record overwritten |
| Simulate button clicked | Feature entry decremented instantly; `trackUsage` action scheduled |
| `trackUsage` completes (~200ms) | Track event sent to Autumn, all features synced back via `syncAllFeatures` |
| Subscription change / plan upgrade | Should trigger `syncQuotas` (not yet wired — see TODO) |

## Environment variables

- `AUTUMN_SECRET_KEY` — required. Set in `.env.local` and Convex environment variables. Used by `tracking.ts` and `actions.ts` to authenticate with the Autumn REST API.

## TODO for production integration

1. **Wire `useQuota` into real mutations** — `sendMessage`, `createCourse`, `completeOnboarding`, `approveCard`, `addCardsFromCollection` (non-custom only).
2. **Trigger sync on app load** — call `syncQuotas` when the user authenticates or opens the app.
3. **Handle subscription changes** — Autumn webhooks or post-checkout sync to refresh local quotas immediately after plan changes.
4. **Periodic cron sync** — safety net for drift. Run `syncQuotasInternal` every 15-30 minutes for active users.
5. **Frontend paywall integration** — pattern documented above; apply to `sendMessage`, `createCourse`, `approveCard` UI entry points.
6. **Boolean features** — `multiple_languages` is not yet tracked. Needs a different pattern (check only, no decrement).
