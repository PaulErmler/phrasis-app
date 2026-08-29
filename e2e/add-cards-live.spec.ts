import { test, expect } from '@playwright/test';
import {
  dismissErrorBoundary,
  dismissTour,
  gotoAuthedApp,
  neutralizeTours,
} from './helpers';
import { deckCardCount, fixtureEmail } from './convex-hooks';

/**
 * Live end-to-end test for the manual "enter texts" save flow
 * (EnterTextsView → createCustomText). Runs against the real Convex
 * backend: saves one sentence with a unique marker, verifies it lands in
 * the user's Custom collection, adds it to the deck from the collection
 * detail, and confirms it then shows as a card in the library.
 *
 * Filling every language by hand (no auto-fill) keeps this on the
 * pure-manual branch, no metadata arg, so `createCustomText` schedules
 * `generateSentenceMetadata`. That is the exact path of the
 * `translationSource` ArgumentValidationError regression: the failure was
 * async and invisible to the saving user.
 *
 * Why the explicit add step: saving a custom text does NOT create its deck
 * card. Cards materialize only when a deck-add flow runs (learn-mode
 * auto-add mixes pending custom texts in; the collection detail offers
 * per-text add). The library lists *cards*, so polling it right after save
 * deadlocks on a trigger that never comes. The per-text add in the
 * collection detail is the deterministic user path. None of these steps
 * depend on LLM/TTS providers, so this spec passes even when content
 * generation is degraded (card content backfills later via self-heal).
 *
 * Tagged @live because it mutates shared user state (consumes
 * custom-sentence quota and adds a card to the test user's deck).
 *
 * Retries disabled. The marker changes per run, so a retry would save a
 * second sentence.
 */

test.describe.configure({ mode: 'serial', retries: 0 });
test.describe('add cards: manual entry (live)', { tag: '@live' }, () => {
  test('saves a manually-entered text and surfaces it in the custom collection', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const marker = `e2eManual${Date.now().toString(36)}`;

    // This spec asserts nothing about tours, and the home tour can mount
    // LATE (localStorage lacks the DB-side completion until the backfill
    // query lands; under load that loses the race against the tour's 1.2s
    // delay), a one-shot dismissTour then misses it and the overlay blocks
    // the collection-dialog clicks. CSS-neutralize all tours for every
    // document this page loads instead (seen 2026-08-17).
    await neutralizeTours(page);

    // --- 1. Save a manually-entered text -------------------------------
    const english = page.locator('#enter-en');
    await gotoAuthedApp(page, '/app/content/add-cards', english);
    await dismissTour(page);

    // One input per course language (en base + es target for the shared
    // e2e user), rendered with stable `enter-<lang>` ids by EnterTextsView.
    const spanish = page.locator('#enter-es');
    await expect(english).toBeVisible({ timeout: 20_000 });
    await english.fill(`${marker} the sun rises early.`);
    await spanish.fill(`El sol sale temprano ${marker}.`);

    const save = page.getByRole('button', { name: /^save$/i }).first();
    await expect(save).toBeEnabled({ timeout: 10_000 });
    await save.click();

    // On success the form resets to empty fields. More reliable than
    // catching the auto-dismissing sonner success toast. A Convex query
    // error under suite load can replace the view with the error boundary
    // mid-wait; retry remounts it (empty if the save landed).
    await dismissErrorBoundary(page);
    await expect(english).toHaveValue('', { timeout: 30_000 });

    // --- 2. The text is in the Custom collection ------------------------
    await page.goto('/app');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page, 'home_tour');

    // Home content section → "Custom Content" tab. The tab shows one
    // collection tile at a time behind a Chat/"Manually Added" switcher.
    // Select "Manually Added" (the Custom collection, targeted via its
    // locale-proof raw-name testid).
    await page.getByRole('tab', { name: /custom content/i }).click();
    await page.getByRole('button', { name: /^manually added$/i }).click();
    const customTile = page.getByTestId('collection-tile-Custom');
    await expect(customTile).toBeVisible({ timeout: 15_000 });
    await customTile.getByRole('button', { name: /preview/i }).click();

    // The detail dialog lists the collection's *texts* (reactive query), so
    // the just-saved sentence appears regardless of deck/card state.
    const markerRow = page
      .locator('[data-testid^="collection-text-"]')
      .filter({ hasText: marker })
      .first();
    await expect(markerRow).toBeVisible({ timeout: 20_000 });

    // --- 3. Add it to the deck; it becomes a library card ---------------
    // Per-text add (custom texts consume no SENTENCES quota). The card row
    // is inserted synchronously by the mutation. The backend count before
    // the click pins the delta to EXACTLY one — a duplicate insert (double
    // dispatch, retried mutation) would pass any presence assertion.
    const cardsBefore = deckCardCount(fixtureEmail());
    await markerRow.getByTestId('collection-text-add').click();
    // Wait for the row's status testid to flip to `added`, then give the
    // mutation ack a beat: the flip is an optimistic update, and the
    // full-page navigation below tears down the Convex client, navigating
    // on the optimistic flip alone can drop the un-acked mutation (observed:
    // no card row ever created).
    await expect(
      page
        .locator('[data-testid="collection-text-added"]')
        .filter({ hasText: marker })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
    await page.keyboard.press('Escape');

    await page.goto('/app/library');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page);

    const search = page.getByTestId('library-search').first();
    await expect(search).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('library-source-custom').click();
    await search.fill(marker);

    // Filter by marker text (not a bare count): right after `fill` the
    // reactive subscription can still be showing pre-filter results, and a
    // bare count would pass on those. The card exists already. This poll
    // only rides out the subscription refresh, not content generation.
    const markerCard = page
      .getByTestId('library-card')
      .filter({ hasText: marker });
    await expect
      .poll(async () => markerCard.count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);

    // Exactly one card was added — not two, not a batch.
    expect(deckCardCount(fixtureEmail())).toBe(cardsBefore + 1);
  });
});
