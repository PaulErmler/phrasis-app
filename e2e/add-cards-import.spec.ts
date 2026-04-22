import { test, expect, type Page } from "@playwright/test";
import { dismissTour, openCardImport, pasteImport } from "./helpers";

/**
 * Add-cards batch-import UI suite.
 *
 * These tests exercise the 3-step stepper flow end-to-end client-side: input
 * parsing, auto column mapping, validation (warnings + errors), inline cell
 * editing, row deletion, and dialog navigation. None of them submit the
 * import — the actual mutation is covered by add-cards-import-live.spec.ts.
 *
 * All scenarios use at most 3 rows to keep runs fast.
 */

const VALID_3_ROWS = [
  "English,Spanish",
  "Hello,Hola",
  "Goodbye,Adiós",
  "Thanks,Gracias",
].join("\n");

/** Advance the stepper by clicking Next (steps 0 and 1 share a Next button). */
async function clickNext(page: Page): Promise<void> {
  await page.getByTestId("import-next").click();
}

/**
 * Select an option in a Radix Select by its opened trigger testid + visible
 * option-text regex. Used for delimiter and column-mapping dropdowns.
 */
async function pickSelectOption(
  page: Page,
  triggerTestId: string,
  optionText: RegExp,
): Promise<void> {
  await page.getByTestId(triggerTestId).click();
  await page.getByRole("option", { name: optionText }).first().click();
}

