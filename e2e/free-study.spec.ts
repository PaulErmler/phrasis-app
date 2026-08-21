import { test, expect, type Page } from '@playwright/test';
import { dismissConsent, dismissTour, expectSignedIn } from './helpers';

/**
 * Free Study. The writing face of free play (chromium-serial: flips the
 * shared user's review mode; restored at the end of each test).
 *
 * On home, the third start button is mode-dependent: Radio in Shadowing
 * (`data-tutorial="radio-mode"`), Free Study in Writing
 * (`data-tutorial="free-study-mode"`); both share the hasPlayableCards gate.
 * In-session, the header pill (`learn-mode-pill`) names the active face and
 * renames live when the review mode flips.
 */

async function openHome(page: Page): Promise<void> {
  await page.goto('/app');
  await expectSignedIn(page);
  await dismissConsent(page);
  await dismissTour(page, undefined, 500);
}

/** The Shadowing/Writing switcher on home (two buttons inside the toggle). */
function reviewToggleButton(page: Page, index: 0 | 1) {
  return page.locator('[data-tutorial="review-mode-toggle"] button').nth(index);
}

async function setHomeReviewMode(page: Page, mode: 'audio' | 'full') {
  const btn = reviewToggleButton(page, mode === 'audio' ? 0 : 1);
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  // The free-play button renames when the mode lands (optimistic update).
  const expected = mode === 'full' ? 'free-study-mode' : 'radio-mode';
  await expect(page.locator(`[data-tutorial="${expected}"]`)).toBeVisible({
    timeout: 8_000,
  });
}

test.describe('free study (writing face of free play)', () => {
  test.afterEach(async ({ page }) => {
    // Restore the shared fixture user for downstream specs: review mode back
    // to Shadowing, AND schedulingMode back to 'learnAndReview', starting a
    // free-play session persisted 'radio' to courseSettings, which otherwise
    // leaves the next spec's direct /app/learn visit in Radio mode with no
    // rating buttons (broke learning-journey). Clicking Learn & Review is the
    // UI path that awaits the mode write before opening the session.
    await openHome(page);
    await setHomeReviewMode(page, 'audio').catch(() => {});
    const learnBtn = page.locator('[data-tutorial="learn-and-review"]');
    await learnBtn.click({ timeout: 10_000 }).catch(() => {});
    // The overlay URL only changes after the settings mutation committed.
    await page.waitForURL(/\/app\/learn/, { timeout: 10_000 }).catch(() => {});
  });

  test('Writing mode renames the free-play button and starts a typing session', async ({
    page,
  }) => {
    await openHome(page);
    await setHomeReviewMode(page, 'full');

    const freeStudyBtn = page.locator('[data-tutorial="free-study-mode"]');
    await expect(
      freeStudyBtn,
      "Free Study button should be enabled — the fixture user's deck has playable cards",
    ).not.toHaveAttribute('aria-disabled', 'true');
    await freeStudyBtn.click();

    // Session opens on the free-study face: header pill says Free Study and
    // the writing input renders (user-paced typing, no auto-advance).
    await dismissTour(page, 'full_review_intro', 500);
    await expect(page.getByTestId('learn-mode-pill')).toContainText(
      /free study/i,
      { timeout: 20_000 },
    );
    await expect(
      page.locator('[data-tutorial="target-input-full"]').first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('flipping the review mode mid-session switches faces live', async ({
    page,
  }) => {
    await openHome(page);
    await setHomeReviewMode(page, 'full');
    await page.locator('[data-tutorial="free-study-mode"]').click();
    await dismissTour(page, 'full_review_intro', 500);
    await expect(page.getByTestId('learn-mode-pill')).toContainText(
      /free study/i,
      { timeout: 20_000 },
    );

    // Flip Shadowing/Writing from the settings sheet: the pill must rename
    // to Radio without an error or a dead-end (queue + UI follow the face).
    await page.getByTestId('learn-settings').first().click();
    const sheet = page.getByTestId('learning-settings-sheet');
    await expect(sheet).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(550);
    await page
      .getByTestId('settings-mode-audio')
      .first()
      .click({ force: true });
    await expect(page.getByTestId('learn-mode-pill')).toContainText(/radio/i, {
      timeout: 15_000,
    });
  });
});
