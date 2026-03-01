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

## Prototype UI

`app/tracking-prototype/page.tsx` — accessible at `/tracking-prototype`.

### Controls

- **Sync from Autumn**: Calls `syncQuotas` action. Fetches the customer object (single API call) and writes all features to one local document.
- **Fetch Autumn Live**: Calls `getAutumnEntitlements` action. Shows live Autumn state alongside local state for comparison.
- **Reset Local**: Calls `resetMyQuotas` action. Deletes the local quota document.

### Per-feature cards

The UI renders a card for every feature found in the union of local data, Autumn data, and the known features in `FEATURE_META`. This means new features added in Autumn automatically appear without code changes.

Each card shows:
- **Local (Convex)**: Balance, Used, Included. Shows "Not synced yet" if no entry exists.
- **Autumn (Live)**: Balance, Used, Included, unlimited/interval badges. Only visible after "Fetch Autumn Live".
- **Diff indicator**: "In sync" (green) or drift amounts (amber) when both local and Autumn data are present.
- **Simulate button**: Only shown for features with known test operations (chat_messages, courses, sentences, custom_sentences).

### Testing workflow

1. Navigate to `/tracking-prototype`
2. Click **Sync from Autumn** to populate local quotas
3. Use **Simulate** buttons to consume units — observe local balance decrementing immediately
4. Click **Fetch Autumn Live** to compare — after ~200ms the Autumn state should match
5. Click **Reset Local** to clear and re-test the initial sync flow

## Sync timing

| Trigger | What happens |
|---|---|
| User lands on prototype page | `getMyQuotas` query runs reactively; shows existing local state |
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
5. **Frontend paywall integration** — use `USAGE_LIMIT` error code to show `PaywallDialog` in the UI.
6. **Boolean features** — `multiple_languages` is not yet tracked. Needs a different pattern (check only, no decrement).
