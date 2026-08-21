import { test, expect, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * Course management. Archive an existing course, then create a new one.
 *
 * Order matters because the app enforces: a new course can only be
 * created when NO other course is active. So we archive first to free
 * the slot, then create.
 *
 * State is unpredictable on entry, by the time course-management runs,
 * earlier specs (and Convex quota sync, see convex/usage/helpers.ts:251)
 * may already have archived the onboarding Spanish course. Each test
 * detects current state and adapts:
 *   - archive: unarchives a course first if none is active, then archives
 *   - create:  archives any remaining active course first, then creates
 */

test.describe.configure({ mode: "serial" });

async function openCourseMenu(page: Page): Promise<void> {
  // The "Your Courses" sheet may already be open (the app routes here
  // automatically when no active course exists, and an earlier test may
  // have left it open). Detect that and skip the trigger click.
  const sheet = page
    .getByRole("dialog", { name: /your courses/i })
    .first();
  if (await sheet.isVisible().catch(() => false)) return;

  const trigger = page.getByTestId("course-menu-trigger").first();
  await expect(
    trigger,
    "course-menu-trigger should render on /app home",
  ).toBeVisible({ timeout: 10_000 });
  await trigger.click();

  await expect(
    sheet,
    "Your Courses sheet should open after clicking course-menu-trigger",
  ).toBeVisible({ timeout: 5_000 });
}

async function closeCourseMenu(page: Page) {
  await page.keyboard.press("Escape").catch(() => {});
  const sheet = page
    .getByRole("dialog", { name: /your courses/i })
    .first();
  await sheet.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
}

/**
 * Archives the first active course (the one whose row has a
 * `course-settings` icon). Returns false if there was no active course
 * to archive (caller must decide whether to skip or fail).
 */
async function archiveTopActiveCourse(page: Page): Promise<boolean> {
  const settingsIcon = page.getByTestId("course-settings").first();
  if (!(await settingsIcon.isVisible().catch(() => false))) return false;
  await settingsIcon.click();

  const manageSheet = page.getByTestId("course-settings-sheet").first();
  await expect(manageSheet).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(550); // wait out slide-in

  const archiveBtn = page.getByTestId("course-archive").first();
  await expect(archiveBtn).toBeVisible({ timeout: 5_000 });
  await archiveBtn.click({ force: true });

  const confirmBtn = page.getByTestId("course-confirm-archive").first();
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click({ force: true });
  }

  await manageSheet.waitFor({ state: "hidden", timeout: 10_000 });
  return true;
}

test.describe("course management", () => {
  test("archive a course", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    await openCourseMenu(page);

    // Ensure there's an active course to archive. If everything is already
    // archived (Convex auto-archive may have fired), unarchive one first
    // so the archive flow has a deterministic target.
    const settingsIcon = page.getByTestId("course-settings").first();
    if (!(await settingsIcon.isVisible().catch(() => false))) {
      const unarchiveBtn = page
        .getByRole("button", { name: /unarchive/i })
        .first();
      await expect(
        unarchiveBtn,
        "User should have at least one course (active or archived)",
      ).toBeVisible({ timeout: 5_000 });
      await unarchiveBtn.click();
      // Confirm dialog if present.
      const confirm = page
        .getByRole("button", { name: /^(unarchive|confirm|yes|ok)$/i })
        .first();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
      }
      // Wait for the row to flip from archived → active.
      await expect(
        page.getByTestId("course-settings").first(),
      ).toBeVisible({ timeout: 10_000 });
    }

    const rowsBefore = await page.getByTestId("course-menu-entry").count();
    const archived = await archiveTopActiveCourse(page);
    expect(archived, "Should have archived an active course").toBe(true);

    await closeCourseMenu(page);
    await openCourseMenu(page);

    // Verify: an Unarchive button exists OR active row count decreased.
    const unarchive = page.getByRole("button", { name: /unarchive/i }).first();
    const rowsAfter = await page.getByTestId("course-menu-entry").count();
    const archivedOk =
      (await unarchive.isVisible().catch(() => false)) ||
      rowsAfter < rowsBefore;
    expect(
      archivedOk,
      "After archive, an Unarchive button should appear or the active row count should decrease",
    ).toBe(true);
  });

  test("create a new course", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    await openCourseMenu(page);

    // Precondition: no active course allowed. Archive any that remain.
    while (
      await page
        .getByTestId("course-settings")
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await archiveTopActiveCourse(page);
      await closeCourseMenu(page);
      await openCourseMenu(page);
    }

    const createBtn = page.getByTestId("course-menu-create").first();
    await expect(
      createBtn,
      "course-menu-create should be visible once no other courses are active",
    ).toBeVisible({ timeout: 8_000 });
    await createBtn.click();

    // Step 1: target language. Use testids. `language-option-<code>` is
    // attached to every CommandItem inside the shared LanguageSelector.
    const french = page.getByTestId("language-option-fr").first();
    const italian = page.getByTestId("language-option-it").first();
    let targetLang = "";
    let targetCode = "";
    if (await french.isVisible().catch(() => false)) {
      await french.click();
      targetLang = "french";
      targetCode = "fr";
    } else {
      await expect(
        italian,
        "Create-course dialog should offer at least one of French or Italian",
      ).toBeVisible({ timeout: 5_000 });
      await italian.click();
      targetLang = "italian";
      targetCode = "it";
    }
    await page.getByTestId("course-dialog-next").first().click();

    // Step 2: base language. English.
    const english = page.getByTestId("language-option-en").first();
    if (await english.isVisible().catch(() => false)) {
      await english.click();
    }
    await page.getByTestId("course-dialog-next").first().click();

    // Step 3: level.
    await page.getByRole("button", { name: /beginner/i }).first().click();
    await page.getByTestId("course-dialog-next").first().click();

    // Step 4: daily goal + create.
    await page.getByTestId("course-dialog-goal-20").first().click();
    await page.getByTestId("course-dialog-create").first().click();

    await expect(async () => {
      const onLearn = /\/app\/learn/.test(page.url());
      // After course creation, the course menu list (still mounted at this
      // point in the flow) gets a new entry tagged with its target language
      // via `data-target-language=<code>`. Look for it deterministically.
      const courseRow = page
        .locator(`[data-testid="course-menu-entry"][data-target-language="${targetCode}"]`)
        .first();
      const rowVisible = await courseRow.isVisible().catch(() => false);
      const fallbackByName = page
        .getByRole("button", { name: new RegExp(targetLang, "i") })
        .first();
      const fallbackVisible = await fallbackByName.isVisible().catch(() => false);
      expect(onLearn || rowVisible || fallbackVisible).toBe(true);
    }).toPass({ timeout: 30_000 });
  });
});
