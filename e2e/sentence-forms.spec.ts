import { test, expect, type Page } from '@playwright/test';
import { dismissTour } from './helpers';

/**
 * The politeness setting in the course languages sheet
 * (components/course/CourseLanguageSettings.tsx): checkbox rows shown when
 * a target language marks politeness. The fixture user's course (from
 * auth.setup.ts) is German-target, so two politeness rows show and the
 * third global level stays hidden. The rows update optimistically, so the
 * tick follows the click before the server answers.
 *
 * The onboarding step itself is covered by the wizard walker in
 * e2e/helpers.ts, which every fresh-signup spec runs through.
 */

async function openLanguagesSheet(page: Page) {
  const sheet = page.getByRole('dialog', { name: /your courses/i }).first();
  if (!(await sheet.isVisible().catch(() => false))) {
    await page.getByTestId('course-menu-trigger').first().click();
    await expect(sheet).toBeVisible({ timeout: 5_000 });
  }
  await page.getByTestId('course-settings').first().click();
  const manageSheet = page.getByTestId('course-settings-sheet').first();
  await expect(manageSheet).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(550); // slide-in
  return manageSheet;
}

test.describe('sentence-form settings', () => {
  test('politeness rows save and reload', async ({ page }) => {
    await page.goto('/app');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page);
    await openLanguagesSheet(page);

    const forms = page.getByTestId('course-forms');
    await expect(forms).toBeVisible({ timeout: 10_000 });

    // Restore the defaults whatever happens above, so a failing assertion
    // cannot leave the shared fixture course with non-default settings for
    // the specs that run after this one.
    try {
      await exerciseForms(page);
    } finally {
      await restoreDefaults(page);
    }
  });
});

async function exerciseForms(page: Page) {
  // A German-only target shows two rows (casual = du, polite = Sie), both
  // ticked for a course without a stored set. Unticking one keeps the
  // other; unticking the last is refused.
  const rows = page.locator('[data-testid^="politeness-"][role="checkbox"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'false', {
    timeout: 10_000,
  });
  await rows.nth(0).click();
  await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');

  // Survives a reload: the values come back from the server.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await dismissTour(page);
  await openLanguagesSheet(page);
  await expect(
    page.locator('[data-testid^="politeness-"][role="checkbox"]').nth(1),
  ).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 });
}

/** Every row ticked: the pre-feature behaviour. */
async function restoreDefaults(page: Page) {
  const forms = page.getByTestId('course-forms');
  if (!(await forms.isVisible().catch(() => false))) {
    await page.goto('/app');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page);
    await openLanguagesSheet(page);
    await expect(forms).toBeVisible({ timeout: 10_000 });
  }
  const rows = page.locator('[data-testid^="politeness-"][role="checkbox"]');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    if ((await rows.nth(i).getAttribute('aria-checked')) !== 'true') {
      await rows.nth(i).click();
      await expect(rows.nth(i)).toHaveAttribute('aria-checked', 'true', {
        timeout: 10_000,
      });
    }
  }
}
