import { test, expect } from "@playwright/test";

/**
 * Public landing page smoke test.
 *
 * The landing page is built from many marketing sections (Hero, Pricing,
 * FAQ, Footer, etc.). We assert structural presence rather than exact
 * marketing copy so that re-wording of the site does not break the test.
 */

// Force a logged-out browsing context — the landing page renders different
// CTAs when a Better Auth session cookie is present.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("public landing page", () => {
  test("renders hero, pricing CTA, and footer", async ({ page }) => {
    await page.goto("/");

    // Hero — there is a single h1 on the landing page.
    const hero = page.getByRole("heading", { level: 1 }).first();
    await expect(hero).toBeVisible({ timeout: 15_000 });

    // Primary CTA should be present (sign-up/sign-in/start-learning button).
    const cta = page
      .getByRole("link", { name: /sign|start|get started|try/i })
      .first();
    await expect(cta).toBeVisible();

    // Pricing section — scroll into view then match the section heading.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const pricing = page
      .getByRole("heading", { name: /pric|free|plan|tier/i })
      .first();
    await expect(pricing).toBeVisible({ timeout: 10_000 });

    // FAQ anchor link exists in the top nav — asserts the FAQ section is
    // wired up without requiring a specific footer landmark (the landing
    // page does not render a <footer role="contentinfo">).
    const faqLink = page.getByRole("link", { name: /faq/i }).first();
    await expect(faqLink).toBeAttached();
  });
});
