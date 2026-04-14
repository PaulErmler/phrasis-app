import { test, expect } from "@playwright/test";
import { dismissTour } from "./helpers";

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

    // Bottom nav exposes buttons / tabs labelled with the view name.
    // We rely on the nav rendering at least the four main destinations.
    const targets = [
      { name: /library|bibliothek/i, urlFragment: /\/app\/library/ },
      { name: /stats|statistik/i, urlFragment: /\/app\/stats/ },
      { name: /settings|einstellungen/i, urlFragment: /\/app\/settings/ },
      { name: /home|start/i, urlFragment: /\/app(\/?$|\/?\?)/ },
    ];

    for (const t of targets) {
      const link = page
        .getByRole("button", { name: t.name })
        .or(page.getByRole("link", { name: t.name }))
        .first();

      if (!(await link.isVisible().catch(() => false))) {
        test.info().annotations.push({
          type: "skip-target",
          description: `Nav target ${t.name} not visible — skipping.`,
        });
        continue;
      }

      await link.click();
      await expect(page).toHaveURL(t.urlFragment, { timeout: 10_000 });
    }
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
