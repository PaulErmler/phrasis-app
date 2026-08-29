import { test, expect, type Page, type Locator } from '@playwright/test';
import { dismissTour, neutralizeTours } from './helpers';

/**
 * Library per-card actions, driven for real: favorite → favorites filter,
 * hide → hidden filter, delete → confirm dialog → row gone. These were
 * previously untouched by e2e (the library spec only smoke-mounted the
 * view).
 *
 * chromium-serial: every action mutates the shared fixture user's cards.
 * All three tests operate on PREMADE cards (source filter) so custom-card
 * specs never lose their fixtures, and each test restores what it toggled
 * (the deleted card stays deleted — removing one curriculum card from the
 * user's deck is harmless, the shared text is untouched).
 *
 * Server-confirmation pattern: favorite/hide flips are optimistic and the
 * library keeps toggled cards in place ("sticky ordering") instead of
 * removing them from a filtered list, so the negative assertions reload
 * first — after a flush beat, because a reload can kill an un-acked
 * mutation (see helpers.ts ensureTogglesSaved).
 */

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/app/library');
  await page.waitForLoadState('domcontentloaded');
  await dismissTour(page);
  await expect(page.getByTestId('library-search').first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId('library-source-premade').click();
  await expect
    .poll(async () => page.getByTestId('library-card').count(), {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(1);
}

async function firstCardId(page: Page): Promise<string> {
  const id = await page
    .getByTestId('library-card')
    .first()
    .getAttribute('data-card-id');
  expect(id).toBeTruthy();
  return id!;
}

function cardById(page: Page, id: string): Locator {
  return page.locator(`[data-card-id="${id}"]`);
}

test.describe.configure({ mode: 'serial', retries: 0 });
test.describe('library card actions', () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeTours(page);
  });

  test('favoriting a card surfaces it under the favorites filter', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openLibrary(page);
    const id = await firstCardId(page);

    await cardById(page, id)
      .getByTestId('card-action-favorite')
      .first()
      .click();
    await page.getByTestId('library-filter-favorites').click();
    await expect(cardById(page, id)).toBeVisible({ timeout: 15_000 });

    // Restore: unfavorite, then prove the server saved it — the sticky
    // ordering keeps the row visible until a reload re-reads the filter.
    await cardById(page, id)
      .getByTestId('card-action-favorite')
      .first()
      .click();
    await page.waitForTimeout(1_200); // let the mutation flush before reload
    await page.reload();
    await expect(page.getByTestId('library-search').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId('library-source-premade').click();
    await page.getByTestId('library-filter-favorites').click();
    await expect(cardById(page, id)).toHaveCount(0, { timeout: 15_000 });
  });

  test('hiding a card surfaces it under the hidden filter', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openLibrary(page);
    const id = await firstCardId(page);

    await cardById(page, id).getByTestId('card-action-hide').first().click();
    await page.getByTestId('library-filter-hidden').click();
    await expect(cardById(page, id)).toBeVisible({ timeout: 15_000 });

    // Restore: unhide (hidden cards are excluded from review, so leaving
    // one hidden would shrink the shared queue), confirm via reload.
    await cardById(page, id).getByTestId('card-action-hide').first().click();
    await page.waitForTimeout(1_200);
    await page.reload();
    await expect(page.getByTestId('library-search').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId('library-source-premade').click();
    await page.getByTestId('library-filter-hidden').click();
    await expect(cardById(page, id)).toHaveCount(0, { timeout: 15_000 });
  });

  test('deleting a card removes it after the confirm dialog', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openLibrary(page);
    const id = await firstCardId(page);

    await cardById(page, id).getByTestId('card-actions-more').click();
    await page.getByTestId('card-action-delete').click();
    await page.getByTestId('card-delete-confirm').click();

    // The reactive list drops the row once the mutation commits…
    await expect(cardById(page, id)).toHaveCount(0, { timeout: 15_000 });
    // …and it stays gone across a cold re-read.
    await page.waitForTimeout(1_000);
    await page.reload();
    await expect(page.getByTestId('library-search').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId('library-source-premade').click();
    await expect
      .poll(async () => page.getByTestId('library-card').count(), {
        timeout: 20_000,
      })
      .toBeGreaterThanOrEqual(1);
    await expect(cardById(page, id)).toHaveCount(0);
  });
});
