import { test, expect } from "@playwright/test";

/**
 * Content-source filter — smoke tests for the SegmentedHomeSection tab
 * badges and the home dropdown.
 */

test.describe("content filter — tab badges on home", () => {
  test("neither tab shows an Off badge when filter is 'both' (default)", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");

    // SegmentedHomeSection only renders the "Off" pill for an excluded
    // source. Default filter = 'both' → no Off badges anywhere.
    // Wait for the tab list to mount before asserting count. 20s (not 10s):
    // this is the first test in the file, so it pays the cold Next-dev
    // compile of /app plus the preloaded-query round trip, and under
    // parallel workers that has overrun 10s.
    await expect(
      page.getByRole("tab", { name: /Course|Kurs/ }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("source-badge-off")).toHaveCount(0);
  });
});

test.describe("content filter — subtle dropdown on home", () => {
  test("dropdown renders with the default value visible", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("content-filter-trigger")).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("due-count pills on home", () => {
  test("filter-aware pills render next to the content filter", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    // Pills render once getFilteredCardCounts resolves (even all-zero counts
    // return an object). They share a row with the filter dropdown.
    await expect(page.getByTestId("due-counts-pills")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("content-filter-trigger")).toBeVisible();
  });
});
