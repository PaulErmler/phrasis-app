import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { completeOnboardingFresh, type OnboardingWalkOptions } from "./helpers";

/**
 * Setup project — runs before every chromium spec.
 *
 * Creates exactly TWO fresh test users in a single run, each walks a different
 * onboarding-wizard branch (so the wizard's branching logic is covered as a
 * side-effect of producing the fixtures), and saves the resulting sessions to:
 *
 *   - `e2e/.auth/user.json`   — user A, default "completely-new" walk
 *       (proficiency=new, skip lesson). This is the **primary shared user**
 *       consumed by every downstream parallel + serial project — keeping
 *       the filename stable means none of those configs need to change.
 *   - `e2e/.auth/user-b.json` — user B, "placement-test" walk
 *       (proficiency=test, all-"didn't know" answers). Available as a
 *       secondary fixture for any test that wants a second account.
 *
 * Why two and not one: previously every test in `onboarding.spec.ts` signed
 * up its OWN fresh user (5 extra signups per run, 6 total). Running those in
 * parallel saturated the LLM/TTS translation queues that `completeOnboarding`
 * fans out to, causing intermittent 60s timeouts in the wizard walks. The
 * 2-user cap keeps wizard-branch coverage (default + placement-test branch)
 * while removing the parallel signup contention.
 *
 * Why two and not one (coverage side): the placement-test branch hits the
 * most distinct backend code paths (`enqueueMissingPlacementTranslations`,
 * `getPlacementSentence`, the placement question loop). The other wizard
 * variants (self-pick, "Other" goal free-text, mid-wizard reload) are
 * covered by unit/component tests — see:
 *   - tests/components/onboarding/{AcquisitionSourceStep,LearningGoalStep}.test.tsx (free-text)
 *   - convex/tests/features/onboarding.test.ts (server-side resume + idempotency)
 *
 * Both users are written serially so they don't compete for backend resources
 * during their warmup-fanout. The two `test()` calls inside this file run
 * sequentially because of `test.describe.configure({ mode: "serial" })`.
 *
 * The `home_tour` driver.js tour fires on first /app landing because the
 * onboarding wizard intentionally does NOT pre-mark it (see
 * convex/features/onboarding.ts:finalizeOnboarding). Suites that don't care
 * about the tour should call `dismissTour(page, 'home_tour')` in beforeEach.
 *
 * The wizard walker uses `data-testid` attributes exclusively — no copy
 * matching — so locale flips, copy tweaks, or language renames cannot
 * break this fixture.
 *
 * Email verification is disabled in convex/auth.ts (`requireEmailVerification:
 * false`), so the accounts are immediately usable.
 */

test.describe.configure({ mode: "serial" });

const STORAGE_STATE_A = path.resolve(__dirname, ".auth/user.json");
const STORAGE_STATE_B = path.resolve(__dirname, ".auth/user-b.json");
const CREDENTIALS_DIR = path.resolve(__dirname, ".auth");

function generateCredentials(prefix: string) {
  const random = crypto.randomBytes(6).toString("hex");
  return {
    email: `e2e-${prefix}-${Date.now()}-${random}@test.de`,
    password: `E2ePass!${random}`,
    name: `E2E ${prefix} ${random}`,
  };
}

async function fillSignUp(
  page: Page,
  creds: { email: string; password: string; name: string },
) {
  await page.goto("/auth/sign-up");
  await page.waitForLoadState("domcontentloaded");

  // The sign-up form predates this testid initiative and still uses
  // ARIA labels; signing in correctly is verified by the resulting redirect
  // to /app/onboarding (asserted below), so label-based selection is fine
  // here. All subsequent onboarding interaction is testid-driven.
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
}

async function signUpAndOnboard(
  page: Page,
  prefix: string,
  storagePath: string,
  walk: OnboardingWalkOptions,
) {
  const creds = generateCredentials(prefix);
  test.info().annotations.push({
    type: "auth",
    description: `Creating fresh test user ${creds.email} (walk=${prefix})`,
  });

  await fillSignUp(page, creds);
  await completeOnboardingFresh(page, walk);

  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  await page.context().storageState({ path: storagePath });

  fs.writeFileSync(
    path.resolve(CREDENTIALS_DIR, `credentials-${prefix}.json`),
    JSON.stringify({ ...creds, createdAt: new Date().toISOString() }, null, 2),
  );
}

test("authenticate user A (default 'completely-new' walk)", async ({ page }) => {
  // Default walk — proficiency=new, skip lesson. Exercises the most common
  // path through the wizard and produces the primary shared session.
  await signUpAndOnboard(page, "a", STORAGE_STATE_A, {});
});

test("authenticate user B (placement-test branch walk)", async ({ page }) => {
  // Placement-test branch — answers every question as "I didn't know" so the
  // strategy resolves to ~L01 deterministically. Exercises
  // `enqueueMissingPlacementTranslations`, `getPlacementSentence`, and the
  // staircase loop in one go.
  await signUpAndOnboard(page, "b", STORAGE_STATE_B, {
    proficiency: "test",
    placementAnswer: "didnt",
  });
});
