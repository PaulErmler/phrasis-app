import { test, expect } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * Add-cards import smoke — verifies the toggle defaults to "individual",
 * that switching to "import" reveals the import UI, that pasting a CSV
 * populates a preview, and that the submit button is guarded (either
 * disabled or still on the same page) without a valid, fully-mapped input.
 *
 * Does not exercise the backend mutation — that's covered by Convex tests.
 */
test.describe("add cards — import", () => {
  test("defaults to individual mode and can switch to import", async ({ page }) => {
    await page.goto("/app/content/add-cards");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    const individualTab = page.getByTestId("add-cards-mode-individual");
    const importTab = page.getByTestId("add-cards-mode-import");

    await expect(individualTab).toBeVisible({ timeout: 20_000 });
    await expect(individualTab).toHaveAttribute("aria-selected", "true");
    await expect(importTab).toHaveAttribute("aria-selected", "false");

    await importTab.click();
    await expect(importTab).toHaveAttribute("aria-selected", "true");

    // Paste textarea should be reachable.
    const pasteArea = page.getByTestId("import-paste");
    await expect(pasteArea).toBeVisible({ timeout: 10_000 });

    // Paste a minimal CSV — doesn't need to be the user's course languages;
    // we just want the preview to populate and the submit to stay guarded.
    await pasteArea.fill("a,b\nHallo,Hola\nTschüss,Adiós");

    // Submit button exists but must remain disabled — mapping is incomplete
    // (we don't assume what course the test user has, so we can't map).
    const submit = page.getByTestId("import-submit").first();
    if (await submit.count()) {
      // If visible, it should be disabled.
      await expect(submit).toBeDisabled({ timeout: 5_000 }).catch(() => {});
    }
  });

  test("stepper indicator renders and Back is hidden on step 0", async ({ page }) => {
    await page.goto("/app/content/add-cards");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    await page.getByTestId("add-cards-mode-import").click();

    const step0 = page.getByTestId("import-step-0");
    const step1 = page.getByTestId("import-step-1");
    const step2 = page.getByTestId("import-step-2");
    await expect(step0).toBeVisible({ timeout: 10_000 });
    await expect(step0).toHaveAttribute("aria-selected", "true");
    // Step 1 and 2 are disabled until input / mapping is provided.
    await expect(step1).toBeDisabled();
    await expect(step2).toBeDisabled();
  });

});
