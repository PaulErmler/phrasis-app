import { test, expect } from '@playwright/test';
import { dismissTour, openCardImport, pasteImport } from './helpers';
import { deckCardCount, fixtureEmail } from './convex-hooks';

/**
 * Live end-to-end test for the card batch-import mutation.
 *
 * Runs against the real Convex backend: imports exactly 3 texts with a
 * unique marker, adds them to the deck from the Custom collection detail,
 * and verifies EXACTLY three cards materialize. Tagged @live because it
 * mutates shared user state (adds cards to the test user's deck).
 *
 * Why the explicit add step: importing creates pending custom TEXTS, not
 * cards — cards materialize only through a deck-add flow, and the learn
 * view's auto-add drains pending customs only once the due queue is empty
 * (`cardForReview === null` in useLearningMode), which the fixture user's
 * queue never is. This spec's original "cards show up in the library"
 * assertion was a bare count that pre-existing cards satisfied, so it
 * passed for weeks without the import ever producing a card (caught
 * 2026-08-27 by the exact-delta assertion below).
 *
 * Retries disabled. The marker in the first cell changes per run so a
 * retry would create a second batch.
 */

test.describe.configure({ mode: 'serial', retries: 0 });
test.describe('add cards: import (live)', { tag: '@live' }, () => {
  test('imports 3 cards and surfaces them in the library', async ({ page }) => {
    // Wizard + three collection-adds + two backend polls comfortably exceed
    // the default 30s; every wait inside is still individually bounded.
    test.setTimeout(180_000);
    // The marker words must be REAL words in each cell's language: imported
    // sentences are synthesized and validated by transcribing them back
    // (processTTSForCard), so a consonant-soup token like "e2eImportmtb58ep5"
    // guarantees two failed TTS attempts, a semantic-judge LLM call, and an
    // [ERROR] per sentence — wasted live TTS calls and red herrings in the
    // backend logs on every run. A timestamp-picked word pair is unique
    // enough (fresh fixture user per run, retries 0) and stays an exact
    // library-search hit.
    const EN_WORDS = [
      'amber',
      'birch',
      'cedar',
      'dune',
      'ember',
      'fjord',
      'grove',
      'heron',
      'iris',
      'juniper',
      'kelp',
      'lagoon',
      'meadow',
      'nutmeg',
      'olive',
      'pebble',
      'quartz',
      'reef',
      'sage',
      'tundra',
    ];
    const ES_WORDS = [
      'ámbar',
      'bosque',
      'cedro',
      'duna',
      'faro',
      'golfo',
      'huerta',
      'isla',
      'jardín',
      'lago',
      'madera',
      'nube',
      'olivo',
      'perla',
      'roca',
      'selva',
      'trigo',
      'uva',
      'valle',
      'zorro',
    ];
    const stamp = Date.now();
    const pickA = stamp % 20;
    const pickB = Math.floor(stamp / 20) % 20;
    // Library search below matches on the English pair (searchableText spans
    // all of a card's languages).
    const marker = `${EN_WORDS[pickA]} ${EN_WORDS[pickB]}`;
    const markerEs = `${ES_WORDS[pickA]} ${ES_WORDS[pickB]}`;

    await openCardImport(page);
    await pasteImport(
      page,
      [
        'English,Spanish',
        `${marker} hello,Hola ${markerEs}`,
        `${marker} goodbye,Adiós ${markerEs}`,
        `${marker} thanks,Gracias ${markerEs}`,
      ].join('\n'),
    );

    // Step 1: auto-mapping should pick up English + Spanish headers
    await page.getByTestId('import-next').click();
    await expect(page.getByTestId('import-mapping-en')).toContainText(
      /english/i,
    );
    await expect(page.getByTestId('import-mapping-es')).toContainText(
      /spanish/i,
    );

    // Step 2: 3 valid rows, submit enabled. There are two `import-submit`
    // buttons on this step (SummaryBar at top, stepper primary at bottom),
    // both trigger the same confirm dialog; use the first consistently.
    await page.getByTestId('import-next').click();
    const submit = page.getByTestId('import-submit').first();
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await expect(submit).toContainText(/import 3 cards/i);

    await submit.click();

    // Confirm dialog → Import
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // Backend count before confirming pins the eventual delta to EXACTLY
    // the 3 imported rows — the scheduled background chain creating the
    // cards must neither drop one nor run away and insert extras.
    const cardsBefore = deckCardCount(fixtureEmail());
    await page.getByTestId('import-confirm').click();

    // Wait for the submission to settle. The submit button re-enables or
    // the user is navigated back to the content hub. Don't rely on the toast
    // (sonner auto-dismisses inside a few seconds, flaky to catch).
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // The post-import flow can bounce through /app (the content hub) before
    // settling; if it does, the home_tour driver overlay can mount and stick
    // around. Strip any popover before the next click.
    await dismissTour(page).catch(() => {});

    // --- Add the imported texts to the deck from the Custom collection ---
    // (see the header: importing creates pending TEXTS; cards need an
    // explicit add while the due queue is non-empty).
    await page.goto('/app');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page, 'home_tour');
    await page.getByRole('tab', { name: /custom content/i }).click();
    await page.getByRole('button', { name: /^manually added$/i }).click();
    const customTile = page.getByTestId('collection-tile-Custom');
    await expect(customTile).toBeVisible({ timeout: 15_000 });
    await customTile.getByRole('button', { name: /preview/i }).click();

    const addedRows = page
      .locator('[data-testid="collection-text-added"]')
      .filter({ hasText: marker });
    for (let i = 0; i < 3; i++) {
      const row = page
        .locator('[data-testid^="collection-text-"]')
        .filter({ hasText: marker })
        .filter({ has: page.getByTestId('collection-text-add') })
        .first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.getByTestId('collection-text-add').click();
      // Wait for THIS row's flip before picking the next: until the
      // optimistic update lands, `.first()` would re-match the same row
      // and double-click its add button.
      await expect
        .poll(async () => addedRows.count(), { timeout: 15_000 })
        .toBe(i + 1);
    }
    // The row flip is optimistic (`optimisticallySetRowStatus`). A 1.5s
    // pause before navigating is not enough under suite load: goto() tears
    // down the Convex client and any still-in-flight add is dropped.
    // Observed 2026-08-28: library search found 2/3 after 150s — "thanks"
    // (the last click) was never inserted. Wait on the backend count
    // before leaving this page.
    await expect
      .poll(() => deckCardCount(fixtureEmail()), { timeout: 30_000 })
      .toBe(cardsBefore + 3);
    await page.keyboard.press('Escape');

    // --- Verify: the marker cards are in the library… ---
    await page.goto('/app/library');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page);

    const search = page.getByTestId('library-search').first();
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill(marker);

    // Filter by the MARKER, never a bare count: right after `fill` the
    // subscription can still show pre-filter results, and a bare count
    // passes on pre-existing cards even when the import produced nothing
    // (exactly how this spec was vacuously green until 2026-08-27).
    const markerCards = page
      .getByTestId('library-card')
      .filter({ hasText: marker });
    await expect
      .poll(async () => markerCards.count(), { timeout: 30_000 })
      .toBe(3);

    // Still exactly +3 after the library round-trip — a delayed duplicate
    // insert would have passed the pre-navigate poll.
    expect(deckCardCount(fixtureEmail())).toBe(cardsBefore + 3);
  });
});
