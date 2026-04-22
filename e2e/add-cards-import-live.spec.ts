import { test, expect } from "@playwright/test";
import { dismissTour, openCardImport, pasteImport } from "./helpers";

/**
 * Live end-to-end test for the card batch-import mutation.
 *
 * Runs against the real Convex backend: imports exactly 3 cards with a
 * unique marker, then verifies they show up in the library. Tagged @live
 * because it mutates shared user state (adds cards to the test user's deck).
 *
 * Retries disabled — the marker in the first cell changes per run so a
 * retry would create a second batch.
 */

test.describe.configure({ mode: "serial", retries: 0 });
test.describe("add cards — import (live)", { tag: "@live" }, () => {
  test("imports 3 cards and surfaces them in the library", async ({ page }) => {
    const marker = `e2eImport${Date.now().toString(36)}`;

    await openCardImport(page);
    await pasteImport(
      page,
      [
        "English,Spanish",
        `${marker} hello,Hola ${marker}`,
        `${marker} goodbye,Adiós ${marker}`,
        `${marker} thanks,Gracias ${marker}`,
      ].join("\n"),
    );

    // Step 1: auto-mapping should pick up English + Spanish headers
    await page.getByTestId("import-next").click();
    await expect(page.getByTestId("import-mapping-en")).toContainText(
      /english/i,
    );
    await expect(page.getByTestId("import-mapping-es")).toContainText(
      /spanish/i,
    );

    // Step 2: 3 valid rows, submit enabled. There are two `import-submit`
    // buttons on this step (SummaryBar at top, stepper primary at bottom) —
    // both trigger the same confirm dialog; use the first consistently.
    await page.getByTestId("import-next").click();
    const submit = page.getByTestId("import-submit").first();
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await expect(submit).toContainText(/import 3 cards/i);

    await submit.click();

    // Confirm dialog → Import
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("import-confirm").click();

    // Wait for the submission to settle — the submit button re-enables or
    // the user is navigated back to the content hub. Don't rely on the toast
    // (sonner auto-dismisses inside a few seconds, flaky to catch).
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // Verify the 3 cards show up in the library via the unique marker.
    await page.goto("/app/library");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    const search = page.getByTestId("library-search").first();
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill(marker);

    const cards = page.getByTestId("library-card");
    await expect
      .poll(async () => cards.count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);
  });
});
