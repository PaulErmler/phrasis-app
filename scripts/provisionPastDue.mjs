#!/usr/bin/env node
/**
 * Provision a GENUINE `past_due` customer using a Stripe test clock.
 *
 * Why this is not trivial: a real past_due only comes from a failed
 * *renewal*. Attaching with a bad card does not produce one (the charge
 * fails up front, leaving an incomplete subscription and a voided invoice),
 * and attaching a plan with a free trial does not either — Autumn records a
 * trial as its own $0 invoice and does not create a Stripe subscription at
 * all, so there is nothing for a test clock to advance.
 *
 * The recipe that does work, and the one below:
 *
 *   1. Stripe: test clock at now; customer created ON the clock.
 *   2. Stripe: a WORKING card as the default payment method.
 *   3. Autumn: bind that stripe_id to the app user (POST /customers/:id).
 *   4. Autumn: attach the plan with `free_trial: false` — the first payment
 *      succeeds, producing a real Stripe subscription on the clock.
 *   5. Stripe: swap the default + subscription payment method to the
 *      always-declines card.
 *   6. Stripe: advance the clock past the renewal date.
 *   7. The renewal charge declines → subscription `past_due` with a real
 *      OPEN invoice the user can actually pay.
 *
 * This matches production semantics: the card succeeds at sign-up and only
 * fails on renewal.
 *
 * STRIPE_SECRET_KEY is read from .env.local by this process and is never
 * printed. The script refuses to run against a live-mode key.
 *
 * Usage:
 *   node scripts/provisionPastDue.mjs --user <convexUserId> [--plan basic]
 *   node scripts/provisionPastDue.mjs --status <convexUserId>
 *   node scripts/provisionPastDue.mjs --cleanup <testClockId>
 */

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(ROOT, '.env.local'), quiet: true });
config({ path: path.join(ROOT, '.env'), quiet: true });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const AUTUMN_KEY = process.env.AUTUMN_SECRET_KEY;

if (!STRIPE_KEY) {
  console.error('STRIPE_SECRET_KEY not found in .env.local / .env');
  process.exit(1);
}
// Hard refusal on live keys: this deliberately fails a real payment.
if (!STRIPE_KEY.startsWith('sk_test_') && !STRIPE_KEY.startsWith('rk_test_')) {
  console.error(
    'Refusing to run: STRIPE_SECRET_KEY is not a test-mode key (expected sk_test_/rk_test_).',
  );
  process.exit(1);
}
if (!AUTUMN_KEY) {
  console.error('AUTUMN_SECRET_KEY not found in .env.local / .env');
  process.exit(1);
}

const STRIPE_API = 'https://api.stripe.com/v1';
const AUTUMN_API = 'https://api.useautumn.com/v1';

/** Succeeds normally — used for the initial, genuine payment. */
const PM_OK = 'pm_card_visa';
/** Attaches fine but declines every charge — used for the renewal. */
const PM_DECLINES = 'pm_card_chargeCustomerFail';

