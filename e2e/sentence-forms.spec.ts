import { test, expect, type Page } from '@playwright/test';
import { dismissTour, ensureTogglesSaved, neutralizeTours } from './helpers';

/**
 * The politeness setting in the course languages sheet
 * (components/course/CourseLanguageSettings.tsx): checkbox rows shown when
 * a target language marks politeness. The fixture user's course (from
 * auth.setup.ts) is Spanish-target, and Spanish splits `familiar` (tú
 * covers casual AND polite), so the two rows are CASUAL and FORMAL — the
 * polite row is the hidden one, not the formal one.
 *
 * Every persistence check goes through `ensureTogglesSaved`. The rows
 * update optimistically and `CourseLanguageSettings` fires the save without
 * awaiting it, so `aria-checked` proves nothing on its own: a reload can
 * tear down the websocket before the mutation is acked, and the write dies
 * with it. That is not hypothetical here — it failed both the assertion and
 * the restore, and the lost restore then left the shared fixture course
 * non-default, so the NEXT run started with formal already unticked and
 * failed a different line.
 *
 * The onboarding step itself is covered by the wizard walker in
 * e2e/helpers.ts, which every fresh-signup spec runs through.
 */

const POLITENESS_ROWS = '[data-testid^="politeness-"][role="checkbox"]';

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

/** Reopen the sheet after `ensureTogglesSaved` reloads the page. */
async function reopenLanguagesSheet(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await dismissTour(page, undefined, 500);
  await openLanguagesSheet(page);
}

test.describe('sentence-form settings', () => {
  test('politeness rows save and reload', async ({ page }) => {
    // Before the first navigation: a tour arming later re-covers the page
    // and its overlay eats clicks on the rows.
    await neutralizeTours(page);
    await page.goto('/app');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page, undefined, 500);
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
  // A Spanish-only target shows two rows (casual = tú, formal = usted),
  // both ticked for a course without a stored set. Unticking one keeps the
  // other; unticking the last is refused.
  const rows = page.locator(POLITENESS_ROWS);
  await expect(rows).toHaveCount(2);

  // Unticks formal and proves the SERVER kept it: clicks toward the target
  // state, reloads, reopens the sheet, re-reads, and re-issues the write if
  // the reload killed it.
  await ensureTogglesSaved(
    page,
    [
      { toggle: rows.nth(0), on: true },
      { toggle: rows.nth(1), on: false },
    ],
    { reopen: reopenLanguagesSheet },
  );

  // Unticking the LAST remaining row is refused. Purely a client guard
  // (`levels.length === 0` in CourseLanguageSettings), so this one asserts
  // on the optimistic value on purpose — there is no write to confirm.
  await page.locator(POLITENESS_ROWS).nth(0).click();
  await expect(page.locator(POLITENESS_ROWS).nth(0)).toHaveAttribute(
    'aria-checked',
    'true',
  );
}

/**
 * Every row ticked: the pre-feature behaviour. Confirmed server-side for
 * the same reason as above — a restore that only looked like it landed is
 * what leaked non-default state into the following run.
 */
async function restoreDefaults(page: Page) {
  const forms = page.getByTestId('course-forms');
  if (!(await forms.isVisible().catch(() => false))) {
    await page.goto('/app');
    await reopenLanguagesSheet(page);
    await expect(forms).toBeVisible({ timeout: 10_000 });
  }
  const rows = page.locator(POLITENESS_ROWS);
  const count = await rows.count();
  await ensureTogglesSaved(
    page,
    Array.from({ length: count }, (_, i) => ({
      toggle: rows.nth(i),
      on: true,
    })),
    { reopen: reopenLanguagesSheet },
  );
}
