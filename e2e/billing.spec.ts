import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  completeStripeTestCheckout,
  gotoAuthedApp,
  neutralizeTours,
  signUpFreshUser,
} from "./helpers";

/**
 * Billing / trial lifecycle. Drives the REAL upgrade/downgrade-during-trial
 * flows end-to-end against Autumn + Stripe test mode:
 *
 *   1. A fresh (trial-eligible) user sees the trial badge + "Start Free Trial".
 *   2. Starting a plan opens Stripe Checkout (card-required trial); completing
 *      it with the 4242 test card lands the user in a trialing state: after
 *      which NO trial promo may appear anywhere (trials are once-ever).
 *   3. Upgrading during the trial switches the plan immediately but KEEPS the
 *      running trial: dialog says "…still ends on {date}", €0.00 due today,
 *      and never "Start trial". (convex/billing.ts switchPlanDuringTrial)
 *   4. Downgrading during the trial schedules the cheaper plan at trial end
 *      with the SAME end date as captured in step 3: the trial is untouched.
 *      This is the reported regression: it used to read "Start trial for
 *      Basic Annual".
 *   5. Selecting the FREE plan during the trial schedules Free at the same
 *      unchanged trial end. This is the second reported regression: the
 *      confirm used to call the raw `attach` action, which the server-side
 *      trial gate rejects ("Plan switches during a trial must go through
 *      switchPlanDuringTrial"): the dialog then silently stayed open.
 *   6. Renewing the still-trialing plan afterwards un-schedules the Free
 *      switch. Third reported regression: Autumn classifies this as
 *      "renew", which the dialog's trial routing didn't cover either, so
 *      confirm hit the same trial gate.
 *
 * The journey signs up its OWN fresh `e2e-billing-*` user in beforeAll
 * instead of borrowing the shared user B: the tests' premise is a
 * NEVER-TRIALED identity, and billing state lives in Autumn/Stripe (not
 * the app database), so it survives across suite runs. A user B from an
 * earlier run (or an abandoned Stripe checkout session completing late)
 * would break eligibility in ways that are impossible to clean up, since
 * the app has no account-deletion logic yet. A dedicated per-invocation
 * identity makes every run self-contained and lets the spec be re-run
 * standalone without re-running the setup project.
 *
 * Tagged @live: it completes a real Stripe test-mode checkout.
 *   pnpm exec playwright test --grep @live            # live only
 *   pnpm exec playwright test --grep-invert @live     # skip live
 *
 * NOTE: there is intentionally NO account/billing cleanup afterwards. The
 * app has no user-deletion logic yet, so (like the auth fixture users) the
 * e2e account and its Autumn/Stripe test customer are left behind.
 */

const STORAGE_STATE_BILLING = path.resolve(__dirname, ".auth/user-billing.json");
const CREDENTIALS_BILLING = path.resolve(
  __dirname,
  ".auth/credentials-billing.json",
);

const BASIC_ANNUAL = "basic_annual";
const PRO_ANNUAL = "pro_annual";

test.use({ storageState: STORAGE_STATE_BILLING });

/** CTA locator for one plan card in the settings pricing table. */
function planCta(page: Page, productId: string) {
  return page.getByTestId(`pricing-card-cta-${productId}`);
}

/**
 * Open /app/settings and wait for the pricing table to finish loading
 * (the annual view is the default for users without a monthly plan, so
 * the annual plan cards are the ones rendered).
 */
async function openPricingTable(page: Page) {
  await gotoAuthedApp(page, "/app/settings", planCta(page, BASIC_ANNUAL));
}

