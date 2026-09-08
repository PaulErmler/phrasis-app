import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import {
  completeStripeTestCheckout,
  neutralizeTours,
  signUpFreshUser,
  STRIPE_TEST_CARD_CHARGE_FAILS,
} from './helpers';
import {
  advanceClock,
  attachTestCard,
  createClockedCustomer,
  findCustomerByEmail,
  getSubscription,
  isCancelScheduledAtPeriodEnd,
  listSubscriptions,
  waitForSubscriptions,
  type ClockedCustomer,
} from './stripe-clock';
import { trialSuite } from './trial-mode';
import {
  BASIC_ANNUAL,
  convexTestHook,
  expectPlanState,
  FREE,
  openPricingTable,
  planCta,
  PRO_ANNUAL,
  startFirstPurchase,
  STRIPE_KEY,
  waitForAutumnPlans,
} from './billing-clock-helpers';

/**
 * Time-driven billing edge cases, simulated with REAL Stripe test clocks.
 *
 * Every state here is produced by actually moving time on a Stripe test
 * clock, no billing overrides. The one trick making that possible: test
 * clocks can only be set at Stripe-customer creation, so the spec creates
 * the clocked Stripe customer itself and hands it to Autumn via the
 * `usage/testing:relinkStripeCustomer` hook BEFORE the first purchase
 * (exactly how Autumn's own test suite does it). From then on Autumn runs
 * all billing for the user on the clocked customer, and advancing the clock
 * produces genuine trial conversions, renewals, failed charges, lapses.
 *
 * Journey A. Trial start and clock-driven conversion:
 *   1. First purchase redirects to Stripe's hosted checkout (the
 *      Managed-Payments-capable v2 session; `redirect_mode: 'always'`), and
 *      nothing exists in Stripe until the customer confirms THERE: the
 *      button click alone never charges.
 *   2. Advancing past trial end converts the trial into a paid
 *      subscription; the app keeps working, no dunning.
 *
 * Journey D. The lapsed-subscriber repurchase, in REAL time (no clock):
 *   A trial is started through checkout (card saved), then the subscription
 *   is cancelled AT STRIPE (DELETE: Autumn's own `cancel_immediately`
 *   means "cancel with prorated refund", and Stripe forbids creating that
 *   refund invoice on Managed Payments subscriptions). At real-world
 *   timestamps Autumn's webhook ingestion reflects the lapse immediately,
 *   which manufactures the exact customer class the Managed-Payments
 *   review flagged: lapsed, card saved. The repurchase must redirect to
 *   Stripe (no silent inline charge: the §312j BGB regression), start
 *   WITHOUT a second trial (pins `customize.free_trial: null` against live
 *   Autumn), and with the MoR flag on, carry `managed_payments.enabled`.
 *
 * Journey C. The legacy (grandfathered, non-MoR) customer:
 *   A subscription created the pre-Managed-Payments way: Autumn's v1.2
 *   `/attach` with a card on file, no Checkout Session (the
 *   `usage/testing:legacyAttachPlan` hook): must keep working untouched
 *   while the flag is on: upgrade updates the SAME subscription in place
 *   with no Stripe redirect, downgrade schedules and renew un-schedules,
 *   the annual renewal charges the saved card at period end, and cancel to
 *   Free executes at period end. The subscription stays non-MoR throughout
 *   (Stripe cannot convert existing subscriptions).
 *
 * Journey B. Genuine past_due (no overrides, unlike payment-overdue.spec):
 *   1. Trial started with card 0341 (attaches fine, every charge fails).
 *   2. Advancing past trial end makes the conversion invoice FAIL →
 *      subscription past_due → the real dunning dialog appears, driven by
 *      Autumn's own webhook-fed state.
 *   3. The dialog's cancel path (`cancelOverdueSubscription`) really
 *      cancels: dialog clears, customer lands on Free, Stripe shows the
 *      subscription cancelled.
 *
 * Prerequisites:
 *   - The Stripe TEST-mode secret key of the account Autumn's sandbox org
 *     is connected to: either `STRIPE_TEST_SECRET_KEY` in the env, or any
 *     `*STRIPE*` test-mode key in the repo-root `.env.local` (parsed by
 *     e2e/stripe-clock.ts; the Playwright runner doesn't load that file by
 *     itself). The whole spec self-skips without it; live keys are refused.
 *   - `E2E_TEST_HOOKS=1` on the dev deployment (global-setup handles it).
 *   - Same fresh-user, no-cleanup policy as billing.spec.ts.
 *
 * ⚠️ Autumn wall-clock limitation (established empirically, 2026-08-09):
 * test clocks accelerate STRIPE only. Hosted Autumn ingests *event-driven*
 * changes from clocked customers just fine (payment failures → past_due,
 * invoice.paid, cancellations via its API), but its `trialing` and
 * `scheduled` statuses are derived from ITS stored real-world dates. A
 * clock-driven trial end or scheduled-plan start does not flip Autumn's
 * state until the real date arrives (hours after a 1-year advance, Autumn
 * still reported trialing + scheduled). Consequently: assert Stripe-side
 * effects after clock advances; produce Autumn-side state transitions via
 * Autumn's API (immediate cancel) or real payment events, never via the
 * clock.
 *
 * Runtime warning: clock advances take tens of seconds on Stripe's side and
 * Autumn's webhook ingestion adds more. Whole file runs several minutes.
 */

