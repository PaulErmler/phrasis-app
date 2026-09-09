import { test, expect, type Locator, type Page } from '@playwright/test';
import { convexRun, fixtureEmail } from './convex-hooks';
import { dismissTour, expectSignedIn, neutralizeTours } from './helpers';

/**
 * Editing a curriculum card is also a complaint about the curriculum.
 *
 * The learner gets a private fork (long-standing behaviour) AND the shared
 * translation row every other learner studies gets flagged, with the learner's
 * wording handed to a retranslation as a suggestion. This spec drives that
 * from the real edit dialog and checks the shared row, which is the one part
 * convex-test cannot prove: that the dialog is actually wired to the mutation
 * that does it.
 *
 * Cost control: `armProbe` parks the row's flagCount at the cap first, so the
 * edit increments the counter but short-circuits before enqueueing a real
 * (paid) retranslation that would overwrite dev curriculum content.
 * `restoreProbe` puts the counter back, so repeat runs don't accumulate. The
 * enqueue, the suggestion payload, the injection sanitising, and every
 * exclusion are covered in convex/tests/features/scheduling.test.ts and
 * convex/tests/features/translationLLM.test.ts.
 *
 * Mutates the shared fixture user's cards (Path B replaces the card
 * document), so this belongs in the serial project. Requires
 * E2E_TEST_HOOKS=1, which global-setup sets for the run.
 */

type Probe = {
  cardId: string;
  textId: string;
  sourceLanguage: string;
  sourceText: string;
  targetLanguage: string;
  targetText: string;
  originalFlagCount: number | null;
};