/**
 * Reload the settings page until a plan's CTA shows the expected label.
 * Autumn state propagates asynchronously after a checkout/attach, so a
 * single render right after confirming can still show the old scenario.
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

test.describe("billing trial lifecycle (live)", { tag: "@live" }, () => {
  // Serial: the four tests are consecutive stages of one user journey.
  test.describe.configure({ mode: "serial", retries: 0 });

  // Fresh, never-trialed identity for this invocation (see header note).
  // Signing up + onboarding takes ~20-60s depending on backend load.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    // Explicit empty state: newContext() would otherwise inherit the
    // test.use storageState file, which doesn't exist before first signup.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await signUpFreshUser(page, {
      prefix: "billing",
      storageStatePath: STORAGE_STATE_BILLING,
      credentialsPath: CREDENTIALS_BILLING,
    });
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await neutralizeTours(page);
  });

  // Captured in the upgrade dialog (step 3) and asserted identical in the
  // downgrade dialog (step 4), proves the trial end never moves.
  let trialEndDate: string | undefined;

  test("trial-eligible user sees trial badge and Start Free Trial", async ({
    page,
  }) => {
    await openPricingTable(page);

    await expect(page.getByTestId("pricing-trial-badge").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(planCta(page, BASIC_ANNUAL)).toHaveText(/start free trial/i);
    await expect(planCta(page, PRO_ANNUAL)).toHaveText(/start free trial/i);
  });

  test("starting a plan runs the card-required trial through Stripe checkout", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openPricingTable(page);

    // Card-required trial for a customer without a payment method → the
    // checkout() call redirects to Stripe's hosted checkout.
    await planCta(page, BASIC_ANNUAL).click();
    const creds = JSON.parse(
      fs.readFileSync(CREDENTIALS_BILLING, "utf8"),
    ) as { email: string };
    await completeStripeTestCheckout(page, { email: creds.email });

    // Back in the app: Basic Annual becomes the current (trialing) plan…
    await expectPlanState(page, BASIC_ANNUAL, /current plan/i, 120_000);

    // …and the trial promo is gone everywhere: trials are once-ever, so a
    // trialing user must never be offered another one (this was the
    // cross-plan trial-hopping hole).
    await expect(page.getByTestId("pricing-trial-badge")).toHaveCount(0);
    await expect(planCta(page, PRO_ANNUAL)).not.toHaveText(/start free trial/i);
  });

  test("upgrading during the trial keeps the running trial", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openPricingTable(page);

    await planCta(page, PRO_ANNUAL).click();

    // Card is on file now → no Stripe redirect; the confirm dialog opens.
    const title = page.getByTestId("checkout-dialog-title");
    await expect(title).toBeVisible({ timeout: 30_000 });
    await expect(title).toHaveText(/change to pro annual/i);

    const message = page.getByTestId("checkout-dialog-message");
    await expect(message).toContainText(/still ends on/i);
    await expect(message).not.toContainText(/start a free trial/i);

    // Nothing is charged now. Billing starts at the (kept) trial end.
    await expect(page.getByTestId("checkout-due-today")).toHaveText("€0.00");

    const messageText = (await message.innerText()).trim();
    trialEndDate = /still ends on (.+?),/.exec(messageText)?.[1];
    expect(trialEndDate, `trial end date parsed from: ${messageText}`).toBeTruthy();

    await page.getByTestId("checkout-dialog-confirm").click();
    await expect(title).toBeHidden({ timeout: 60_000 });

    // Immediate switch: Pro Annual is the current (still trialing) plan.
    await expectPlanState(page, PRO_ANNUAL, /current plan/i);
    await expect(page.getByTestId("pricing-trial-badge")).toHaveCount(0);
  });

  test("downgrading during the trial schedules the switch at the unchanged trial end", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openPricingTable(page);

    // The reported regression: this dialog used to read
    // "Start trial for Basic Annual".
    await planCta(page, BASIC_ANNUAL).click();

    const title = page.getByTestId("checkout-dialog-title");
    await expect(title).toBeVisible({ timeout: 30_000 });
    await expect(title).toHaveText(/switch to basic annual/i);
    await expect(title).not.toHaveText(/start trial/i);

    const message = page.getByTestId("checkout-dialog-message");
    await expect(message).toContainText(/continues unchanged until/i);
    await expect(message).not.toContainText(/start a free trial/i);

    // The trial end must be EXACTLY the date shown during the upgrade,
    // switching plans neither restarts nor extends the trial. (The
    // carry-over rounds the remaining trial UP to whole days, so the end
    // can move by the seconds elapsed between signup and the upgrade,
    // only a run straddling midnight could shift the calendar date.)
    const messageText = (await message.innerText()).trim();
    const scheduledDate = /continues unchanged until (.+?)\./.exec(
      messageText,
    )?.[1];
    expect(scheduledDate, `date parsed from: ${messageText}`).toBeTruthy();
    expect(scheduledDate).toBe(trialEndDate);

    await expect(page.getByTestId("checkout-due-today")).toHaveText("€0.00");

    await page.getByTestId("checkout-dialog-confirm").click();
    await expect(title).toBeHidden({ timeout: 60_000 });

    // Scheduled switch: the trial keeps running on Pro Annual; Basic Annual
    // is queued to start (and begin billing) when the trial expires. The
    // still-running Pro Annual now lapses at trial end, so Autumn's
    // scenario for it is "renew" (offer to un-cancel), not "active".
    await expectPlanState(page, BASIC_ANNUAL, /plan scheduled/i);
    await expect(planCta(page, PRO_ANNUAL)).toHaveText(/renew/i);
    await expect(page.getByTestId("pricing-trial-badge")).toHaveCount(0);
  });

  test("switching to Free during the trial schedules Free at the unchanged trial end", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openPricingTable(page);

    // The free product's Autumn id is dashboard config, not in the repo,
    // but the table sorts Free first, so the first CTA belongs to it.
    const freeCta = page.locator('[data-testid^="pricing-card-cta-"]').first();
    const freeTestId = await freeCta.getAttribute("data-testid");
    const freeProductId = freeTestId!.replace("pricing-card-cta-", "");
    expect(freeProductId).not.toBe(BASIC_ANNUAL);
    expect(freeProductId).not.toBe(PRO_ANNUAL);

    // The reported regression: confirming this dialog used to call the raw
    // `attach` action, which convex/autumn.ts's trial gate rejects. The
    // dialog then just stayed open with nothing happening.
    await freeCta.click();

    const title = page.getByTestId("checkout-dialog-title");
    await expect(title).toBeVisible({ timeout: 30_000 });
    await expect(title).toHaveText(/switch to/i);
    await expect(title).not.toHaveText(/start trial/i);

    const message = page.getByTestId("checkout-dialog-message");
    await expect(message).toContainText(/continues unchanged until/i);
    await expect(message).not.toContainText(/start a free trial/i);

    // Dropping to Free neither ends the trial early nor extends it, same
    // end date as captured during the upgrade (step 3).
    const messageText = (await message.innerText()).trim();
    const scheduledDate = /continues unchanged until (.+?)\./.exec(
      messageText,
    )?.[1];
    expect(scheduledDate, `date parsed from: ${messageText}`).toBeTruthy();
    expect(scheduledDate).toBe(trialEndDate);

    // Core regression assertion: confirm routes through
    // switchPlanDuringTrial and the dialog CLOSES (before the fix the gate
    // threw and it stayed open).
    await page.getByTestId("checkout-dialog-confirm").click();
    await expect(title).toBeHidden({ timeout: 60_000 });

    // The table must update IN PLACE, without a reload: the trial-switch
    // path refetches the shared SWR caches after confirming (second
    // user-reported regression. The card kept its old label until a
    // manual page reload).
    await expect(freeCta).toHaveText(/plan scheduled/i, { timeout: 20_000 });

    // Free replaces the previously scheduled Basic Annual; the trial keeps
    // running on Pro Annual, which still lapses at trial end ("renew").
    await expectPlanState(page, freeProductId, /plan scheduled/i);
    await expect(planCta(page, PRO_ANNUAL)).toHaveText(/renew/i);
    await expect(page.getByTestId("pricing-trial-badge")).toHaveCount(0);
  });

  test("renewing the trialing plan un-schedules the pending Free switch", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openPricingTable(page);

    const freeCta = page.locator('[data-testid^="pricing-card-cta-"]').first();

    // The reported regression: Autumn classifies re-attaching the trialing
    // plan as "renew", which the dialog's trial routing didn't divert to
    // switchPlanDuringTrial. The confirm hit the raw-attach trial gate.
    await expect(planCta(page, PRO_ANNUAL)).toHaveText(/renew/i);
    await planCta(page, PRO_ANNUAL).click();

    const title = page.getByTestId("checkout-dialog-title");
    await expect(title).toBeVisible({ timeout: 30_000 });
    await expect(title).toHaveText(/renew/i);
    await expect(title).not.toHaveText(/start trial/i);

    const message = page.getByTestId("checkout-dialog-message");
    await expect(message).not.toContainText(/start a free trial/i);

    // Confirm must close the dialog (the gate error used to keep it open)…
    await page.getByTestId("checkout-dialog-confirm").click();
    await expect(title).toBeHidden({ timeout: 60_000 });

    // …and the table updates in place: Pro Annual is current again, the
    // scheduled Free switch is gone.
    await expect(planCta(page, PRO_ANNUAL)).toHaveText(/current plan/i, {
      timeout: 20_000,
    });
    await expect(freeCta).not.toHaveText(/plan scheduled/i);

    // Reload-verify the persisted state; the trial is still running, so
    // the once-ever trial promo must stay gone.
    await expectPlanState(page, PRO_ANNUAL, /current plan/i);
    await expect(freeCta).not.toHaveText(/plan scheduled/i);
    await expect(page.getByTestId("pricing-trial-badge")).toHaveCount(0);
  });
});
