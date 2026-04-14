import { test, expect } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * Library smoke — verifies the LibraryView renders inside the app shell
 * and that there is at least one interactive control (search, filter,
 * collection toggle, …).
 */
test.describe("library", () => {
  test("library view renders with at least one interactive control", async ({
    page,
  }) => {
    await page.goto("/app/library");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    // Header label ("library" / "bibliothek") rendered by MainLayout.
    const heading = page.getByRole("heading").first();
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // The library view renders a search textbox plus filter toggles
    // (Mastered / Hidden / Favorites).
    const search = page.getByTestId("library-search").first();
    await expect(search).toBeVisible({ timeout: 15_000 });
  });
});
