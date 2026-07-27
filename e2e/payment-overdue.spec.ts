import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  completeStripeTestCheckout,
  neutralizeTours,
  signUpFreshUser,
} from "./helpers";

/**
 * Payment-overdue (dunning) journey — drives the app's overdue popup and
 * the real Stripe billing-portal redirect against Autumn + Stripe test
 * mode:
 *
 *   1. Fresh user starts a card-required trial through Stripe Checkout
 *      (4242 card) — gives the account a real Stripe customer + payment
 *      method, which the billing-portal call needs.
 *   2. `usage/testing:setBillingOverride` forces the synced planStatus to
 *      past_due. Everything downstream of the sync — quota doc, reactive
 *      query, dialog, portal call — is the real production path; only the
 *      Autumn-side trigger is simulated.
 *   3. The block is immediate and non-dismissible, and survives a reload
 *      (which triggers a real Autumn sync).
 *   4. It covers /app/learn, a standalone route outside the (main) layout.
 *   5. The pay CTA opens the real Stripe billing portal.
 *   6. Clearing the override restores the app.
 *
 * Why simulate: a genuine past_due only arises from a failed RENEWAL
 * invoice. Stripe test clocks can't attach to Autumn-created customers,
 * and the shortcut — attach with `free_trial: false` while charge-failing
 * card 4000-0000-0000-0341 is on file — was tried and does NOT produce
 * past_due (verified July 2026): the failed charge leaves an open→voided
 * invoice and an empty products list. Manual repro of the real thing:
 * subscribe with 0341 and wait for the trial to convert.
 *
 * Prerequisites (one-time, dev deployment only):
 *   - `npx convex env set E2E_TEST_HOOKS 1` — the usage/testing:* hooks
 *     throw without it. NEVER set this in production.
 *   - The Stripe test-mode Customer Portal configuration must be saved
 *     once (Stripe dashboard → Settings → Billing → Customer portal),
 *     otherwise the billing-portal API errors.
 *
 * Recovery (paying in the portal → Stripe auto-retry → past_due clears)
 * is not automated: it needs Stripe's portal UI plus non-deterministic
 * retry timing. Covered manually.
 *
 * Tagged @live; same self-contained fresh-user policy as billing.spec.ts
 * (no cleanup — the app has no account deletion; leftovers are harmless).
 */

const STORAGE_STATE = path.resolve(__dirname, ".auth/user-overdue.json");
const CREDENTIALS = path.resolve(__dirname, ".auth/credentials-overdue.json");
const REPO_ROOT = path.resolve(__dirname, "..");

const BASIC_ANNUAL = "basic_annual";

test.use({ storageState: STORAGE_STATE });

let email: string;

/** Run a usage/testing:* Convex hook on the dev deployment. */
function convexTestHook(fn: string, args: Record<string, unknown>): unknown {
  const out = execFileSync(
    "npx",
    ["convex", "run", `usage/testing:${fn}`, JSON.stringify(args)],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  // `convex run` prints the function's return value (JSON) on stdout,
  // possibly surrounded by CLI noise — parse the last JSON-looking chunk.
  const lines = out.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      return JSON.parse(lines.slice(i).join("\n"));
    } catch {
      /* keep scanning upwards */
    }
  }
  return out;
}

function planCta(page: Page, productId: string) {
  return page.getByTestId(`pricing-card-cta-${productId}`);
}

const overdueDialog = (page: Page) =>
  page.getByTestId("payment-overdue-dialog");

test.describe("payment overdue dunning (live)", { tag: "@live" }, () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const creds = await signUpFreshUser(page, {
      prefix: "overdue",
      storageStatePath: STORAGE_STATE,
      credentialsPath: CREDENTIALS,
    });
    email = creds.email;
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await neutralizeTours(page);
  });

  test("trial checkout gives the account a Stripe customer", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/app/settings");
    await expect(planCta(page, BASIC_ANNUAL)).toBeVisible({ timeout: 30_000 });

    await planCta(page, BASIC_ANNUAL).click();
    await completeStripeTestCheckout(page, { email });

    await expect(async () => {
      await page.goto("/app/settings");
      await expect(planCta(page, BASIC_ANNUAL)).toHaveText(/current plan/i, {
        timeout: 5_000,
      });
    }).toPass({ timeout: 120_000, intervals: [2_000, 5_000] });
  });

  test("block is immediate and non-dismissible", async ({ page }) => {
    test.setTimeout(180_000);
    // setBillingOverride refuses while the quota doc still reports the free
    // plan — and that doc is written by BillingGate's mount sync, which can
    // lag the useCustomer-driven CTA assertion test 1 passed on (or fail
    // transiently and only be console.error'd). Each attempt loads /app
    // first so a fresh mount sync runs before the hook re-checks the doc.
    await expect(async () => {
      await page.goto("/app");
      convexTestHook("setBillingOverride", { email, planStatus: "past_due" });
    }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });

    // The override patches the quota doc directly, and every later sync
    // re-applies it — entry retried in case the first mount races it.
    await expect(async () => {
      await page.goto("/app");
      await expect(overdueDialog(page)).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });

    const dialog = overdueDialog(page);
    await expect(page.getByTestId("payment-overdue-notice")).toContainText(
      /overdue since/i,
    );

    // No grace window: no dismiss button, no close X, escape and
    // outside-clicks are swallowed.
    await expect(page.getByTestId("payment-overdue-dismiss")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /close/i })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
  });

  test("block re-shows on the next app entry despite a fresh sync", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // The reload triggers a real Autumn sync (healthy trialing customer) —
    // the override must survive it via the syncAllFeatures hook.
    await page.goto("/app");
    await expect(overdueDialog(page)).toBeVisible({ timeout: 20_000 });
  });

  test("block covers the standalone /app/learn route", async ({ page }) => {
    test.setTimeout(60_000);
    // /app/learn sits outside the (main) route group, so it used to render
    // neither the dialog nor the quota sync — a way to keep studying while
    // "blocked". Regression guard for the BillingGate mount point.
    await page.goto("/app/learn");
    await expect(overdueDialog(page)).toBeVisible({ timeout: 20_000 });
  });

  test("pay CTA opens the Stripe billing portal", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/app");
    await expect(overdueDialog(page)).toBeVisible({ timeout: 20_000 });

    // openBillingPortal redirects the current tab itself — no app-side
    // assertions after the click, just the destination.
    await page.getByTestId("payment-overdue-pay").click();
    await page.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 });
  });

  test("clearing the override restores the app", async ({ page }) => {
    test.setTimeout(60_000);
    convexTestHook("clearBillingOverride", { email });

    await page.goto("/app");
    // Entry triggers a sync; with the override gone the healthy Autumn
    // state wins and the dialog must not appear. Give the sync a moment,
    // then assert it stayed hidden.
    await page.waitForTimeout(5_000);
    await expect(overdueDialog(page)).toBeHidden();
  });
});
