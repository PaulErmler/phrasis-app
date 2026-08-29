import { test, expect, type Page } from '@playwright/test';
import {
  dismissDifficultyCheck,
  dismissErrorBoundary,
  dismissTour,
  gotoAuthedApp,
  isSelectedTestId,
} from './helpers';

/**
 * Writing-mode AI feedback smoke (live): submit a deliberately wrong answer
 * and watch the full pipeline — kick-off effect → gradeWritingAnswer →
 * coach card — light up against the real backend and grader.
 *
 * chromium-serial: flips the shared user's review mode to Writing and back.
 *
 * The terminal state is grader-dependent: a verdict chip (the coach card)
 * on a normal run, or the quota-limit line if the shared user's ai_feedback
 * balance has been drained by earlier runs. Both prove the pipeline is
 * alive end to end; only the ERROR path renders nothing — and that is
 * exactly the regression this smoke exists to catch, because the coach
 * card's error state is deliberately invisible in the UI.
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

test.describe(
  'writing feedback — grader smoke (live)',
  { tag: '@live' },
  () => {
    test.beforeEach(async ({ page }) => {
      await gotoAuthedApp(
        page,
        '/app/learn',
        page.getByTestId('learn-settings').first(),
      );
      await dismissTour(page, 'audio_review_intro', 500);
      await dismissTour(page, 'full_review_intro', 500);
      await setReviewMode(page, 'full');
    });

    test.afterEach(async ({ page }) => {
      // Leave the shared user the way the other serial specs expect it.
      await dismissTour(page).catch(() => {});
      await setReviewMode(page, 'audio').catch(() => {});
    });

    test('a wrong answer produces grader feedback (or the quota line)', async ({
      page,
    }) => {
      await dismissTour(page, 'full_review_intro', 500);
      const input = page.getByTestId('learn-translation-input').first();
      await expect(input).toBeVisible({ timeout: 15_000 });

      await input.fill('this answer is deliberately wrong');
      await page.getByTestId('learn-submit-translation').first().click();

      // The kick-off effect fires: pending skeleton first…
      await expect(
        page.getByTestId('writing-feedback-pending').first(),
      ).toBeVisible({ timeout: 10_000 });

      // …then a terminal row. Card = graded verdict; limit = quota drained.
      // Nothing at all = the silent error path, which fails the smoke.
      await expect(
        page
          .getByTestId('writing-feedback-card')
          .or(page.getByTestId('writing-feedback-limit'))
          .first(),
      ).toBeVisible({ timeout: 30_000 });
    });
  },
);
