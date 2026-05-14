import { test, expect } from "@playwright/test";

/**
 * Content-source filter — smoke tests for the dev prototype pages and the
 * SegmentedHomeSection tab badges that ship today (the actual filter UI is
 * still TBD pending design choice from the 10 prototypes).
 *
 * The dev pages live at /dev/* and are public — no auth fixture needed.
 */

test.describe("content filter — dev prototypes", () => {
  test("placement-A prototypes page renders all 5 variants", async ({ page }) => {
    await page.goto("/dev/content-filter-prototypes");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: "Content filter — placement A" }),
    ).toBeVisible();

    // All five section headings (A through E) must appear.
    for (const label of [
      /A — Pill toggles/,
      /B — Three-segment switch/,
      /C — Labeled checkboxes/,
      /D — Dropdown selector/,
      /E — Filter chips/,
    ]) {
      await expect(page.getByRole("heading", { name: label })).toBeVisible();
    }
  });

  test("placement-B prototypes page renders all 5 variants", async ({ page }) => {
    await page.goto("/dev/review-mode-filter-prototypes");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: "Content filter — placement B" }),
    ).toBeVisible();

    for (const label of [
      /F — Inline label \+ chips/,
      /G — Secondary segmented control/,
      /H — Toggle switches/,
      /I — Subtle inline dropdown/,
      /J — Filter button \+ popover/,
    ]) {
      await expect(page.getByRole("heading", { name: label })).toBeVisible();
    }
  });

  test("learning-mode states simulator renders every tile", async ({
    page,
  }) => {
    await page.goto("/dev/learning-mode-states");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", {
        name: /Learning mode empty states — simulator/,
      }),
    ).toBeVisible();

    for (const testId of [
      "sim-filter-blocked-can-unblock-other-source-has-cards",
      "sim-filter-blocked-must-add-no-cards-in-any-source",
      "sim-all-caught-up-filter-both",
      "sim-all-caught-up-sentences-quota-reached",
      "sim-no-collection-selected",
    ]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
  });

  test("simulator: filter-blocked can-unblock — Include course flips the empty state", async ({
    page,
  }) => {
    await page.goto("/dev/learning-mode-states");
    await page.waitForLoadState("domcontentloaded");

    const tile = page.getByTestId(
      "sim-filter-blocked-can-unblock-other-source-has-cards",
    );

    // Initial: filter-blocked headline + Include button + outline Add button.
    await expect(
      tile.getByRole("heading", { name: /No custom cards to study right now/ }),
    ).toBeVisible();
    await expect(
      tile.getByRole("button", { name: /Include course content/ }),
    ).toBeVisible();

    // Click Include → component flips to "all caught up" headline.
    await tile.getByRole("button", { name: /Include course content/ }).click();
    await expect(
      tile.getByRole("heading", { name: /No sentences due for review/ }),
    ).toBeVisible();
    await expect(
      tile.getByRole("button", { name: /Include course content/ }),
    ).toHaveCount(0);

    // Reset restores the filter-blocked headline.
    await tile.getByRole("button", { name: "Reset" }).click();
    await expect(
      tile.getByRole("heading", { name: /No custom cards to study right now/ }),
    ).toBeVisible();
  });

  test("simulator: filter-blocked can-unblock — chat + custom buttons fire local counters", async ({
    page,
  }) => {
    await page.goto("/dev/learning-mode-states");
    await page.waitForLoadState("domcontentloaded");

    const tile = page.getByTestId(
      "sim-filter-blocked-can-unblock-other-source-has-cards",
    );
    await expect(tile.getByText("chat clicks: 0")).toBeVisible();
    await expect(tile.getByText("custom clicks: 0")).toBeVisible();

    // Custom-filter path replaces "Add N sentences" with two creation routes.
    await tile.getByTestId("filter-blocked-create-chat").click();
    await expect(tile.getByText("chat clicks: 1")).toBeVisible();
    await tile.getByTestId("filter-blocked-create-custom").click();
    await expect(tile.getByText("custom clicks: 1")).toBeVisible();
  });

  test("simulator: filter-blocked must-add — Include-other always present, regardless of other-source availability", async ({
    page,
  }) => {
    await page.goto("/dev/learning-mode-states");
    await page.waitForLoadState("domcontentloaded");

    const tile = page.getByTestId(
      "sim-filter-blocked-must-add-zero-cards-in-active-source",
    );

    // Must-add subtitle (directional, lowercase mid-sentence).
    await expect(
      tile.getByText(/You don't have any custom cards yet/),
    ).toBeVisible();

    // Include-other CTA is always present in filter-blocked custom state.
    await expect(tile.getByTestId("filter-blocked-include-other")).toBeVisible();

    // Toggling the other-source signal doesn't hide the CTA (it's now an
    // escape hatch back to the full deck, not a "course is available" hint).
    await tile.getByTestId("toggle-other-source").click();
    await expect(tile.getByTestId("filter-blocked-include-other")).toBeVisible();
    await expect(tile.getByTestId("filter-blocked-create-chat")).toBeVisible();
    await expect(tile.getByTestId("filter-blocked-create-custom")).toBeVisible();

    // Counters still drive correctly.
    await tile.getByTestId("filter-blocked-create-chat").click();
    await expect(tile.getByText("chat clicks: 1")).toBeVisible();
    await tile.getByTestId("filter-blocked-create-custom").click();
    await expect(tile.getByText("custom clicks: 1")).toBeVisible();
  });

  test("simulator: all-caught-up — quota reached swaps Add for Upgrade", async ({
    page,
  }) => {
    await page.goto("/dev/learning-mode-states");
    await page.waitForLoadState("domcontentloaded");

    const tile = page.getByTestId("sim-all-caught-up-sentences-quota-reached");
    await expect(tile.getByText("upgrade clicks: 0")).toBeVisible();
    await tile.getByRole("button", { name: /Upgrade/ }).click();
    await expect(tile.getByText("upgrade clicks: 1")).toBeVisible();
  });

  test("simulator: no-collection — Go to Home click is observed", async ({
    page,
  }) => {
    await page.goto("/dev/learning-mode-states");
    await page.waitForLoadState("domcontentloaded");

    const tile = page.getByTestId("sim-no-collection-selected");
    await expect(tile.getByText("home clicks: 0")).toBeVisible();
    await tile.getByRole("button", { name: /Go to Home/ }).click();
    await expect(tile.getByText("home clicks: 1")).toBeVisible();
  });

  test("clicking pill toggles flips the active filter caption", async ({
    page,
  }) => {
    await page.goto("/dev/content-filter-prototypes");
    await page.waitForLoadState("domcontentloaded");

    // Pill prototype is the first one — find its "Course" button.
    const courseBtn = page.getByRole("button", { name: "Course" }).first();
    const customBtn = page.getByRole("button", { name: "Custom" }).first();
    await expect(courseBtn).toBeVisible();
    await expect(customBtn).toBeVisible();

    // Click Course to disable it → filter becomes "Custom only".
    await courseBtn.click();
    await expect(page.getByText("Custom only").first()).toBeVisible();

    // The last remaining pill (Custom) should now refuse to be disabled —
    // clicking it leaves the filter on "Custom only".
    await customBtn.click();
    await expect(page.getByText("Custom only").first()).toBeVisible();
  });
});

test.describe("content filter — tab badges on home", () => {
  test("neither tab shows an Off badge when filter is 'both' (default)", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");

    // SegmentedHomeSection only renders the "Off" pill for an excluded
    // source. Default filter = 'both' → no Off badges anywhere.
    // Wait for the tab list to mount before asserting count.
    await expect(
      page.getByRole("tab", { name: /Course|Kurs/ }).first(),
    ).toBeVisible({ timeout: 10_000 });
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
