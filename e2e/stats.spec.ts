import { test, expect } from "@playwright/test";

/**
 * Stats smoke — visits /app/stats and verifies that either a chart or the
 * empty-state mounts. Charts are rendered with Recharts/SVG, so we look
 * for an svg or a "no data" copy.
 */
test.describe("stats", () => {
  test("stats view renders charts or empty state", async ({ page }) => {
    await page.goto("/app/stats");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading").first();
    await expect(heading).toBeVisible({ timeout: 15_000 });

    const chart = page.locator("svg").first();
    const empty = page
      .getByText(/no data|nothing to show|noch keine|keine daten/i)
      .first();

    await expect(async () => {
      const visible =
        (await chart.isVisible().catch(() => false)) ||
        (await empty.isVisible().catch(() => false));
      expect(visible).toBe(true);
    }).toPass({ timeout: 20_000 });
  });
});
