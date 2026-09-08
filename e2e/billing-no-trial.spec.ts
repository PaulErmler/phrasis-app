import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  completeStripeTestCheckout,
  gotoAuthedApp,
  neutralizeTours,
  signUpFreshUser,
} from './helpers';
import { noTrialSuite } from './trial-mode';

/**
 * The trials-off half of the billing lifecycle. `billing.spec.ts` covers the
 * same first-purchase ground while trials are on; exactly one of the two runs,
 * decided by TRIALS_ENABLED in lib/constants/trials.ts.
 *
 * Only two stages, not a stage-for-stage mirror of the trials-on file. Its
 * later stages all turn on trial mechanics (a running trial surviving an
 * upgrade, a trial end that must not move under a downgrade, a pending Free
 * switch scheduled at that trial end). The non-trial equivalents of those,
 * upgrade in place, downgrade scheduled at period end, and renew
 * un-scheduling the pending switch, are already covered end-to-end by journey
 * C in billing-clock.spec.ts, which runs in both trial modes. Repeating them
 * here would spend a live Stripe checkout to prove nothing new.
 *
 * What genuinely disappears when trials go off is the two assertions below:
 * the pricing table must stop advertising a trial, and the first purchase must
 * be billed immediately rather than starting one.
 *
 * Own fresh `e2e-billing-nt-*` user per invocation, for the same reason
 * billing.spec.ts signs up its own: billing state lives in Autumn/Stripe, not
 * the app database, so it survives across runs and cannot be cleaned up.
 *
 * Tagged @live: it completes a real Stripe test-mode checkout.
 */

const STORAGE_STATE_BILLING = path.resolve(
  __dirname,
  '.auth/user-billing-no-trial.json',
);
const CREDENTIALS_BILLING = path.resolve(
  __dirname,
  '.auth/credentials-billing-no-trial.json',
);

const BASIC_ANNUAL = 'basic_annual';
const PRO_ANNUAL = 'pro_annual';

test.use({ storageState: STORAGE_STATE_BILLING });

/** CTA locator for one plan card in the settings pricing table. */
function planCta(page: Page, productId: string) {
  return page.getByTestId(`pricing-card-cta-${productId}`);
}

async function openPricingTable(page: Page) {
  await gotoAuthedApp(page, '/app/settings', planCta(page, BASIC_ANNUAL));
}

/**
 * Reload the settings page until a plan's CTA shows the expected label.
 * Autumn state propagates asynchronously after a checkout/attach.
 */
async function expectPlanState(
  page: Page,
  productId: string,
  label: RegExp,
  timeout = 90_000,
) {
  await expect(async () => {
    await openPricingTable(page);
    await expect(planCta(page, productId)).toHaveText(label, {
      timeout: 5_000,
    });
  }).toPass({ timeout, intervals: [2_000, 5_000] });
}

noTrialSuite(
  'billing lifecycle without trials (live)',
  { tag: '@live' },
  () => {
    // Serial: stage 2 buys the plan stage 1 asserts is unbought.
    test.describe.configure({ mode: 'serial', retries: 0 });

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(240_000);
      // Explicit empty state: newContext() would otherwise inherit the
      // test.use storageState file, which doesn't exist before first signup.
      const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page = await context.newPage();
      await signUpFreshUser(page, {
        prefix: 'billing-nt',
        storageStatePath: STORAGE_STATE_BILLING,
        credentialsPath: CREDENTIALS_BILLING,
      });
      await context.close();
    });

    test.beforeEach(async ({ page }) => {
      await neutralizeTours(page);
    });

    test('a fresh user is offered no trial anywhere', async ({ page }) => {
      await openPricingTable(page);

      // The exact inverse of the trials-on opening stage. This user is still
      // trial-ELIGIBLE by every measure the app tracks (never trialed, no paid
      // plan); the only reason no trial is on offer is that the plans no longer
      // carry one. That makes this the assertion that catches a pricing surface
      // reading eligibility instead of Autumn's has_trial.
      await expect(page.getByTestId('pricing-trial-badge')).toHaveCount(0);
      await expect(planCta(page, BASIC_ANNUAL)).not.toHaveText(
        /start free trial/i,
      );
      await expect(planCta(page, PRO_ANNUAL)).not.toHaveText(
        /start free trial/i,
      );
    });

    test('the first purchase is billed immediately through Stripe checkout', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await openPricingTable(page);

      // No payment method on file, so the checkout() call still redirects to
      // Stripe's hosted page. The difference from a card-required trial is what
      // Stripe does there: a real charge rather than a €0 setup.
      await planCta(page, BASIC_ANNUAL).click();
      const creds = JSON.parse(
        fs.readFileSync(CREDENTIALS_BILLING, 'utf8'),
      ) as {
        email: string;
      };
      await completeStripeTestCheckout(page, { email: creds.email });

      await expectPlanState(page, BASIC_ANNUAL, /current plan/i, 120_000);
      // Still no trial on offer for the plan above, and no badge: a paying
      // customer must not be shown one either.
      await expect(page.getByTestId('pricing-trial-badge')).toHaveCount(0);
      await expect(planCta(page, PRO_ANNUAL)).not.toHaveText(
        /start free trial/i,
      );
    });
  },
);
