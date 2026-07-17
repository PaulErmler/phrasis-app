import { test, expect } from "@playwright/test";

/**
 * Onboarding e2e coverage.
 *
 * The wizard's two main branches (default "new" + placement-test) are
 * exercised AS PART OF the auth setup in `auth.setup.ts` — each of the two
 * fixture users walks a different branch end-to-end. If either of those
 * walks regresses, every downstream spec fails fast at setup time.
 *
 * Coverage that used to live in this file as fresh-user walks now lives at:
 *   - `e2e/auth.setup.ts` — "completely-new" + "placement-test" branches.
 *   - `tests/components/onboarding/AcquisitionSourceStep.test.tsx` and
 *     `LearningGoalStep.test.tsx` — "Other" free-text inputs, char-count
 *     and over-limit behaviour.
 *   - `convex/tests/features/onboarding.test.ts` — server-side resume
 *     (saveOnboardingProgress idempotency, length guard, deck seed).
 *
 * What stays here: post-onboarding gating. The shared user `user.json` has
 * already completed onboarding, so visiting `/app/onboarding` must redirect
 * away. That's the one assertion that genuinely needs the live router.
 */
test.describe("onboarding gating", () => {
  test("already-onboarded user is redirected away from /app/onboarding", async ({
    page,
  }) => {
    await page.goto("/app/onboarding");
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    await expect
      .poll(() => /onboarding/.test(page.url()), { timeout: 10_000 })
      .toBe(false);
    expect(page.url()).toMatch(/\/app\b/);
  });
});