test.describe('billing on a Stripe test clock (live)', { tag: '@live' }, () => {
  test.skip(
    !STRIPE_KEY,
    'No Stripe test-mode key found (env STRIPE_TEST_SECRET_KEY or .env.local) — see the spec header',
  );

  // Serial is scoped PER JOURNEY: within one journey the tests are stages of
  // one user's life and must skip after a failure, but the journeys use
  // independent users. One failing must not take the others down.
  trialSuite('journey A: trial → paid conversion on the clock', () => {
    test.describe.configure({ mode: 'serial', retries: 0 });
    const STORAGE = path.resolve(__dirname, '.auth/user-clock-a.json');
    const CREDS = path.resolve(__dirname, '.auth/credentials-clock-a.json');

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
        prefix: 'clock-a',
        storageStatePath: STORAGE,
        credentialsPath: CREDS,
      });
      email = creds.email;
      await signupContext.close();

      // The clocked Stripe customer, linked to the Autumn customer BEFORE
      // any purchase. The only moment a test clock can enter the picture.
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

    test('first purchase confirms on Stripe, never on the button click', async () => {
      test.setTimeout(300_000);
      await openPricingTable(page);
      await expect(planCta(page, BASIC_ANNUAL)).toHaveText(/start free trial/i);

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
        (s) => s.some((x) => x.status === 'trialing'),
        { label: 'trialing subscription' },
      );
      expect(subs.filter((s) => s.status !== 'canceled')).toHaveLength(1);
    });

    test('advancing past trial end converts the trial into a paid subscription', async () => {
      test.setTimeout(420_000);
      const [sub] = (
        await listSubscriptions(STRIPE_KEY!, clocked.customerId)
      ).filter((s) => s.status === 'trialing');
      expect(
        sub?.trial_end,
        'trialing subscription with a trial_end',
      ).toBeTruthy();

      await advanceClock(
        STRIPE_KEY!,
        clocked.clockId,
        sub.trial_end! + 26 * 3600,
      );
      await waitForSubscriptions(
        STRIPE_KEY!,
        clocked.customerId,
        (s) => s.some((x) => x.status === 'active'),
        { label: 'active (converted) subscription', timeoutMs: 180_000 },
      );

      // The app keeps working on the paid plan, no dunning, plan current.
      await expectPlanState(page, BASIC_ANNUAL, /current plan/i);
      await expect(page.getByTestId('payment-overdue-dialog')).toHaveCount(0);
    });
  });

  trialSuite('journey D: lapsed repurchase (real time, no clock)', () => {
    test.describe.configure({ mode: 'serial', retries: 0 });
    const STORAGE = path.resolve(__dirname, '.auth/user-clock-d.json');
    const CREDS = path.resolve(__dirname, '.auth/credentials-clock-d.json');

    let context: BrowserContext;
    let page: Page;
    let email: string;
    let customerId: string;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(300_000);
      const signupContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const signupPage = await signupContext.newPage();
      const creds = await signUpFreshUser(signupPage, {
        prefix: 'clock-d',
        storageStatePath: STORAGE,
        credentialsPath: CREDS,
      });
      email = creds.email;
      await signupContext.close();

      // Deliberately NO test clock and NO relink: this journey runs in real
      // time so every Stripe timestamp matches Autumn's wall clock. The
      // only way its webhook-fed state can reflect a lapse immediately.
      context = await browser.newContext({ storageState: STORAGE });
      page = await context.newPage();
      await neutralizeTours(page);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test('trial starts through Stripe checkout and saves the card', async () => {
      test.setTimeout(300_000);
      await openPricingTable(page);
      await startFirstPurchase(
        page,
        async () => {
          const id = await findCustomerByEmail(STRIPE_KEY!, email);
          expect(
            id,
            'Stripe customer created by the checkout session',
          ).toBeTruthy();
          customerId = id!;
          return id!;
        },
        BASIC_ANNUAL,
      );
      await completeStripeTestCheckout(page, { email });
      await expectPlanState(page, BASIC_ANNUAL, /current plan/i);
      await waitForSubscriptions(
        STRIPE_KEY!,
        customerId,
        (s) => s.some((x) => x.status === 'trialing'),
        { label: 'trialing subscription' },
      );
    });

    test('an immediate cancellation lapses the customer to Free', async () => {
      test.setTimeout(300_000);
      // Cancelled via AUTUMN's /cancel (the cancelPlanNow hook, the same
      // call the app's cancelOverdueSubscription makes), NOT via a
      // Stripe-side DELETE of the subscription. A Stripe-side delete is a
      // dead end for this journey: Autumn does not ingest
      // `customer.subscription.deleted` for Managed Payments subscriptions
      // (two live probes 2026-08-10: the event fired and was fully
      // delivered, yet Autumn still reported `trialing` 40+ minutes later).
      // The trialing sub has charged nothing, so no refund invoice is
      // involved (Stripe forbids merchant-created invoices on Managed
      // Payments subscriptions, which is what rules out
      // `cancel_immediately` on PAID MoR subs).
      const [sub] = (await listSubscriptions(STRIPE_KEY!, customerId)).filter(
        (s) => s.status === 'trialing',
      );
      expect(sub, 'trialing subscription to cancel').toBeTruthy();
      convexTestHook('cancelPlanNow', { email });

      await waitForSubscriptions(
        STRIPE_KEY!,
        customerId,
        (s) => s.every((x) => x.status === 'canceled'),
        { label: 'cancelled subscription (lapsed)', timeoutMs: 120_000 },
      );
      await waitForAutumnPlans(
        email,
        (plans) =>
          plans.some((p) => p.id === FREE && p.status === 'active') &&
          plans.every(
            (p) =>
              p.id === FREE ||
              !['active', 'trialing', 'scheduled'].includes(p.status),
          ),
        { label: 'Autumn to report the lapse to Free', timeoutMs: 240_000 },
      );
      await expectPlanState(page, FREE, /current plan/i);
      await expect(page.getByTestId('payment-overdue-dialog')).toHaveCount(0);
    });

    test('lapsed repurchase redirects to Stripe and grants no second trial', async () => {
      test.setTimeout(300_000);
      await openPricingTable(page);

      // Trials are once-ever: the cancelled trial is in trials_used, so the
      // lapsed customer must not be offered another one.
      await expect(planCta(page, BASIC_ANNUAL)).not.toHaveText(
        /start free trial/i,
      );
      await expect(page.getByTestId('pricing-trial-badge')).toHaveCount(0);

      // A saved card is exactly what made the old 'if_required' path charge
      // silently on click. This asserts the redirect happens and nothing
      // was bought before Stripe's confirmation page.
      await startFirstPurchase(page, async () => customerId, BASIC_ANNUAL);
      await completeStripeTestCheckout(page, { email });

      await expectPlanState(page, BASIC_ANNUAL, /current plan/i);
      const subs = await waitForSubscriptions(
        STRIPE_KEY!,
        customerId,
        (s) => s.some((x) => x.status === 'active'),
        { label: 'repurchased subscription' },
      );
      const active = subs.filter((s) => s.status !== 'canceled');
      expect(active).toHaveLength(1);
      // No second trial: active immediately, no trial_end. Live proof of
      // the v2 `customize.free_trial: null` reading.
      expect(active[0].status).toBe('active');
      expect(active[0].trial_end).toBeNull();
    });
  });

  trialSuite('journey B: failed renewal → real past_due → cancel', () => {
    test.describe.configure({ mode: 'serial', retries: 0 });
    const STORAGE = path.resolve(__dirname, '.auth/user-clock-b.json');
    const CREDS = path.resolve(__dirname, '.auth/credentials-clock-b.json');

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
        prefix: 'clock-b',
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

    test('trial starts on the charge-failing card', async () => {
      test.setTimeout(300_000);
      await openPricingTable(page);
      await startFirstPurchase(
        page,
        async () => clocked.customerId,
        BASIC_ANNUAL,
      );
      // 0341 attaches fine (trials only save the card), fails every charge.
      await completeStripeTestCheckout(page, {
        email,
        cardNumber: STRIPE_TEST_CARD_CHARGE_FAILS,
      });
      await expectPlanState(page, BASIC_ANNUAL, /current plan/i);
    });

    test('failed conversion charge produces a REAL past_due and the dunning dialog', async () => {
      test.setTimeout(900_000);
      const [sub] = (
        await listSubscriptions(STRIPE_KEY!, clocked.customerId)
      ).filter((s) => s.status === 'trialing');
      expect(
        sub?.trial_end,
        'trialing subscription with a trial_end',
      ).toBeTruthy();

      await advanceClock(
        STRIPE_KEY!,
        clocked.clockId,
        sub.trial_end! + 26 * 3600,
      );
      await waitForSubscriptions(
        STRIPE_KEY!,
        clocked.customerId,
        (s) => s.some((x) => x.status === 'past_due'),
        { label: 'past_due subscription', timeoutMs: 240_000 },
      );
      await waitForAutumnPlans(email, (plans) => plans.some((p) => p.pastDue), {
        label: 'Autumn to report past_due',
      });

      // No overrides anywhere: the dialog appears purely because Autumn
      // ingested Stripe's failed-invoice webhooks and the app synced it.
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
      // reload and the customer lands on Free.
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
  });

  test.describe('journey C: legacy non-MoR customer keeps working', () => {
    test.describe.configure({ mode: 'serial', retries: 0 });
    const STORAGE = path.resolve(__dirname, '.auth/user-clock-c.json');
    const CREDS = path.resolve(__dirname, '.auth/credentials-clock-c.json');

    let context: BrowserContext;
    let page: Page;
    let clocked: ClockedCustomer;
    /** The one Stripe subscription. Must stay THE one through every switch. */
    let legacySubId: string;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(300_000);
      const signupContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const signupPage = await signupContext.newPage();
      const creds = await signUpFreshUser(signupPage, {
        prefix: 'clock-c',
        storageStatePath: STORAGE,
        credentialsPath: CREDS,
      });
      await signupContext.close();

      // A grandfathered customer, reconstructed faithfully: clocked Stripe
      // customer, card saved, subscription created through Autumn's legacy
      // v1.2 attach. Direct charge, no Checkout Session, so non-MoR by
      // construction, exactly like every subscription that predates the flag.
      clocked = await createClockedCustomer(STRIPE_KEY!, creds.email);
      await attachTestCard(STRIPE_KEY!, clocked.customerId, 'pm_card_visa');
      convexTestHook('relinkStripeCustomer', {
        email: creds.email,
        stripeId: clocked.customerId,
      });
      convexTestHook('legacyAttachPlan', {
        email: creds.email,
        productId: BASIC_ANNUAL,
      });

      context = await browser.newContext({ storageState: STORAGE });
      page = await context.newPage();
      await neutralizeTours(page);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test('the legacy subscription is live, non-MoR, and shown by the app', async () => {
      test.setTimeout(240_000);
      await expectPlanState(page, BASIC_ANNUAL, /current plan/i);

      const subs = await waitForSubscriptions(
        STRIPE_KEY!,
        clocked.customerId,
        (s) => s.some((x) => x.status === 'active'),
        { label: 'legacy subscription' },
      );
      const active = subs.filter((s) => s.status !== 'canceled');
      expect(active).toHaveLength(1);
      expect(active[0].trial_end).toBeNull();
      legacySubId = active[0].id;

      const sub = await getSubscription(STRIPE_KEY!, legacySubId);
      expect(
        sub.managed_payments?.enabled ?? false,
        'a legacy attach must never produce a Managed Payments subscription',
      ).toBe(false);
    });

    test('upgrade confirms in-app and updates the SAME subscription in place', async () => {
      test.setTimeout(240_000);
      await openPricingTable(page);
      await planCta(page, PRO_ANNUAL).click();

      // Card on file → the confirm dialog, not a redirect.
      const title = page.getByTestId('checkout-dialog-title');
      await expect(title).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('checkout-dialog-confirm').click();
      await expect(title).toBeHidden({ timeout: 60_000 });

      // In-place subscription update: the page never left the app…
      expect(page.url()).not.toMatch(/checkout\.stripe\.com/);
      await expectPlanState(page, PRO_ANNUAL, /current plan/i);

      // …and Stripe still holds the SAME single subscription, still non-MoR
      // (Stripe cannot convert existing subscriptions, the expected mixed
      // estate).
      const active = (
        await listSubscriptions(STRIPE_KEY!, clocked.customerId)
      ).filter((s) => s.status !== 'canceled');
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(legacySubId);
      const sub = await getSubscription(STRIPE_KEY!, legacySubId);
      expect(sub.managed_payments?.enabled ?? false).toBe(false);
    });

    test('downgrade schedules at period end; renew un-schedules it', async () => {
      test.setTimeout(240_000);
      await openPricingTable(page);
      await planCta(page, BASIC_ANNUAL).click();
      const title = page.getByTestId('checkout-dialog-title');
      await expect(title).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('checkout-dialog-confirm').click();
      await expect(title).toBeHidden({ timeout: 60_000 });
      await expectPlanState(page, BASIC_ANNUAL, /scheduled/i);

      // Re-attaching the current plan (Autumn scenario "renew") drops the
      // scheduled switch.
      await planCta(page, PRO_ANNUAL).click();
      await expect(title).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('checkout-dialog-confirm').click();
      await expect(title).toBeHidden({ timeout: 60_000 });
      await expectPlanState(page, PRO_ANNUAL, /current plan/i);
      await expect(planCta(page, BASIC_ANNUAL)).not.toHaveText(/scheduled/i);
    });

    test('the annual renewal charges the saved card at period end', async () => {
      test.setTimeout(900_000);
      const before = await getSubscription(STRIPE_KEY!, legacySubId);
      expect(before.status).toBe('active');

      await advanceClock(
        STRIPE_KEY!,
        clocked.clockId,
        before.current_period_end + 26 * 3600,
        300_000,
      );
      await waitForSubscriptions(
        STRIPE_KEY!,
        clocked.customerId,
        (s) =>
          s.some(
            (x) =>
              x.id === legacySubId &&
              x.status === 'active' &&
              x.current_period_end > before.current_period_end,
          ),
        { label: 'renewed subscription', timeoutMs: 180_000 },
      );

      // Renewal went through on the legacy card: still the current plan,
      // no dunning.
      await expectPlanState(page, PRO_ANNUAL, /current plan/i);
      await expect(page.getByTestId('payment-overdue-dialog')).toHaveCount(0);
    });

    test('cancelling to Free executes at period end (Stripe side)', async () => {
      test.setTimeout(900_000);
      await openPricingTable(page);
      await planCta(page, FREE).click();
      const title = page.getByTestId('checkout-dialog-title');
      await expect(title).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('checkout-dialog-confirm').click();
      await expect(title).toBeHidden({ timeout: 60_000 });

      // The cancel must be SCHEDULED, not executed: still active, with the
      // cancellation wired to the period end. Without this pin, an immediate
      // cancel (the failure mode of routing a free-target attach to v2,
      // which has no cancel semantics) would still satisfy the
      // all-cancelled check after the clock advance below. The worst
      // outcome would pass the test. Autumn spells the schedule as
      // `cancel_at` = period end, not `cancel_at_period_end` (see
      // stripe-clock.ts).
      const sub = await waitForSubscriptions(
        STRIPE_KEY!,
        clocked.customerId,
        (s) =>
          s.some(
            (x) => x.id === legacySubId && isCancelScheduledAtPeriodEnd(x),
          ),
        { label: 'cancellation scheduled at period end' },
      ).then((s) => s.find((x) => x.id === legacySubId)!);
      expect(sub.status).toBe('active');

      await advanceClock(
        STRIPE_KEY!,
        clocked.clockId,
        sub.current_period_end + 2 * 86_400,
        300_000,
      );
      // Stripe-side only, deliberately: the scheduled cancel wiring
      // (cancel_at_period_end) provably executes when time arrives. Autumn's
      // mirror of the lapse is wall-clock-driven (its scheduled Free starts
      // at the stored REAL-WORLD date), so no Autumn/UI assertion after a
      // clock advance can ever pass. The Autumn-side lapse handling is
      // covered by journey A's immediate cancel instead.
      await waitForSubscriptions(
        STRIPE_KEY!,
        clocked.customerId,
        (s) => s.every((x) => x.status === 'canceled'),
        { label: 'cancelled legacy subscription', timeoutMs: 180_000 },
      );
    });
  });
});
