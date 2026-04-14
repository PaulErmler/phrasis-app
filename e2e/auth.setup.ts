import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Setup project — runs before every chromium spec.
 *
 * Strategy: each run creates a BRAND NEW test user, completes onboarding,
 * and saves the resulting session to e2e/.auth/user.json. This means:
 *   - no stale cookies
 *   - onboarding is exercised on every full run
 *   - no shared state between runs (except accumulated rows in the dev DB)
 *
 * Email verification is disabled in convex/auth.ts (`requireEmailVerification:
 * false`), so the account is immediately usable.
 *
 * Cleanup: the project has no delete-account endpoint. Test users pile up in
 * the dev backend; accept that or add a cleanup mutation later.
 */

const STORAGE_STATE = path.resolve(__dirname, ".auth/user.json");

function generateCredentials() {
  const random = crypto.randomBytes(6).toString("hex");
  return {
    email: `e2e-${Date.now()}-${random}@test.de`,
    password: `E2ePass!${random}`,
    name: `E2E User ${random}`,
  };
}

async function fillSignUp(
  page: Page,
  creds: { email: string; password: string; name: string },
) {
  await page.goto("/auth/sign-up");
  await page.waitForLoadState("domcontentloaded");

  // Better Auth UI labels fields by their human names. `name` is optional
  // depending on config — fill if present.
  const nameField = page.getByLabel(/^name$/i);
  if (await nameField.count()) {
    await nameField.first().fill(creds.name);
  }
  await page.getByLabel(/email/i).first().fill(creds.email);

  // There are usually two password fields (password + confirm). Fill all.
  const passwordFields = page.getByLabel(/password/i);
  const passwordCount = await passwordFields.count();
  for (let i = 0; i < passwordCount; i++) {
    await passwordFields.nth(i).fill(creds.password);
  }

  // Dismiss the cookie-consent dialog if present — it can intercept clicks.
  const acceptCookies = page.getByRole("button", { name: /accept all/i });
  if (await acceptCookies.count()) {
    await acceptCookies.first().click().catch(() => {});
  }

  await page
    .getByRole("button", { name: /create an account|create account|^sign\s*up$/i })
    .click();

  // After sign-up the app redirects to /app/onboarding (see
  // app/auth/[path]/page.tsx `redirectTo="/app/onboarding"`).
  await page.waitForURL(/\/app\/onboarding/, { timeout: 30_000 });
}

async function completeOnboarding(page: Page) {
  // Step 1 — target language. Any available language works; pick Spanish
  // because it's near-universally enabled in lib/languages.
  await page
    .getByRole("button", { name: /spanish|español/i })
    .first()
    .click();
  await page.getByRole("button", { name: /continue/i }).click();

  // Step 2 — base language. Pick English.
  // Accessible name looks like "🇬🇧 English English" (flag + name + native).
  // Match substring, avoid "American English" variants if present.
  await page
    .getByRole("button", { name: /(?<!american\s)English/i })
    .first()
    .click();
  await page.getByRole("button", { name: /continue/i }).click();

  // Step 3 — current level. Beginner.
  await page
    .getByRole("button", { name: /beginner/i })
    .first()
    .click();
  await page.getByRole("button", { name: /continue/i }).click();

  // Step 4 — review mode. Pick Full Review (typing) because it requires
  // the least device permission setup.
  await page
    .getByRole("button", { name: /full\s*review/i })
    .first()
    .click();
  await page.getByRole("button", { name: /continue/i }).click();

  // Step 5 — "Start Learning" finalizes onboarding and redirects to /app.
  await page
    .getByRole("button", { name: /start\s*learning/i })
    .click({ timeout: 30_000 });

  await page.waitForURL(
    (url) => /\/app(\/|$)/.test(url.pathname) && !/onboarding/.test(url.pathname),
    { timeout: 30_000 },
  );
}

test("authenticate", async ({ page }) => {
  const creds = generateCredentials();
  test.info().annotations.push({
    type: "auth",
    description: `Creating fresh test user ${creds.email}`,
  });

  await fillSignUp(page, creds);
  await completeOnboarding(page);

  // Sanity check: we're on the authed shell.
  await expect(page).toHaveURL(/\/app/);

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });

  // Stash creds alongside for anyone debugging a failure. Git-ignored.
  fs.writeFileSync(
    path.resolve(__dirname, ".auth/credentials.json"),
    JSON.stringify({ ...creds, createdAt: new Date().toISOString() }, null, 2),
  );
});