test.describe("add cards — import", () => {
  test.describe("mode switcher", () => {
    test("defaults to individual mode and can switch to import", async ({
      page,
    }) => {
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
      await expect(page.getByTestId("import-paste")).toBeVisible({
        timeout: 10_000,
      });
    });

    test("stepper indicator renders and steps 1/2 disabled without input", async ({
      page,
    }) => {
      await openCardImport(page);

      await expect(page.getByTestId("import-step-0")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.getByTestId("import-step-1")).toBeDisabled();
      await expect(page.getByTestId("import-step-2")).toBeDisabled();
    });
  });

  test.describe("input step", () => {
    test("paste populates preview and unlocks step 1", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(page, VALID_3_ROWS);

      await expect(page.getByText(/rows? detected/i)).toBeVisible();
      await expect(page.getByTestId("import-step-1")).toBeEnabled();
    });

    test("file upload parses a CSV", async ({ page }) => {
      await openCardImport(page);

      await page.getByTestId("import-file-input").setInputFiles({
        name: "cards.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(VALID_3_ROWS, "utf-8"),
      });

      // Filename surfaces in the dropzone
      await expect(
        page.getByTestId("import-dropzone").getByText("cards.csv"),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("import-step-1")).toBeEnabled({
        timeout: 10_000,
      });
    });

    test("auto-detects semicolon delimiter", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(
        page,
        ["English;Spanish", "Hello;Hola", "Bye;Adiós", "Thanks;Gracias"].join(
          "\n",
        ),
      );

      // Two columns parsed → both mapping selects render on step 1
      await clickNext(page);
      await expect(page.getByTestId("import-mapping-en")).toBeVisible();
      await expect(page.getByTestId("import-mapping-es")).toBeVisible();
    });

    test("manual delimiter override reparses content", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(page, "Hello,Hola\nBye,Adiós\nThanks,Gracias");

      // Comma auto-detected → step 2 would unlock once mapping is set
      await clickNext(page);
      await expect(page.getByTestId("import-mapping-en")).toBeVisible();

      // Flip delimiter to pipe — no pipes present, each row becomes 1 column
      await page.getByTestId("import-step-0").click();
      await pickSelectOption(page, "import-delimiter", /pipe/i);
      await clickNext(page);

      // Only one column survives → the second mapping select must still exist
      // but step 2 can't unlock because both languages can't map to distinct
      // columns (mapping is incomplete until user picks one).
      await expect(page.getByTestId("import-step-2")).toBeDisabled();
    });

    test("auto-detects header row from language names", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(page, VALID_3_ROWS);

      await expect(page.getByTestId("import-has-header")).toBeChecked();
    });

    test("has-header checkbox toggles manually", async ({ page }) => {
      await openCardImport(page);
      // Nonsense tokens + >3 words per cell → defeats the auto-header heuristic
      // (no language-name match AND not all cells are short/few-words).
      await pasteImport(
        page,
        [
          "aaa bbb ccc ddd,eee fff ggg hhh",
          "Hello,Hola",
          "Bye,Adiós",
        ].join("\n"),
      );

      const checkbox = page.getByTestId("import-has-header");
      await expect(checkbox).not.toBeChecked();

      await checkbox.click();
      await expect(checkbox).toBeChecked();
    });
  });

  test.describe("mapping step", () => {
    test("auto-maps columns from language headers", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(page, VALID_3_ROWS);
      await clickNext(page);

      await expect(page.getByTestId("import-mapping-en")).toContainText(
        /english/i,
      );
      await expect(page.getByTestId("import-mapping-es")).toContainText(
        /spanish/i,
      );
      await expect(page.getByTestId("import-step-2")).toBeEnabled();
    });

    test("ambiguous headers leave mapping empty; step 2 unlocks after manual map", async ({
      page,
    }) => {
      await openCardImport(page);
      await pasteImport(page, "foo,bar\nHello,Hola\nBye,Adiós\nThanks,Gracias");
      await clickNext(page);

      // Nothing auto-mapped → step 2 blocked
      await expect(page.getByTestId("import-mapping-en")).toContainText(
        /not mapped/i,
      );
      await expect(page.getByTestId("import-mapping-es")).toContainText(
        /not mapped/i,
      );
      await expect(page.getByTestId("import-step-2")).toBeDisabled();

      // Map manually: English → column 1 (foo), Spanish → column 2 (bar)
      await pickSelectOption(page, "import-mapping-en", /foo/i);
      await pickSelectOption(page, "import-mapping-es", /bar/i);

      await expect(page.getByTestId("import-step-2")).toBeEnabled();
    });

    test("setting a language to 'not mapped' disables step 2", async ({
      page,
    }) => {
      await openCardImport(page);
      await pasteImport(page, VALID_3_ROWS);
      await clickNext(page);

      await expect(page.getByTestId("import-step-2")).toBeEnabled();

      await pickSelectOption(page, "import-mapping-en", /not mapped/i);

      await expect(page.getByTestId("import-step-2")).toBeDisabled();
    });
  });

  test.describe("review step — validation", () => {
    test("three valid rows: summary shows 3 ready, submit enabled", async ({
      page,
    }) => {
      await openCardImport(page);
      await pasteImport(page, VALID_3_ROWS);
      await clickNext(page);
      await clickNext(page);

      await expect(page.getByTestId("import-submit").first()).toBeEnabled();
      await expect(page.getByTestId("import-submit").first()).toContainText(
        /import 3 cards/i,
      );
    });

    test("duplicate row produces a warning but still imports", async ({
      page,
    }) => {
      await openCardImport(page);
      await pasteImport(
        page,
        ["English,Spanish", "Hello,Hola", "Hello,Hola", "Bye,Adiós"].join("\n"),
      );
      await clickNext(page);
      await clickNext(page);

      await expect(page.getByText(/duplicate of row/i)).toBeVisible();
      await expect(page.getByTestId("import-submit").first()).toBeEnabled();
      await expect(page.getByTestId("import-submit").first()).toContainText(
        /import 3 cards/i,
      );
    });

    test("empty cell is an error and blocks submit", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(
        page,
        ["English,Spanish", "Hello,Hola", ",Tschüss", "Bye,Adiós"].join("\n"),
      );
      await clickNext(page);
      await clickNext(page);

      // Row index 1 (data-row) has empty English
      await expect(page.getByText(/english: empty/i)).toBeVisible();
      await expect(page.getByTestId("import-submit").first()).toBeDisabled();
    });

    test("too-long cell is an error and blocks submit", async ({ page }) => {
      const longText = "x".repeat(160);
      await openCardImport(page);
      await pasteImport(
        page,
        [
          "English,Spanish",
          "Hello,Hola",
          `Bye,${longText}`,
          "Thanks,Gracias",
        ].join("\n"),
      );
      await clickNext(page);
      await clickNext(page);

      await expect(page.getByText(/160\/150/)).toBeVisible();
      await expect(page.getByTestId("import-submit").first()).toBeDisabled();
    });

    test("editing a cell clears its error", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(
        page,
        ["English,Spanish", "Hello,Hola", ",Tschüss", "Bye,Adiós"].join("\n"),
      );
      await clickNext(page);
      await clickNext(page);

      await expect(page.getByTestId("import-submit").first()).toBeDisabled();

      await page.getByTestId("import-review-edit-1-en").click();
      const editor = page.getByTestId("import-review-edit-input-1-en");
      await editor.fill("Bye");
      await editor.press("Enter");

      await expect(page.getByText(/english: empty/i)).toHaveCount(0);
      await expect(page.getByTestId("import-submit").first()).toBeEnabled();
    });

    test("escape cancels an edit and keeps original text", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(page, VALID_3_ROWS);
      await clickNext(page);
      await clickNext(page);

      await page.getByTestId("import-review-edit-0-en").click();
      const editor = page.getByTestId("import-review-edit-input-0-en");
      await editor.fill("SHOULD NOT PERSIST");
      await editor.press("Escape");

      const row = page.getByTestId("import-review-row-0");
      await expect(row).toContainText("Hello");
      await expect(row).not.toContainText("SHOULD NOT PERSIST");
    });

    test("deleting a row removes it and updates the summary", async ({
      page,
    }) => {
      await openCardImport(page);
      await pasteImport(page, VALID_3_ROWS);
      await clickNext(page);
      await clickNext(page);

      await expect(page.getByTestId("import-submit").first()).toContainText(
        /import 3 cards/i,
      );

      const rows = page.locator('[data-testid^="import-review-row-"]');
      await expect(rows).toHaveCount(3);

      // Delete the middle data-row ("Goodbye"). After deletion the remaining
      // rows re-index, so we can't look up by the old testid — just assert
      // total count and that "Goodbye" is gone.
      await page.getByTestId("import-review-delete-1").click();

      await expect(rows).toHaveCount(2);
      await expect(page.locator("text=Goodbye")).toHaveCount(0);
      await expect(page.getByTestId("import-submit").first()).toContainText(
        /import 2 cards/i,
      );
    });

    test("review rows are ordered error → warning → valid", async ({ page }) => {
      await openCardImport(page);
      // Data rows: 0 valid, 1 error (empty), 2 duplicate-warning of row 0
      await pasteImport(
        page,
        ["English,Spanish", "Hello,Hola", ",Tschüss", "Hello,Hola"].join("\n"),
      );
      await clickNext(page);
      await clickNext(page);

      const rows = page.locator('[data-testid^="import-review-row-"]');
      await expect(rows).toHaveCount(3);

      const ids = await rows.evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLElement).dataset.testid ?? ""),
      );
      expect(ids).toEqual([
        "import-review-row-1",
        "import-review-row-2",
        "import-review-row-0",
      ]);
    });
  });

  test.describe("navigation", () => {
    test("back preserves inline edits", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(page, VALID_3_ROWS);
      await clickNext(page);
      await clickNext(page);

      await page.getByTestId("import-review-edit-0-en").click();
      const editor = page.getByTestId("import-review-edit-input-0-en");
      await editor.fill("EDITED CELL");
      await editor.press("Enter");

      // Back to map step, then forward via the stepper
      await page.getByTestId("import-step-1").click();
      await expect(page.getByTestId("import-mapping-en")).toBeVisible();
      await page.getByTestId("import-step-2").click();

      await expect(page.getByTestId("import-review-row-0")).toContainText(
        "EDITED CELL",
      );
    });

    test("confirm dialog cancel keeps the user on review", async ({ page }) => {
      await openCardImport(page);
      await pasteImport(page, VALID_3_ROWS);
      await clickNext(page);
      await clickNext(page);

      await page.getByTestId("import-submit").first().click();

      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /cancel/i }).click();

      await expect(dialog).toBeHidden();
      await expect(page.getByTestId("import-submit").first()).toBeEnabled();
      await expect(page).toHaveURL(/\/app\/content\/add-cards/);
    });
  });
});
