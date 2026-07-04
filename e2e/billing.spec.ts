import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { completeOnboardingFresh, dismissTour } from "./helpers";

/**
 * Billing / trial lifecycle — drives the REAL upgrade/downgrade-during-trial
 * flows end-to-end against Autumn + Stripe test mode:
 *
 *   1. A fresh (trial-eligible) user sees the trial badge + "Start Free Trial".
 *   2. Starting a plan opens Stripe Checkout (card-required trial); completing
 *      it with the 4242 test card lands the user in a trialing state — after
 *      which NO trial promo may appear anywhere (trials are once-ever).
 *   3. Upgrading during the trial switches the plan immediately but KEEPS the
 *      running trial: dialog says "…still ends on {date}", €0.00 due today,
 *      and never "Start trial". (convex/billing.ts switchPlanDuringTrial)
 *   4. Downgrading during the trial schedules the cheaper plan at trial end
 *      with the SAME end date as captured in step 3 — the trial is untouched.
 *      This is the reported regression: it used to read "Start trial for
 *      Basic Annual".
 *
 * The journey signs up its OWN fresh `e2e-billing-*` user in beforeAll
 * instead of borrowing the shared user B: the tests' premise is a
 * NEVER-TRIALED identity, and billing state lives in Autumn/Stripe (not
 * the app database), so it survives across suite runs — a user B from an
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
 * NOTE: there is intentionally NO account/billing cleanup afterwards — the
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

/**
 * Sign up a brand-new user and walk the onboarding wizard (default
 * "completely-new" branch). Mirrors auth.setup.ts, which cannot be
 * imported here because it registers its own test() calls.
 */
async function signUpFreshBillingUser(page: Page) {
  const random = crypto.randomBytes(6).toString("hex");
  const creds = {
    email: `e2e-billing-${Date.now()}-${random}@test.de`,
    password: `E2ePass!${random}`,
    name: `E2E billing ${random}`,
  };

  await page.goto("/auth/sign-up");
  await page.waitForLoadState("domcontentloaded");
  const nameField = page.getByLabel(/^name$/i);
  if (await nameField.count()) {
    await nameField.first().fill(creds.name);
  }
  await page.getByLabel(/email/i).first().fill(creds.email);
  const passwordFields = page.getByLabel(/password/i);
  const passwordCount = await passwordFields.count();
  for (let i = 0; i < passwordCount; i++) {
    await passwordFields.nth(i).fill(creds.password);
  }
  const acceptCookies = page.getByRole("button", { name: /accept all/i });
  if (await acceptCookies.count()) {
    await acceptCookies.first().click().catch(() => {});
  }
  await page
    .getByRole("button", { name: /create an account|create account|^sign\s*up$/i })
    .click();
  await page.waitForURL(/\/app\/onboarding/, { timeout: 30_000 });

  await completeOnboardingFresh(page, {});

  fs.mkdirSync(path.dirname(STORAGE_STATE_BILLING), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE_BILLING });
  fs.writeFileSync(
    CREDENTIALS_BILLING,
    JSON.stringify({ ...creds, createdAt: new Date().toISOString() }, null, 2),
  );
}

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
  await page.goto("/app/settings");
  await page.waitForURL("**/app/settings", { timeout: 20_000 });
  // Safety net on top of the beforeEach home-tour dismissal: this runs on
  // a page WITHOUT an open dialog, so a proper dismissal is safe here.
  await dismissTour(page, undefined, 1_000);
  await expect(planCta(page, BASIC_ANNUAL)).toBeVisible({ timeout: 30_000 });
}

/**
 * The driver.js tour launches asynchronously after hydration, so it can
 * pop AFTER `openPricingTable`'s dismissal — with its overlay landing on
 * top of the checkout dialog. Strip any driver DOM so the confirm click
 * cannot be intercepted. This must be a pure DOM removal: dismissTour()
 * clicks the popover (or presses Escape), and with the checkout dialog
 * open either lands OUTSIDE the Radix dialog and closes it — the confirm
 * button then never becomes clickable again.
 */
