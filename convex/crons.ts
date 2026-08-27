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

export default crons;
