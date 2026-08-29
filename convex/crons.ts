import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Reconcile ACTUAL payment amounts (gross / tax / Stripe fee / net) from
// Stripe into `payment_recorded` PostHog events. Overlapping 35-day
// lookback + the paymentEvents dedup ledger make the daily cadence
// idempotent; no-ops while STRIPE_SECRET_KEY is unset. See
// convex/features/paymentSync.ts.
crons.cron(
  'sync stripe payments',
  '47 4 * * *',
  internal.features.paymentSync.syncStripePayments,
  {},
);

// Latest Convex invoice total -> `infra_cost_recorded` PostHog event, so the
// margin/P&L tiles read the real infra bill instead of a pasted constant.
// No-ops while CONVEX_BILLING_TOKEN is unset. See
// convex/features/infraCostSync.ts.
crons.cron(
  'sync convex infra cost',
  '9 5 * * *',
  internal.features.infraCostSync.syncConvexCost,
  {},
);

export default crons;