async function clearTourArtifacts(page: Page) {
  await page
    .evaluate(() => {
      document
        .querySelectorAll(".driver-overlay, .driver-popover")
        .forEach((el) => el.remove());
    })
    .catch(() => {});
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

/**
 * Fill Stripe's hosted test-mode checkout with the standard 4242 test card
 * and submit.
 *
 * The current hosted layout offers "Pay with Link" plus a payment-method
 * accordion (Card / Klarna / …) whose card fields only render after the
 * Card option is selected. Depending on the rollout, the card inputs are
 * either plain DOM (`input#cardNumber`) or live inside Stripe element
 * iframes — both variants are handled. Optional fields are filled
 * defensively since their presence varies by account configuration.
 */
async function completeStripeTestCheckout(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

  const email = page.locator("input#email");
  if ((await email.count()) && (await email.isEditable().catch(() => false))) {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_BILLING, "utf8")) as {
      email: string;
    };
    await email.fill(creds.email);
  }

  // The inline card form only renders once the "Card" payment-method
  // radio is checked, and the accordion itself renders asynchronously —
  // so selecting the radio has to be part of the retry loop, not a
  // one-shot step. Normal clicks on the styled row time out (the Link
  // iframe overlays the hit area); force-checking the radio input works.
  // The card inputs are plain DOM in this layout, but the iframe-hosted
  // payment-element variant is also handled.
  type CardFields = {
    number: ReturnType<Page["locator"]>;
    expiry: ReturnType<Page["locator"]>;
    cvc: ReturnType<Page["locator"]>;
  };
  let fields: CardFields | undefined;
  await expect(async () => {
    const domFields = (): CardFields => ({
      number: page.locator("input#cardNumber"),
      expiry: page.locator("input#cardExpiry"),
      cvc: page.locator("input#cardCvc"),
    });
    if (await page.locator("input#cardNumber").count()) {
      fields = domFields();
      return;
    }
    const cardRadio = page.getByRole("radio", { name: /^card$/i }).first();
    if (await cardRadio.count()) {
      await cardRadio.check({ force: true, timeout: 2_000 }).catch(() => {});
      if (await page.locator("input#cardNumber").count()) {
        fields = domFields();
        return;
      }
    }
    for (const frame of page.frames()) {
      const inFrame = frame.locator('input[name="number"]');
      if (await inFrame.count().catch(() => 0)) {
        fields = {
          number: inFrame,
          expiry: frame.locator('input[name="expiry"]'),
          cvc: frame.locator('input[name="cvc"]'),
        };
        return;
      }
    }
    throw new Error("Stripe card fields not rendered yet");
  }).toPass({ timeout: 45_000, intervals: [1_000] });

  await fields!.number.fill("4242 4242 4242 4242");
  await fields!.expiry.fill("12 / 34");
  await fields!.cvc.fill("123");

  const name = page.locator("input#billingName");
  if ((await name.count()) && (await name.isVisible().catch(() => false))) {
    await name.fill("E2E Billing Test");
  }
  const country = page.locator("select#billingCountry");
  if (await country.count()) {
    await country.selectOption("DE").catch(() => {});
  }
  const postal = page.locator("input#billingPostalCode");
  if ((await postal.count()) && (await postal.isVisible().catch(() => false))) {
    await postal.fill("10115");
  }

  // Label varies by locale/legislation (e.g. "Start trial", "Subscribe
  // with obligation to pay") — match the stable class first.
  await page
    .locator("button.SubmitButton, button[type=submit]")
    .first()
    .click();

  // Stripe processes the payment and then redirects to the success URL.
  // Where exactly that lands is Autumn's concern — we only wait to be off
  // the Stripe domain before returning to the app ourselves.
  await page.waitForURL((url) => !/checkout\.stripe\.com/.test(url.href), {
    timeout: 90_000,
  });
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
    await signUpFreshBillingUser(page);
    await context.close();
  });

  // The billing user has never dismissed the one-shot home tour, which
  // fires on the first authenticated page load — and keeps re-firing on
  // every navigation until it is PROPERLY closed (only the X persists
  // completion to userSettings; stripping the overlay DOM does not).
  // Close it once up front so its overlay can never intercept pricing or
  // dialog clicks below.
  let tourHandled = false;
  test.beforeEach(async ({ page }) => {
    if (tourHandled) return;
    await page.goto("/app");
    await dismissTour(page, "home_tour", 12_000);
    tourHandled = true;
  });

  // Captured in the upgrade dialog (step 3) and asserted identical in the
  // downgrade dialog (step 4) — proves the trial end never moves.
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
    await completeStripeTestCheckout(page);

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

    // Nothing is charged now — billing starts at the (kept) trial end.
    await expect(page.getByTestId("checkout-due-today")).toHaveText("€0.00");

    const messageText = (await message.innerText()).trim();
    trialEndDate = /still ends on (.+?),/.exec(messageText)?.[1];
    expect(trialEndDate, `trial end date parsed from: ${messageText}`).toBeTruthy();

    await clearTourArtifacts(page);
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

    // The trial end must be EXACTLY the date shown during the upgrade —
    // switching plans neither restarts nor extends the trial. (The
    // carry-over rounds the remaining trial UP to whole days, so the end
    // can move by the seconds elapsed between signup and the upgrade —
    // only a run straddling midnight could shift the calendar date.)
    const messageText = (await message.innerText()).trim();
    const scheduledDate = /continues unchanged until (.+?)\./.exec(
      messageText,
    )?.[1];
    expect(scheduledDate, `date parsed from: ${messageText}`).toBeTruthy();
    expect(scheduledDate).toBe(trialEndDate);

    await expect(page.getByTestId("checkout-due-today")).toHaveText("€0.00");

    await clearTourArtifacts(page);
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
});
