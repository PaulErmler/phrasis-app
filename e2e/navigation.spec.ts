import { test, expect } from "@playwright/test";
import { dismissErrorBoundary, dismissTour } from "./helpers";

/**
 * Crossing-navigation smoke — exercises the bottom nav inside the authed
 * shell to verify the route-driven view switching wired up in MainLayout
 * still works end-to-end.
 */
test.describe("authed navigation shell", () => {
  test("can move between home, library, stats, settings", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    // Testid-based selection — accessible-name regexes were catching
    // hero/CTA buttons like "Start lesson" before they reached the
    // bottom-nav "Home" button.
    const targets: Array<{ view: 'library' | 'stats' | 'settings' | 'home'; urlFragment: RegExp }> = [
      { view: 'library', urlFragment: /\/app\/library/ },
      { view: 'stats', urlFragment: /\/app\/stats/ },
      { view: 'settings', urlFragment: /\/app\/settings/ },
      { view: 'home', urlFragment: /\/app(\/?$|\/?\?)/ },
    ];

    for (const t of targets) {
      // Under parallel-phase load a view query can hit Convex's 1s execution
      // cap and crash the mounted view into its error boundary; the nav
      // shell lives outside the boundary, but recover the view anyway so a
      // crashed segment can't leave the shell in a weird state. First
      // compiles of a route under a busy dev server can also push past 10s,
      // hence the 20s ceilings.
      await dismissErrorBoundary(page);
      const button = page.getByTestId(`bottom-nav-${t.view}`);
      await expect(button).toBeVisible({ timeout: 20_000 });
      await button.click();
      await expect(page).toHaveURL(t.urlFragment, { timeout: 20_000 });
    }
  });

  test("browser back/forward preserves view after BottomNav navigation", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    // Library via BottomNav
    await page.getByTestId("bottom-nav-library").click();
    await expect(page).toHaveURL(/\/app\/library/, { timeout: 10_000 });
    await expect(page.getByTestId("library-search").first()).toBeVisible({ timeout: 10_000 });

    // Browser back to /app
    await page.goBack();
    await expect(page).toHaveURL(/\/app(\/?$|\/?\?)/, { timeout: 10_000 });
    await expect(page.getByTestId("course-menu-trigger").first()).toBeVisible({ timeout: 10_000 });

    // Browser forward to /app/library
    await page.goForward();
    await expect(page).toHaveURL(/\/app\/library/, { timeout: 10_000 });
    await expect(page.getByTestId("library-search").first()).toBeVisible({ timeout: 10_000 });
  });

  test("home collections render after back/forward", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    // The SegmentedHomeSection renders the CEFR tablist on /app.
    await expect(page.getByRole("tablist").first()).toBeVisible({ timeout: 15_000 });

    // /app → /app/library
    await page.getByTestId("bottom-nav-library").click();
    await expect(page).toHaveURL(/\/app\/library/, { timeout: 10_000 });
    await expect(page.getByTestId("library-search").first()).toBeVisible({ timeout: 10_000 });

    // /app/library → /app/stats
    await page.getByTestId("bottom-nav-stats").click();
    await expect(page).toHaveURL(/\/app\/stats/, { timeout: 10_000 });

    // Back to /app/library
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/library/, { timeout: 10_000 });
    await expect(page.getByTestId("library-search").first()).toBeVisible({ timeout: 10_000 });

    // Back again to /app — collections should still render
    await page.goBack();
    await expect(page).toHaveURL(/\/app(\/?$|\/?\?)/, { timeout: 10_000 });
    await expect(page.getByTestId("course-menu-trigger").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("tablist").first()).toBeVisible({ timeout: 10_000 });
  });

  test("public landing → sign-in page works while logged out", async ({
    browser,
  }) => {
    // Use a fresh, cookie-less context so we hit the public surface.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    try {
      await page.goto("/");
      const signIn = page
        .getByRole("link", { name: /sign in|log in|anmelden/i })
        .first();
      await expect(signIn).toBeVisible({ timeout: 15_000 });
      await signIn.click();
      await expect(page).toHaveURL(/\/auth\/sign-in/, { timeout: 10_000 });
    } finally {
      await context.close();
    }
  });
});