/** Stripe wants form encoding, including bracket nesting. */
function toForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) toForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(method, endpoint, body) {
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    ...(body ? { body: toForm(body).toString() } : {}),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Stripe ${method} ${endpoint} failed (${res.status}): ${json?.error?.message ?? JSON.stringify(json)}`,
    );
  }
  return json;
}

async function autumn(method, endpoint, body, apiVersion) {
  const res = await fetch(`${AUTUMN_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${AUTUMN_KEY}`,
      'Content-Type': 'application/json',
      ...(apiVersion ? { 'x-api-version': apiVersion } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(
      `Autumn ${method} ${endpoint} failed (${res.status}): ${json?.message ?? text}`,
    );
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(
  label,
  check,
  { timeoutMs = 180_000, everyMs = 5_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await check();
    if (v) return v;
    await sleep(everyMs);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function describe(userId) {
  const c = await autumn(
    'GET',
    `/customers/${encodeURIComponent(userId)}?expand=invoices`,
    undefined,
    '1.2',
  );
  return {
    stripe_id: c.stripe_id,
    products: (c.products ?? []).map((p) => ({
      id: p.id,
      status: p.status,
      past_due: p.past_due === true,
    })),
    invoices: (c.invoices ?? []).map((i) => ({
      status: i.status,
      total: i.total,
      url: i.hosted_invoice_url,
    })),
  };
}

/** Set once the test clock exists, so the failure handler can name it. */
let createdClockId = null;

async function main() {
  const args = process.argv.slice(2);
  const arg = (n) => {
    const i = args.indexOf(`--${n}`);
    if (i < 0) return undefined;
    const value = args[i + 1];
    // A valueless flag must fail loudly: `--status` with no id used to fall
    // through to the DESTRUCTIVE provisioning branch below.
    if (value === undefined || value.startsWith('--')) {
      console.error(`--${n} requires a value`);
      process.exit(1);
    }
    return value;
  };

  const statusUser = arg('status');
  if (statusUser) {
    console.log(JSON.stringify(await describe(statusUser), null, 2));
    return;
  }

  // Recovery path for a mid-flow failure: deleting the test clock cascades
  // to its Stripe customer and subscription. (An already-completed Autumn
  // /attach may additionally need a manual POST /cancel for the user.)
  const cleanupClock = arg('cleanup');
  if (cleanupClock) {
    await stripe('DELETE', `/test_helpers/test_clocks/${cleanupClock}`);
    console.log(
      `Deleted test clock ${cleanupClock} (its customer and subscription cascade).`,
    );
    return;
  }

  const userId = arg('user');
  // Monthly by default so one renewal is only ~a month of clock travel.
  const planId = arg('plan') ?? 'basic';
  if (!userId) {
    console.error(
      'Usage: --user <convexUserId> [--plan basic] | --status <convexUserId> | --cleanup <testClockId>',
    );
    process.exit(1);
  }

  const before = await describe(userId);
  if (before.products.some((p) => p.id !== 'free')) {
    throw new Error(
      `User already holds ${before.products.map((p) => p.id).join(', ')}. ` +
        `Use a fresh account — rebinding a Stripe customer under an existing ` +
        `subscription leaves an inconsistent state.`,
    );
  }

  console.log(`\n▸ Genuine past_due for ${userId} on plan ${planId}\n`);

  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe('POST', '/test_helpers/test_clocks', {
    frozen_time: now,
    name: `past-due ${userId}`,
  });
  createdClockId = clock.id;
  console.log(`  1. test clock ......... ${clock.id}`);

  const customer = await stripe('POST', '/customers', {
    test_clock: clock.id,
    description: `past_due fixture for ${userId}`,
  });
  // Attaching a shared test token clones it into a customer-scoped
  // PaymentMethod; the default must reference that new id, not the token.
  const okCard = await stripe('POST', `/payment_methods/${PM_OK}/attach`, {
    customer: customer.id,
  });
  await stripe('POST', `/customers/${customer.id}`, {
    invoice_settings: { default_payment_method: okCard.id },
  });
  console.log(`  2. stripe customer .... ${customer.id} (working card)`);

  // POST /customers is get-or-create and ignores extra fields on an
  // existing customer; the app's mount sync has already created one, so the
  // update endpoint is what actually binds stripe_id.
  await autumn('POST', `/customers/${encodeURIComponent(userId)}`, {
    stripe_id: customer.id,
  });
  const bound = await describe(userId);
  if (bound.stripe_id !== customer.id) {
    throw new Error(
      `Autumn did not adopt ${customer.id} (got ${bound.stripe_id ?? 'none'})`,
    );
  }
  console.log(`  3. bound to autumn .... ok`);

  // No trial: the first payment must really happen, otherwise Autumn keeps
  // the trial internal and Stripe never gets a subscription to renew.
  await autumn('POST', '/attach', {
    customer_id: userId,
    product_id: planId,
    free_trial: false,
  });
  const sub = await until('the Stripe subscription', async () => {
    const s = await stripe(
      'GET',
      `/subscriptions?customer=${customer.id}&status=all`,
    );
    return s.data?.[0] ?? null;
  });
  console.log(
    `  4. subscribed ......... ${sub.id} (${sub.status}, paid with the good card)`,
  );

  const badCard = await stripe(
    'POST',
    `/payment_methods/${PM_DECLINES}/attach`,
    {
      customer: customer.id,
    },
  );
  await stripe('POST', `/customers/${customer.id}`, {
    invoice_settings: { default_payment_method: badCard.id },
  });
  await stripe('POST', `/subscriptions/${sub.id}`, {
    default_payment_method: badCard.id,
  });
  console.log(`  5. card swapped ....... declines on next charge`);

  // Advance to just past the renewal — NOT far past it. A large jump runs
  // Stripe's whole dunning schedule (retry, retry, then the configured
  // end-of-dunning action) inside the single step, so you land on the final
  // state, cancelled, and never observe past_due at all. One hour past the
  // renewal fails exactly one charge and leaves retries pending.
  //
  // `current_period_end` moved off the subscription onto its items in
  // recent Stripe API versions; read whichever is present.
  const periodEnd =
    sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  if (!periodEnd) {
    throw new Error('Could not determine the subscription period end');
  }
  await stripe('POST', `/test_helpers/test_clocks/${clock.id}/advance`, {
    frozen_time: periodEnd + 3600,
  });
  await until(
    'the clock to settle',
    async () => {
      const c = await stripe('GET', `/test_helpers/test_clocks/${clock.id}`);
      return c.status === 'ready' ? c : null;
    },
    { timeoutMs: 300_000 },
  );
  console.log(
    `  6. clock advanced ..... to renewal +1h (retries still pending)`,
  );

  const final = await until(
    'the subscription to go past_due',
    async () => {
      const s = await describe(userId);
      return s.products.some((p) => p.past_due || p.status === 'past_due')
        ? s
        : null;
    },
    { timeoutMs: 300_000 },
  );
  console.log(`  7. past_due ........... yes\n`);
  console.log(JSON.stringify(final, null, 2));
  console.log(
    `\n✔ Real failed renewal, real open invoice. Load /app as this user to sync it in.\n` +
      `  Status: node scripts/provisionPastDue.mjs --status ${userId}\n`,
  );
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}\n`);
  if (createdClockId) {
    console.error(
      `A test clock was created before the failure: ${createdClockId}\n` +
        `The target user may now hold a partially-provisioned plan, and re-runs\n` +
        `for that user will refuse it. Clean up with:\n` +
        `  node scripts/provisionPastDue.mjs --cleanup ${createdClockId}\n` +
        `(cascades to the Stripe customer + subscription; if the Autumn /attach\n` +
        `already succeeded, additionally cancel the plan for that user in Autumn).\n`,
    );
  }
  process.exit(1);
});
