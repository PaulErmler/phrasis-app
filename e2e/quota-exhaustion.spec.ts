import { test, expect, type Page } from '@playwright/test';
import {
  dismissDifficultyCheck,
  dismissErrorBoundary,
  dismissTour,
  gotoAuthedApp,
  isSelectedTestId,
} from './helpers';
import { convexRun, fixtureEmail } from './convex-hooks';

/**
 * Quota exhaustion as an ASSERTED outcome. Elsewhere in the suite a
 * drained balance is only ever an `.or()` alias for success (the
 * writing-feedback smoke) or a reason to skip — so nothing proved the
 * gates actually close. Here the shared user's local quota mirror is
 * zeroed through the E2E_TEST_HOOKS quota hook (Autumn is never touched)
 * and the writing-mode surfaces must visibly block:
 *
 *   - the mic locks and clicking it opens the limit dialog instead of
 *     recording,
 *   - a wrong answer renders the quota-limit line (never a coach card,
 *     and no LLM call is made — consumeQuota rejects first).
 *
 * The zeroed mirror lives until the next Autumn sync (page reload), so
 * every assertion runs on the SAME mounted page, and the original entries
 * are restored afterwards. chromium-serial: mutates the shared user's
 * quota doc and review mode.
 */

async function openSettingsSheet(page: Page): Promise<void> {
  await dismissErrorBoundary(page);
  await dismissDifficultyCheck(page);
  const trigger = page.getByTestId('learn-settings').first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  await expect(page.getByTestId('learning-settings-sheet').first()).toBeVisible(
    { timeout: 8_000 },
  );
  await page.waitForTimeout(550); // slide-in animation
}

async function setReviewMode(
  page: Page,
  mode: 'full' | 'audio',
): Promise<void> {
  await openSettingsSheet(page);
  const btn = page.getByTestId(`settings-mode-${mode}`).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  if (!(await isSelectedTestId(page, `settings-mode-${mode}`))) {
    await btn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, `settings-mode-${mode}`), {
        timeout: 8_000,
      })
      .toBe(true);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

test.describe.configure({ mode: 'serial', retries: 0 });
test.describe('quota exhaustion surfaces', () => {
  let zeroedPrevious: unknown = null;

  test.afterEach(async ({ page }) => {
    if (zeroedPrevious !== null) {
      convexRun('features/quotaTesting:restoreFeatureBalances', {
        email: fixtureEmail(),
        previous: zeroedPrevious,
      });
      zeroedPrevious = null;
    }
    await dismissTour(page).catch(() => {});
    await setReviewMode(page, 'audio').catch(() => {});
  });

  test('zeroed balances visibly block the writing-mode surfaces', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = fixtureEmail();

    await gotoAuthedApp(
      page,
      '/app/learn',
      page.getByTestId('learn-settings').first(),
    );
    await dismissTour(page, 'audio_review_intro', 500);
    await dismissTour(page, 'full_review_intro', 500);
    await setReviewMode(page, 'full');
    await dismissTour(page, 'full_review_intro', 500);

    const input = page.getByTestId('learn-translation-input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });

    // Zero AFTER the page mounted (the mount's own quota sync already ran;
    // the patch flips the reactive UI live, no reload involved).
    zeroedPrevious = convexRun('features/quotaTesting:zeroFeatureBalances', {
      email,
      featureIds: ['ai_feedback', 'transcriptions'],
    });

    // --- Mic locks. Wait for the lock icon so the click can't start a
    // real recording during the reactive flip, then expect the limit
    // dialog rather than the recording state.
    const mic = page.getByTestId('writing-voice-button').first();
    await expect(mic).toBeVisible({ timeout: 15_000 });
    await expect(mic.locator('svg.lucide-lock').first()).toBeVisible({
      timeout: 15_000,
    });
    await mic.click();
    await expect(page.getByRole('dialog').first()).toBeVisible({
      timeout: 10_000,
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5_000 });

    // --- A wrong answer hits the quota gate BEFORE any LLM call: the
    // limit line renders with its upgrade CTA, and no coach card ever
    // appears.
    await input.fill('this quota-test answer is wrong on purpose');
    await page.getByTestId('learn-submit-translation').first().click();
    await expect(
      page.getByTestId('writing-feedback-limit').first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('writing-feedback-upgrade').first(),
    ).toBeVisible();
    await expect(page.getByTestId('writing-feedback-card')).toHaveCount(0);

    // --- Restore and prove the mirror is back to its pre-test state.
    const restoredTo = zeroedPrevious as Record<
      string,
      { balance: number } | null
    >;
    convexRun('features/quotaTesting:restoreFeatureBalances', {
      email,
      previous: zeroedPrevious,
    });
    zeroedPrevious = null;
    const expected = restoredTo['ai_feedback'];
    const balance = convexRun('features/quotaTesting:readFeatureBalance', {
      email,
      featureId: 'ai_feedback',
    });
    expect(balance).toBe(expected ? expected.balance : null);
  });
});
