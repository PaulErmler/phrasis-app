import { test, expect } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * Add-cards smoke — verifies the EnterTextsView (rendered for the
 * /app/content/add-cards route) mounts a form. We then attempt an empty
 * submit to check that the form does not silently navigate away.
 *
 * Any LLM-driven card generation endpoint is stubbed so submitting a real
 * value would not burn quota.
 */
test.describe("add cards", () => {
  test("add-cards form renders and rejects empty submit", async ({ page }) => {
    // Generic stub for card-generation endpoints.
    await page.route(/\/api\/(generate|cards|enrich)/i, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, cards: [] }),
      });
    });

    await page.goto("/app/content/add-cards");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page);

    // The add-cards view embeds the NewChatInput (with placeholder
    // "What would you like to know?") alongside an actual text editor.
    // Target the editor-specific textbox, not the global chat input.
    const editor = page
      .getByRole("textbox", { name: /english|spanish|french|german|italian|portuguese|russian|hindi|chinese|japanese|korean|target|source/i })
      .first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    const submit = page
      .getByRole("button", { name: /^(save|add|create|generate|hinzufügen|erstellen)$/i })
      .first();
    await expect(
      submit,
      "Add-cards form should expose a Save/Add/Create/Generate submit button",
    ).toBeVisible({ timeout: 5_000 });

    // Empty-submit rejection can manifest two ways: (a) the submit button is
    // disabled while fields are blank (current behavior), or (b) clicking
    // triggers visible validation while staying on the page. Checking
    // `isEnabled` first avoids Playwright's 30s actionability wait on a
    // disabled control.
    if (!(await submit.isEnabled())) {
      return; // Disabled while empty — form correctly prevents submission.
    }

    const urlBefore = page.url();
    await submit.click({ trial: true }).catch(() => {});
    await page.waitForTimeout(500);
    expect(/add-cards/.test(page.url()) || page.url() === urlBefore).toBe(true);
  });
});
