import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { fetchAuthEmail } from "./helpers";

/**
 * Email/password auth journey — code-based email verification, password
 * reset, per-address email rate limiting, and enumeration safety. Uses its
 * OWN fresh user (never the shared fixtures) and runs serially: later
 * tests depend on the auth state and email budget earlier tests establish.
 *
 * Requires E2E_TEST_HOOKS=1 on the dev deployment (set for the run by
 * global-setup.ts): auth emails are then captured into the
 * `testAuthEmails` table instead of being sent (convex/lib/authEmails.ts),
 * and `fetchAuthEmail` reads the codes/links back via `pnpm exec convex run`.
 *
 * ORDERING IS SIGNIFICANT for the rate-limit test: the `authEmail` bucket
 * (convex/rateLimiter.ts) holds 5 tokens per address per hour. The journey
 * spends 3 — sign-up code (#1), unverified sign-in re-send (#2),
 * forgot-password link (#3) — and the rate-limit test spends the remaining
 * 2 before asserting the 6th request sends nothing.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", retries: 0 });

const random = crypto.randomBytes(6).toString("hex");
const creds = {
  email: `e2e-emailauth-${Date.now()}-${random}@flexling.com`,
  password: `E2ePass!${random}`,
  newPassword: `E2eNewPass!${random}`,
  name: `E2E emailauth ${random}`,
};

// Captured-email state, threaded between tests so polls can tell a fresh
// email apart from the previous one.
let lastVerifyId: string;
let lastOtp: string;
let lastResetId: string;

const verificationPath = () =>
  `/auth/email-verification?email=${encodeURIComponent(creds.email)}`;

/** Dismiss the PostHog consent banner if it mounts (copy is localized). */
async function acceptCookiesIfShown(page: Page) {
  const acceptCookies = page.getByTestId("consent-accept").first();
  await acceptCookies
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => acceptCookies.click())
    .catch(() => {}); // no banner: PostHog key absent or already answered
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth/sign-in");
  await page.waitForLoadState("domcontentloaded");
  await acceptCookiesIfShown(page);
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  // Anchored so it can never collide with the "Sign in with Google/Apple"
  // social buttons (see auth.spec.ts).
  await page.getByRole("button", { name: /^(login|log in|sign in)$/i }).click();
}

/** The single hidden input rendered by input-otp; filling 6 digits auto-submits. */
const otpInput = (page: Page) => page.locator("input[data-input-otp]");

