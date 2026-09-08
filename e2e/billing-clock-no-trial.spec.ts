import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import {
  completeStripeTestCheckout,
  neutralizeTours,
  signUpFreshUser,
} from './helpers';
import {
  advanceClock,
  attachTestCard,
  createClockedCustomer,
  listSubscriptions,
  waitForSubscriptions,
  type ClockedCustomer,
} from './stripe-clock';
import { noTrialSuite } from './trial-mode';
import {
  BASIC_ANNUAL,
  convexTestHook,
  expectPlanState,
  FREE,
  openPricingTable,
  planCta,
  startFirstPurchase,
  STRIPE_KEY,
  waitForAutumnPlans,
} from './billing-clock-helpers';

/**
 * The trials-off half of the clocked billing journeys. `billing-clock.spec.ts`
 * covers the same ground while trials are on; exactly one of the two files
 * runs, decided by TRIALS_ENABLED in lib/constants/trials.ts.
 *
 * The shape of the journeys changes with no trial in the way, and not only in
 * their opening move:
 *
 *   A' The first purchase is `active` from the moment Stripe confirms, with a
 *      null trial_end, so what the clock proves here is the first RENEWAL
 *      rather than a conversion.
 *   B' A trial used to be what got a charge-failing card on file: it attaches
 *      during the trial and only fails at conversion. Billed immediately, that
 *      card cannot complete checkout at all, so this journey buys on 4242 and
 *      then swaps the customer's default payment method to the failing one
 *      before advancing to renewal. Same real past_due, no billing overrides.
 *      It then absorbs what journey D covers while trials are on, because the
 *      dunning cancel it ends on is the only refund-free way to lapse a paid
 *      Managed Payments subscription (see the note above that stage).
 *
 * There is deliberately no D' of its own. Journey D lapses a TRIALING
 * subscription, which has charged nothing; neither route available to a paid
 * MoR subscription reproduces that, so its surviving assertion rides on B'.
 *
 * Everything else, the helpers, the Autumn polling, the no-charge-on-click
 * assertion, is shared with the trials-on file via billing-clock-helpers.ts.
 */

