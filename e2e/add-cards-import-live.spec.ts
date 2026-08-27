import { test, expect } from '@playwright/test';
import { dismissTour, openCardImport, pasteImport } from './helpers';

/**
 * Live end-to-end test for the card batch-import mutation.
 *
 * Runs against the real Convex backend: imports exactly 3 cards with a
 * unique marker, then verifies they show up in the library. Tagged @live
 * because it mutates shared user state (adds cards to the test user's deck).
 *
 * Retries disabled. The marker in the first cell changes per run so a
 * retry would create a second batch.
 */

test.describe.configure({ mode: 'serial', retries: 0 });
test.describe('add cards: import (live)', { tag: '@live' }, () => {
  test('imports 3 cards and surfaces them in the library', async ({ page }) => {
    // The default 30s test budget can't cover this test's own internal waits
    // (dialog-hidden wait up to 30s + the library poll below), under @live
    // load the poll was getting only the seconds left over from the wizard
    // steps and timing out at 0 cards. Budget generously; every wait inside
    // is still individually bounded, so a true hang fails early regardless.
    test.setTimeout(150_000);
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
    await page.getByTestId('import-confirm').click();

    // Wait for the submission to settle. The submit button re-enables or
    // the user is navigated back to the content hub. Don't rely on the toast
    // (sonner auto-dismisses inside a few seconds, flaky to catch).
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // The post-import flow can bounce through /app (the content hub) before
    // settling; if it does, the home_tour driver overlay can mount and stick
    // around. Strip any popover before the next click.
    await dismissTour(page).catch(() => {});

    // Verify the 3 cards show up in the library via the unique marker.
    await page.goto('/app/library');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page);

    const search = page.getByTestId('library-search').first();
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill(marker);

    // The import mutation only inserts the *texts* synchronously. The cards
    // are created by scheduled background functions (generateSentenceMetadata
    // → prepareCardContent, one LLM metadata call per sentence), so under
    // @live load they can land well after the confirm dialog closes. The
    // library search is a reactive Convex subscription. Cards appear in the
    // still-open results the moment they exist, so a long poll is safe.
    const cards = page.getByTestId('library-card');
    await expect
      .poll(async () => cards.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(3);
  });
});
