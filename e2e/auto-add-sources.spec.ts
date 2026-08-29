import { test, expect, type Page } from '@playwright/test';
import { dismissTour, gotoAuthedApp, neutralizeTours } from './helpers';
import {
  cleanupSeededTexts,
  convexRun,
  deckCardCountsBySource,
  fixtureEmail,
  seedCustomTexts,
} from './convex-hooks';

/**
 * Where a batch of new cards COMES FROM, asserted end to end.
 *
 * Two behaviours, both invisible to a presence-style spec:
 *
 *  1. A batch mixes the course collection with the user's own sentences
 *     (a fair coin per slot) instead of draining everything the user added
 *     first. "A card appeared" passes either way — the old all-custom-first
 *     behaviour produced a batch that was 100% custom and looked identical
 *     from the outside. The subject here is the SPLIT, read off the cards'
 *     own `collectionId` through the E2E_TEST_HOOKS deck hook.
 *
 *  2. With the SENTENCES balance at zero, the user's own sentences keep
 *     flowing: they cost no credits, so every coin flip goes to them and the
 *     learn view keeps pulling cards instead of settling on the locked
 *     upgrade wall. That gate is the `hasPendingCustomCards` query, and it
 *     lives entirely in the client — `convex/tests/features/cardAddSourceSplit`
 *     pins the mutation, nothing but an e2e can pin the view's reaction.
 *
 * @live: seeds and then adds real cards to the shared fixture user's deck,
 * which schedules translation + TTS for them (the assertions never wait on
 * that content, the same tradeoff `add-cards-live.spec.ts` documents).
 *
 * chromium-serial and retries:0 — each test mutates the shared user's deck
 * and quota mirror, and the seeded texts are cleaned up per test rather than
 * left for the next one to trip over.
 */

test.describe.configure({ mode: 'serial', retries: 0 });

/** Room for several batches on the custom side, so it can never run dry mid-test. */
const SEEDED_CUSTOM_TEXTS = 60;

type SourceCounts = { premade: number; custom: number; total: number };

function delta(before: SourceCounts, after: SourceCounts): SourceCounts {
  return {
    premade: after.premade - before.premade,
    custom: after.custom - before.custom,
    total: after.total - before.total,
  };
}

/**
 * Wait for the deck to grow past `from`, then for it to hold still for two
 * consecutive readings. Returns the settled counts.
 *
 * Both halves matter: without the growth wait the assertion races the add,
 * and without the settle a second batch's inserts land mid-assertion.
 */
async function waitForDeckGrowth(
  page: Page,
  email: string,
  from: number,
  budgetMs: number,
): Promise<SourceCounts> {
  const deadline = Date.now() + budgetMs;
  let counts = deckCardCountsBySource(email);
  while (counts.total === from) {
    if (Date.now() > deadline) {
      throw new Error(
        `Deck never grew past ${from} within ${budgetMs}ms — the add never landed.`,
      );
    }
    await page.waitForTimeout(1_000);
    counts = deckCardCountsBySource(email);
  }
  let stable = 1;
  while (stable < 2 && Date.now() < deadline) {
    await page.waitForTimeout(1_500);
    const next = deckCardCountsBySource(email);
    if (next.total === counts.total) stable++;
    else {
      counts = next;
      stable = 1;
    }
  }
  return counts;
}

test.describe('auto-add card sources (live)', { tag: '@live' }, () => {
  let seededTextIds: string[] = [];
  let zeroedPrevious: unknown = null;

  test.beforeEach(async ({ page }) => {
    await neutralizeTours(page);
    seededTextIds = seedCustomTexts(
      fixtureEmail(),
      SEEDED_CUSTOM_TEXTS,
      `e2eSrc${Date.now().toString(36)}`,
    ).textIds;
  });

  test.afterEach(async () => {
    if (zeroedPrevious !== null) {
      convexRun('features/quotaTesting:restoreFeatureBalances', {
        email: fixtureEmail(),
        previous: zeroedPrevious,
      });
      zeroedPrevious = null;
    }
    if (seededTextIds.length > 0) {
      cleanupSeededTexts(fixtureEmail(), seededTextIds);
      seededTextIds = [];
    }
  });

  test('a batch mixes course sentences with the user’s own', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const email = fixtureEmail();
    const before = deckCardCountsBySource(email);

    await gotoAuthedApp(
      page,
      '/app',
      page.getByTestId('collection-add-cards').first(),
    );
    await dismissTour(page, 'home_tour');

    // TWO batches, not one. A fair coin per slot CAN put a single batch of
    // ten entirely on one source (~1 in 500); over twenty slots that drops to
    // ~1 in a million, which is the difference between a spec and a flake.
    // The old behaviour — every pending custom text first, course sentences
    // only once those ran out — cannot produce a course card here at all,
    // because the seed leaves far more custom texts pending than two batches
    // can consume.
    const addBtn = page.getByTestId('collection-add-cards').first();
    let running = before.total;
    for (let batch = 0; batch < 2; batch++) {
      await expect(addBtn).toBeEnabled({ timeout: 15_000 });
      await addBtn.click();
      running = (await waitForDeckGrowth(page, email, running, 60_000)).total;
    }

    const after = deckCardCountsBySource(email);
    const added = delta(before, after);
    expect(
      added.total,
      'two batches should have added cards to the deck',
    ).toBeGreaterThan(0);
    expect(
      added.custom,
      'the batch should draw on the sentences the user added',
    ).toBeGreaterThan(0);
    expect(
      added.premade,
      'the batch should still draw on the course collection, not drain custom first',
    ).toBeGreaterThan(0);
  });

  test('with the credits gone the batch is all custom, and the upgrade wall stays away', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const email = fixtureEmail();

    await gotoAuthedApp(
      page,
      '/app/learn',
      page.getByTestId('learn-settings').first(),
    );
    await dismissTour(page, 'audio_review_intro', 500);

    // Zero AFTER the mount, like quota-exhaustion.spec: the mount's own
    // Autumn sync has already run, so the patched mirror survives until the
    // next reload and the reactive UI flips live. No reload from here on.
    const before = deckCardCountsBySource(email);
    zeroedPrevious = convexRun('features/quotaTesting:zeroFeatureBalances', {
      email,
      featureIds: ['sentences'],
    });

    // The learn view auto-adds on mount for the fixture user (the invariant
    // deck-integrity.spec is built on). With the balance at zero that run
    // used to stop dead; pending custom texts cost nothing, so it must keep
    // going and fill the whole batch from them.
    const after = await waitForDeckGrowth(page, email, before.total, 90_000);
    const added = delta(before, after);

    expect(
      added.custom,
      'the user’s own sentences should keep flowing on an empty balance',
    ).toBeGreaterThan(0);
    expect(
      added.premade,
      'no course sentence may be added once the credits are gone — they are the billed half',
    ).toBe(0);

    // Nothing was billed: the balance patch is still exactly where it was put.
    expect(
      convexRun('features/quotaTesting:readFeatureBalance', {
        email,
        featureId: 'sentences',
      }),
    ).toBe(0);

    // And the view never settled on the locked wall, which is what it showed
    // before pending custom texts counted towards "auto-add will run".
    await expect(page.getByTestId('empty-upgrade')).toHaveCount(0);
  });
});
