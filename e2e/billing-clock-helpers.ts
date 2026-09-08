import { expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { gotoAuthedApp } from './helpers';
import {
  getCheckoutSession,
  listSubscriptions,
  sessionIdFromUrl,
  stripeTestKey,
} from './stripe-clock';

/**
 * Shared scaffolding for the clocked billing journeys. Both
 * `billing-clock.spec.ts` (trials on) and `billing-clock-no-trial.spec.ts`
 * (trials off) drive the same surfaces, so these live here rather than being
 * copied into each file. Kept out of `helpers.ts` on purpose: that module is
 * already imported by every spec in the suite (see C35 in docs/tech-debt.md)
 * and none of this is useful outside billing.
 */

const REPO_ROOT = path.resolve(__dirname, '..');

export const BASIC_ANNUAL = 'basic_annual';
export const PRO_ANNUAL = 'pro_annual';
export const FREE = 'free';

export const STRIPE_KEY = stripeTestKey();

/** Run a usage/testing:* Convex hook on the dev deployment. */
export function convexTestHook(
  fn: string,
  args: Record<string, unknown>,
): unknown {
  const out = execFileSync(
    'pnpm',
    ['exec', 'convex', 'run', `usage/testing:${fn}`, JSON.stringify(args)],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  // `convex run` prints the function's return value (JSON) on stdout,
  // possibly surrounded by CLI noise. Parse the last JSON-looking chunk.
  const lines = out.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    try {
      return JSON.parse(lines.slice(i).join('\n'));
    } catch {
      /* keep scanning upwards */
    }
  }
  return undefined;
}

export type AutumnPlanRow = { id: string; status: string; pastDue: boolean };

/**
 * Poll AUTUMN's view of the customer until it satisfies `predicate`. Stripe
 * settles clock advances quickly, but Autumn ingests the resulting webhook
 * backlog asynchronously. A 1-year advance can take it minutes. Polling
 * Autumn directly (instead of only the UI) makes a timeout name the actual
 * laggard: the error shows what Autumn still reports.
 */
export async function waitForAutumnPlans(
  email: string,
  predicate: (plans: AutumnPlanRow[]) => boolean,
  { timeoutMs = 360_000, label = 'Autumn plan state' } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let plans: AutumnPlanRow[] | undefined;
  for (;;) {
    // A transient hook failure (Autumn API hiccup, live run 2026-08-10 died
    // on one http2 keep-alive timeout) is just a missed poll, not a verdict.
    try {
      plans = convexTestHook('getBillingDebugState', {
        email,
      }) as AutumnPlanRow[];
      if (Array.isArray(plans) && predicate(plans)) return;
    } catch (e) {
      console.warn(`getBillingDebugState poll failed, retrying: ${e}`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${label}; Autumn reports: ${JSON.stringify(plans)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

/** Whether the dev deployment currently has Managed Payments on. */
export function managedPaymentsEnabled(): boolean {
  try {
    const out = execFileSync(
      'pnpm',
      ['exec', 'convex', 'env', 'get', 'AUTUMN_MANAGED_PAYMENTS'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    return out.trim() === 'true';
  } catch {
    return false; // unset
  }
}

export function planCta(page: Page, productId: string) {
  return page.getByTestId(`pricing-card-cta-${productId}`);
}

export async function openPricingTable(page: Page) {
  await gotoAuthedApp(page, '/app/settings', planCta(page, BASIC_ANNUAL));
}

/**
 * Reload settings until a plan CTA shows the expected label. Autumn state
 * propagates via its Stripe webhooks, so generous polling is the point.
 */
export async function expectPlanState(
  page: Page,
  productId: string,
  label: RegExp,
  timeout = 180_000,
) {
  await expect(async () => {
    await openPricingTable(page);
    await expect(planCta(page, productId)).toHaveText(label, {
      timeout: 5_000,
    });
  }).toPass({ timeout, intervals: [3_000, 6_000] });
}

/**
 * Click a plan CTA, assert the redirect to Stripe's hosted page, and assert
 * that at that moment NOTHING new exists in Stripe. The click must never
 * charge or subscribe by itself. Returns the Checkout Session for further
 * assertions. (When Managed Payments is on, the session must carry
 * `managed_payments.enabled`, the merchant-of-record marker.)
 */
export async function startFirstPurchase(
  page: Page,
  getCustomerId: () => Promise<string>,
  productId: string,
  { activeSubsBefore = 0 }: { activeSubsBefore?: number } = {},
) {
  await planCta(page, productId).click();
  // "commit", not the default "load": reaching the URL is all that matters
  // here, and Stripe's checkout page can hold the load event open past 45s
  // on a slow connection (live flake, 2026-08-10), everything that follows
  // does its own waiting.
  await page.waitForURL(/checkout\.stripe\.com/, {
    timeout: 45_000,
    waitUntil: 'commit',
  });

  // Resolved after the redirect. For unclocked journeys the Stripe customer
  // was created by Autumn at SIGNUP (not by the session, verified live
  // 2026-08-10), so it is looked up by email; findCustomerByEmail uses the
  // read-your-writes list filter, never the lagging search index.
  const customerId = await getCustomerId();
  const nonCancelled = (
    await listSubscriptions(STRIPE_KEY!, customerId)
  ).filter((s) => s.status !== 'canceled');
  expect(
    nonCancelled,
    'the CTA click alone must not create or charge a subscription',
  ).toHaveLength(activeSubsBefore);

  const sessionId = sessionIdFromUrl(page.url());
  expect(sessionId, `session id parsed from ${page.url()}`).toBeTruthy();
  const session = await getCheckoutSession(STRIPE_KEY!, sessionId!);
  if (managedPaymentsEnabled()) {
    expect(
      session.managed_payments?.enabled,
      'MoR flag is on but the session is not a Managed Payments session',
    ).toBe(true);
  }
  return session;
}