test.describe("email/password auth journey", () => {
  test("sign-up routes to code entry and creates no session", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await page.waitForLoadState("domcontentloaded");
    await acceptCookiesIfShown(page);

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
    await page
      .getByRole("button", { name: /create an account|create account|^sign\s*up$/i })
      .click();

    // better-auth-ui routes to the code-entry view; a 6-digit code email
    // is captured (email #1).
    await page.waitForURL(/\/auth\/email-verification/, { timeout: 30_000 });
    const captured = await fetchAuthEmail(creds.email, "verify");
    lastVerifyId = captured.id;
    expect(captured.otp).toMatch(/^\d{6}$/);
    lastOtp = captured.otp!;

    // No session yet: the app redirects a logged-out visitor to sign-in.
    await page.goto("/app");
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 });
  });

  test("unverified sign-in re-sends the code and routes to code entry", async ({ page }) => {
    await signIn(page, creds.email, creds.password);

    // 403 EMAIL_NOT_VERIFIED — better-auth-ui navigates to the code-entry
    // view; sendOnSignIn re-sends the code (email #2 — same 6 digits as
    // #1, resendStrategy 'reuse' in convex/auth.ts).
    await page.waitForURL(/\/auth\/email-verification/, { timeout: 30_000 });
    const resent = await fetchAuthEmail(creds.email, "verify", {
      afterId: lastVerifyId,
    });
    lastVerifyId = resent.id;
    expect(resent.otp).toMatch(/^\d{6}$/);
    lastOtp = resent.otp!;
  });

  test("wrong code is rejected, correct code signs the user in", async ({ page }) => {
    await page.goto(verificationPath());
    await page.waitForLoadState("domcontentloaded");
    await acceptCookiesIfShown(page);

    const wrongCode = lastOtp === "000000" ? "111111" : "000000";
    await otpInput(page).fill(wrongCode);
    await expect(page.getByText(/invalid|incorrect/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/auth\/email-verification/);

    // Correct code verifies AND signs in (autoSignInAfterVerification),
    // landing on onboarding.
    await otpInput(page).fill(lastOtp);
    await page.waitForURL(/\/app\/onboarding/, { timeout: 30_000 });
  });

  test("forgot password resets via the emailed link", async ({ page }) => {
    await page.goto("/auth/forgot-password");
    await page.waitForLoadState("domcontentloaded");
    await acceptCookiesIfShown(page);
    await page.getByLabel(/email/i).first().fill(creds.email);
    await page.getByRole("button", { name: /forgot|reset|send/i }).click();

    // Email #3. Better Auth carries the token in the path:
    // /api/auth/reset-password/<token>?callbackURL=...
    const reset = await fetchAuthEmail(creds.email, "reset");
    lastResetId = reset.id;
    expect(reset.url).toMatch(/\/reset-password\/[^/?]+/);

    await page.goto(reset.url!);
    await page.waitForURL(/\/auth\/reset-password/, { timeout: 15_000 });
    const passwordFields = page.getByLabel(/password/i);
    const passwordCount = await passwordFields.count();
    for (let i = 0; i < passwordCount; i++) {
      await passwordFields.nth(i).fill(creds.newPassword);
    }
    await page
      .getByRole("button", { name: /save new password|reset password/i })
      .click();
    // better-auth-ui returns to sign-in after a successful reset.
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 });

    // Old password rejected (the account is verified now, so a failed
    // sign-in consumes no verification email).
    await signIn(page, creds.email, creds.password);
    await expect(page.getByText(/invalid|incorrect/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/auth\/sign-in/);

    // New password works.
    await signIn(page, creds.email, creds.newPassword);
    await page.waitForURL(/\/app/, { timeout: 30_000 });
  });

  test("6th auth email within the hour is rate-limited but UI stays generic", async ({ page }) => {
    // The journey so far spent 3 of the 5 hourly tokens; burn the
    // remaining 2 with real sends first.
    for (let i = 0; i < 2; i++) {
      await page.goto("/auth/forgot-password");
      await page.waitForLoadState("domcontentloaded");
      await acceptCookiesIfShown(page);
      await page.getByLabel(/email/i).first().fill(creds.email);
      await page.getByRole("button", { name: /forgot|reset|send/i }).click();
      const sent = await fetchAuthEmail(creds.email, "reset", {
        afterId: lastResetId,
      });
      lastResetId = sent.id;
    }

    await page.goto("/auth/forgot-password");
    await page.waitForLoadState("domcontentloaded");
    await acceptCookiesIfShown(page);
    await page.getByLabel(/email/i).first().fill(creds.email);
    await page.getByRole("button", { name: /forgot|reset|send/i }).click();

    // The endpoint still reports success (silent drop in convex/auth.ts) —
    // no error toast — but no new email is captured.
    await expect(page.getByText(/error|failed/i)).toHaveCount(0);
    await expect(
      fetchAuthEmail(creds.email, "reset", {
        afterId: lastResetId,
        timeoutMs: 8_000,
      }),
    ).rejects.toThrow(/No reset auth email/);
  });

  test("invalid reset token shows an error", async ({ page }) => {
    await page.goto("/auth/reset-password?token=invalid-token");
    await page.waitForLoadState("domcontentloaded");
    await acceptCookiesIfShown(page);
    const passwordFields = page.getByLabel(/password/i);
    const passwordCount = await passwordFields.count();
    for (let i = 0; i < passwordCount; i++) {
      await passwordFields.nth(i).fill(creds.newPassword);
    }
    await page
      .getByRole("button", { name: /save new password|reset password/i })
      .click();
    await expect(page.getByText(/invalid|expired/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("forgot password for an unknown address leaks nothing", async ({ page }) => {
    const unknown = `e2e-nobody-${Date.now()}-${random}@flexling.com`;
    await page.goto("/auth/forgot-password");
    await page.waitForLoadState("domcontentloaded");
    await acceptCookiesIfShown(page);
    await page.getByLabel(/email/i).first().fill(unknown);
    await page.getByRole("button", { name: /forgot|reset|send/i }).click();

    // Same generic outcome as for a real account, and no email captured.
    await expect(page.getByText(/not found|no account|unknown/i)).toHaveCount(0);
    await expect(
      fetchAuthEmail(unknown, "reset", { timeoutMs: 8_000 }),
    ).rejects.toThrow(/No reset auth email/);
  });
});