/** Open the edit dialog for one specific library card. */
async function openEditDialog(page: Page, card: Locator): Promise<void> {
  await expect(card).toBeVisible({ timeout: 20_000 });

  // "Edit" is a surface button when the user has pinned it, otherwise it
  // lives in the overflow menu. Handle both.
  const pinnedEdit = card.getByRole('button', { name: 'Edit', exact: true });
  if ((await pinnedEdit.count()) > 0) {
    await pinnedEdit.first().click();
  } else {
    await card
      .getByRole('button', { name: 'More', exact: true })
      .first()
      .click();
    await page.getByTestId('card-action-edit').click();
  }
  await expect(
    page.getByRole('heading', { name: 'Edit Sentence' }),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('curriculum edit flags the shared translation', () => {
  let probe: Probe | null = null;

  test.afterEach(() => {
    if (!probe) return;
    convexRun('features/curriculumFlagTesting:restoreProbe', {
      textId: probe.textId,
      targetLanguage: probe.targetLanguage,
      originalFlagCount: probe.originalFlagCount,
    });
    probe = null;
  });

  test('editing a curriculum translation forks the card and flags the original row', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = fixtureEmail();

    probe = convexRun('features/curriculumFlagTesting:armProbe', {
      email,
    }) as Probe | null;
    // `== null`: a null probe comes back from `convex run` as NO output at
    // all, so anything that mis-parses silence lands here as undefined. Both
    // mean "nothing to probe" and both have to skip rather than crash.
    test.skip(
      probe == null,
      'fixture user has no shared curriculum card with a flaggable translation',
    );
    const p = probe!;

    // The user's card points at the shared curriculum text to begin with.
    expect(
      convexRun('features/curriculumFlagTesting:userCardCountForText', {
        email,
        textId: p.textId,
      }),
    ).toBeGreaterThan(0);

    // Before the first navigation: a tour arming later re-covers the page,
    // and its overlay swallows clicks on the card actions.
    await neutralizeTours(page);
    await page.goto('/app/library');
    await page.waitForLoadState('domcontentloaded');
    await expectSignedIn(page);
    await dismissTour(page, undefined, 500);

    // Narrow the list to the probe card by its target-language wording.
    const search = page.getByTestId('library-search').first();
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill(p.targetText);

    // Address the ARMED card by id, never `.first()` of the list. The search
    // is debounced, so the pre-filter list still satisfies "a card is
    // visible" and the first row is then some unrelated card: the edit lands
    // on it, the shared row it flags is not the one armProbe parked, and the
    // poll below waits out its timeout against an untouched counter.
    const card = page.locator(
      `[data-testid="library-card"][data-card-id="${p.cardId}"]`,
    );
    await expect(card).toBeVisible({ timeout: 20_000 });

    await openEditDialog(page, card);

    // Edit ONLY the target-language line. The curriculum's own source line
    // stays untouched: changing it would (deliberately) suppress flagging,
    // since the user's target text would then translate their sentence
    // rather than the curriculum's.
    const edited = `${p.targetText.slice(0, 120)} (e2e)`;
    const input = page.locator(`#edit-${p.targetLanguage}`);
    await expect(input).toBeVisible();
    await input.fill(edited);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Edit Sentence' }),
    ).toBeHidden({ timeout: 20_000 });

    // The shared row is flagged. armProbe parked it at the cap (2), so the
    // edit takes it to 3 and enqueues nothing.
    await expect
      .poll(
        () =>
          (
            convexRun('features/curriculumFlagTesting:readTranslation', {
              textId: p.textId,
              targetLanguage: p.targetLanguage,
            }) as { flagCount: number | null } | null
          )?.flagCount ?? null,
        { timeout: 30_000, message: 'shared translation was never flagged' },
      )
      .toBe(3);

    // The shared wording itself is untouched: the user's edit lands on their
    // fork, not on the sentence every other learner studies.
    const shared = convexRun('features/curriculumFlagTesting:readTranslation', {
      textId: p.textId,
      targetLanguage: p.targetLanguage,
    }) as { translatedText: string };
    expect(shared.translatedText).toBe(p.targetText);

    // The user's card moved to a private fork.
    await expect
      .poll(
        () =>
          convexRun('features/curriculumFlagTesting:userCardCountForText', {
            email,
            textId: p.textId,
          }),
        {
          timeout: 30_000,
          message: "user's card never forked off the shared text",
        },
      )
      .toBe(0);

    // And the fork carries their wording.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectSignedIn(page);
    await search.fill(edited);
    await expect(page.getByText(edited, { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});

/**
 * The Flag dialog's politeness correction. A learner who ticks "the
 * politeness level is wrong" and picks a level writes a per-card override
 * (`cards.renderingPolitenessOverride`) that the card is re-rendered under.
 * The hook reads the override back, which is the one link convex-test cannot
 * prove: the dialog is wired to the mutation. Same probe and restore as the
 * edit spec above.
 *
 * Tagged @live, with retries: 0 per TESTING.md. `armProbe` parks the row's
 * `flagCount` at the cap, but that counter gates only
 * `retranslateOrRecordCapSkip`. The override write schedules
 * `prepareCardContent`, which reaches `scheduleMissingRenderings` — a
 * separate mechanism, keyed by its own `llmTranslationClaims.variantKey`,
 * with neither a provenance gate nor a quota gate. So this test does buy a
 * real rewrite of shared dev curriculum, and `clearCardRendering` drops the
 * override but not the variant rows it caused (invariant 3 retires those
 * only on a canonical wording change).
 */
test.describe('flag dialog politeness correction', { tag: '@live' }, () => {
  test.describe.configure({ retries: 0 });
  let probe: Probe | null = null;

  test.afterEach(() => {
    if (!probe) return;
    convexRun('features/curriculumFlagTesting:clearCardRendering', {
      cardId: probe.cardId,
    });
    convexRun('features/curriculumFlagTesting:restoreProbe', {
      textId: probe.textId,
      targetLanguage: probe.targetLanguage,
      originalFlagCount: probe.originalFlagCount,
    });
    probe = null;
  });

  test('picking a politeness level in the flag dialog writes the card override', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = fixtureEmail();

    probe = convexRun('features/curriculumFlagTesting:armProbe', {
      email,
    }) as Probe | null;
    // `== null`: a null probe comes back from `convex run` as NO output at
    // all, so anything that mis-parses silence lands here as undefined. Both
    // mean "nothing to probe" and both have to skip rather than crash.
    test.skip(
      probe == null,
      'fixture user has no shared curriculum card with a flaggable translation',
    );
    const p = probe!;

    // Before the first navigation: a tour arming later re-covers the page,
    // and its overlay swallows clicks on the card actions.
    await neutralizeTours(page);
    await page.goto('/app/library');
    await page.waitForLoadState('domcontentloaded');
    await expectSignedIn(page);
    await dismissTour(page, undefined, 500);

    const search = page.getByTestId('library-search').first();
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill(p.targetText);
    const card = page.locator(
      `[data-testid="library-card"][data-card-id="${p.cardId}"]`,
    );
    await expect(card).toBeVisible({ timeout: 20_000 });

    // "Flag translation" is a surface button when pinned, else in the menu.
    // Opening it is retried as a UNIT, and the dialog showing up is the exit
    // condition. Two things bite a single-shot open. The menu row can only be
    // addressed by testid, because every DropdownMenuItem in CardActionsMenu
    // nests a pin <button aria-label=…> whose label joins the item's
    // name-from-content, so no `{ name, exact: true }` matches it. And the
    // library list re-renders while the backend finishes this card's content;
    // each re-render remounts the card and closes the dropdown with it, so an
    // open-then-click can spend the whole test timeout clicking a menu row
    // that keeps being replaced under it (2026-09-09).
    const dialog = page.getByTestId('flag-dialog');
    await expect(async () => {
      // A half-open menu from the previous attempt would be toggled SHUT by
      // the trigger click below, so start each pass from closed.
      await page.keyboard.press('Escape').catch(() => {});
      const pinnedFlag = card.getByRole('button', {
        name: 'Flag translation',
        exact: true,
      });
      if ((await pinnedFlag.count()) > 0) {
        await pinnedFlag.first().click({ timeout: 5_000 });
      } else {
        await card
          .getByRole('button', { name: 'More', exact: true })
          .first()
          .click({ timeout: 5_000 });
        await page.getByTestId('card-action-flag').click({ timeout: 5_000 });
      }
      await expect(dialog).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [500, 1_000, 2_000] });

    await page.getByTestId('flag-reason-wrong_politeness').click();
    // The rows are the course's own politeness levels; the fixture course
    // is German-target, so casual (du) and polite (Sie) show. Pick the
    // last one so the pick differs from a casual default.
    const levels = page.locator('[data-testid^="flag-politeness-"]');
    await expect(levels.first()).toBeVisible({ timeout: 10_000 });
    const count = await levels.count();
    const chosen = levels.nth(count - 1);
    const chosenLevel = (await chosen.getAttribute('data-testid'))!.replace(
      'flag-politeness-',
      '',
    );
    await chosen.click();
    await page.getByTestId('flag-submit').click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The thank-you toast shows whether or not credits were paid (a repeat
    // flag on the same card pays nothing).
    await expect(
      page.getByText('Thank you for your help!', { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(
        () =>
          (
            convexRun('features/curriculumFlagTesting:readCardRendering', {
              cardId: p.cardId,
            }) as { renderingPolitenessOverride?: string } | null
          )?.renderingPolitenessOverride ?? null,
        { timeout: 30_000, message: 'card override was never written' },
      )
      .toBe(chosenLevel);
  });
});