noTrialSuite(
  'billing on a Stripe test clock, trials off (live)',
  { tag: '@live' },
  () => {
    test.skip(
      !STRIPE_KEY,
      'No Stripe test-mode key found (env STRIPE_TEST_SECRET_KEY or .env.local) — see the billing-clock spec header',
    );

    // Serial per journey, independent users across journeys. Same rule as
    // the trials-on file: one failing journey must not take the others down.

    test.describe("journey A': first purchase → first renewal on the clock", () => {
      test.describe.configure({ mode: 'serial', retries: 0 });
      const STORAGE = path.resolve(__dirname, '.auth/user-clock-na.json');
      const CREDS = path.resolve(__dirname, '.auth/credentials-clock-na.json');

      let context: BrowserContext;
      let page: Page;
      let email: string;
      let clocked: ClockedCustomer;

      test.beforeAll(async ({ browser }) => {
        test.setTimeout(300_000);
        const signupContext = await browser.newContext({
          storageState: { cookies: [], origins: [] },
        });
        const signupPage = await signupContext.newPage();
        const creds = await signUpFreshUser(signupPage, {
          prefix: 'clock-na',
          storageStatePath: STORAGE,
          credentialsPath: CREDS,
        });
        email = creds.email;
        await signupContext.close();

        clocked = await createClockedCustomer(STRIPE_KEY!, email);
        convexTestHook('relinkStripeCustomer', {
          email,
          stripeId: clocked.customerId,
        });

        context = await browser.newContext({ storageState: STORAGE });
        page = await context.newPage();
        await neutralizeTours(page);
      });

      test.afterAll(async () => {
        await context?.close();
      });

      test('first purchase is active immediately, with no trial', async () => {
        test.setTimeout(300_000);
        await openPricingTable(page);
        // The inverse of the trials-on assertion: no trial CTA, no badge.
        await expect(planCta(page, BASIC_ANNUAL)).not.toHaveText(
          /start free trial/i,
        );
        await expect(page.getByTestId('pricing-trial-badge')).toHaveCount(0);

        await startFirstPurchase(
          page,
          async () => clocked.customerId,
          BASIC_ANNUAL,
        );
        await completeStripeTestCheckout(page, { email });

        await expectPlanState(page, BASIC_ANNUAL, /current plan/i);
        const subs = await waitForSubscriptions(
          STRIPE_KEY!,
          clocked.customerId,
          (s) => s.some((x) => x.status === 'active'),
          { label: 'active subscription' },
        );
        const live = subs.filter((s) => s.status !== 'canceled');
        expect(live).toHaveLength(1);
        // The whole point of the config change, proven Stripe-side.
        expect(live[0].trial_end).toBeNull();
      });

      test('advancing past period end renews the paid subscription', async () => {
        test.setTimeout(600_000);
        const [sub] = (
          await listSubscriptions(STRIPE_KEY!, clocked.customerId)
        ).filter((s) => s.status === 'active');
        expect(sub?.current_period_end, 'active subscription').toBeTruthy();

        // 26h past the boundary: enough for Stripe to bill and settle the
        // renewal invoice, the same margin the trials-on journeys use.
        await advanceClock(
          STRIPE_KEY!,
          clocked.clockId,
          sub.current_period_end + 26 * 3600,
        );
        await waitForSubscriptions(
          STRIPE_KEY!,
          clocked.customerId,
          (s) =>
            s.some(
              (x) =>
                x.status === 'active' &&
                x.current_period_end > sub.current_period_end,
            ),
          { label: 'renewed subscription period', timeoutMs: 240_000 },
        );

        // Renewal charged the saved card: plan still current, no dunning.
        await expectPlanState(page, BASIC_ANNUAL, /current plan/i);
        await expect(page.getByTestId('payment-overdue-dialog')).toHaveCount(0);
      });
    });

    test.describe("journey B': failed renewal → real past_due → cancel", () => {
      test.describe.configure({ mode: 'serial', retries: 0 });
      const STORAGE = path.resolve(__dirname, '.auth/user-clock-nb.json');
      const CREDS = path.resolve(__dirname, '.auth/credentials-clock-nb.json');

      let context: BrowserContext;
      let page: Page;
      let email: string;
      let clocked: ClockedCustomer;

      test.beforeAll(async ({ browser }) => {
        test.setTimeout(300_000);
        const signupContext = await browser.newContext({
          storageState: { cookies: [], origins: [] },
        });
        const signupPage = await signupContext.newPage();
        const creds = await signUpFreshUser(signupPage, {
          prefix: 'clock-nb',
          storageStatePath: STORAGE,
          credentialsPath: CREDS,
        });
        email = creds.email;
        await signupContext.close();

        clocked = await createClockedCustomer(STRIPE_KEY!, email);
        convexTestHook('relinkStripeCustomer', {
          email,
          stripeId: clocked.customerId,
        });

        context = await browser.newContext({ storageState: STORAGE });
        page = await context.newPage();
        await neutralizeTours(page);
      });

      test.afterAll(async () => {
        await context?.close();
      });

      test('the first purchase succeeds on a good card', async () => {
        test.setTimeout(300_000);
        await openPricingTable(page);
        await startFirstPurchase(
          page,
          async () => clocked.customerId,
          BASIC_ANNUAL,
        );
        // 4242, not the charge-failing card: without a trial the very first
        // invoice is charged, so a failing card never gets a subscription
        // created at all and there would be nothing left to dun.
        await completeStripeTestCheckout(page, { email });
        await expectPlanState(page, BASIC_ANNUAL, /current plan/i);
        await waitForSubscriptions(
          STRIPE_KEY!,
          clocked.customerId,
          (s) => s.some((x) => x.status === 'active'),
          { label: 'active subscription' },
        );
      });

      test('a failed RENEWAL produces a REAL past_due and the dunning dialog', async () => {
        test.setTimeout(900_000);
        const [sub] = (
          await listSubscriptions(STRIPE_KEY!, clocked.customerId)
        ).filter((s) => s.status === 'active');
        expect(sub?.current_period_end, 'active subscription').toBeTruthy();

        // Swap the card the NEXT invoice will charge. pm_card_chargeCustomerFail
        // attaches fine and fails every charge, so the subscription stays
        // healthy until the renewal actually runs.
        await attachTestCard(
          STRIPE_KEY!,
          clocked.customerId,
          'pm_card_chargeCustomerFail',
        );

        await advanceClock(
          STRIPE_KEY!,
          clocked.clockId,
          sub.current_period_end + 26 * 3600,
        );
        await waitForSubscriptions(
          STRIPE_KEY!,
          clocked.customerId,
          (s) => s.some((x) => x.status === 'past_due'),
          { label: 'past_due subscription', timeoutMs: 240_000 },
        );
        await waitForAutumnPlans(
          email,
          (plans) => plans.some((p) => p.pastDue),
          { label: 'Autumn to report past_due' },
        );

        // No overrides anywhere: the dialog appears purely because Autumn
        // ingested Stripe's failed-invoice webhooks and the app synced it.
        // This is the genuine past_due that payment-overdue.spec.ts has to
        // simulate, and the reason that spec points here for a real repro.
        await expect(async () => {
          await page.goto('/app');
          await expect(page.getByTestId('payment-overdue-dialog')).toBeVisible({
            timeout: 10_000,
          });
        }).toPass({ timeout: 240_000, intervals: [5_000, 10_000] });
      });

      test("the dialog's cancel path really cancels and frees the account", async () => {
        test.setTimeout(300_000);
        await page.goto('/app');
        const dialog = page.getByTestId('payment-overdue-dialog');
        await expect(dialog).toBeVisible({ timeout: 60_000 });

        await page.getByTestId('payment-overdue-cancel').click();
        await page.getByTestId('payment-overdue-cancel-confirm').click();

        // cancelOverdueSubscription verifies the unpaid invoice server-side,
        // cancels immediately, and syncs. The block must clear without a
        // reload and the customer lands on Free. Cancelling a PAST_DUE
        // subscription is allowed where cancelling a paid healthy one is
        // not: the unpaid invoice is what makes it refund-free.
        await expect(dialog).toBeHidden({ timeout: 120_000 });
        await waitForSubscriptions(
          STRIPE_KEY!,
          clocked.customerId,
          (s) => s.every((x) => x.status === 'canceled'),
          { label: 'cancelled delinquent subscription' },
        );
        await expectPlanState(page, FREE, /current plan/i);
        await expect(page.getByTestId('payment-overdue-dialog')).toHaveCount(0);
      });

      // What journey D proves while trials are on: a lapsed customer with a
      // card already on file repurchases through Stripe rather than being
      // charged by the click. It rides on B' here because the dunning cancel
      // above is the only refund-free way to lapse a PAID Managed Payments
      // subscription. Autumn's own cancel_immediately needs a refund invoice
      // Stripe forbids on MoR subs, and a scheduled cancel plus a clock
      // advance is invisible to Autumn (its scheduled Free starts at the
      // stored real-world date, see journey C).
      test('the lapsed customer repurchases with no trial anywhere', async () => {
        test.setTimeout(300_000);
        // The failing card is still the customer's default, so put a working
        // one back before asking Stripe to charge again.
        await attachTestCard(STRIPE_KEY!, clocked.customerId, 'pm_card_visa');

        await openPricingTable(page);
        await expect(planCta(page, BASIC_ANNUAL)).not.toHaveText(
          /start free trial/i,
        );
        await expect(page.getByTestId('pricing-trial-badge')).toHaveCount(0);

        await startFirstPurchase(
          page,
          async () => clocked.customerId,
          BASIC_ANNUAL,
        );
        await completeStripeTestCheckout(page, { email });

        await expectPlanState(page, BASIC_ANNUAL, /current plan/i);
        const subs = await waitForSubscriptions(
          STRIPE_KEY!,
          clocked.customerId,
          (s) => s.some((x) => x.status === 'active'),
          { label: 'repurchased subscription' },
        );
        const active = subs.filter((s) => s.status !== 'canceled');
        expect(active).toHaveLength(1);
        expect(active[0].status).toBe('active');
        expect(active[0].trial_end).toBeNull();
      });
    });
  },
);
