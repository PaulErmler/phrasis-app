import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import {
  activeCourseForEmail,
  assertTestHooksEnabled,
} from '../lib/testHooks';
import { mayRegenerateTranslation } from '../../lib/translationProvenance';
import { FLAG_AUTO_RETRANSLATION_MAX } from '../../lib/languages';
import { politenessLevelValidator, voiceGenderValidator } from '../types';
import {
  liveTranslation,
  liveTranslationsForText,
} from '../db/translationReads';

/**
 * E2E test hooks for "a manual edit of a curriculum card is also a complaint"
 * (`suggestCurriculumFixesForEdit` in features/scheduling.ts). Every function
 * here throws unless the deployment has `E2E_TEST_HOOKS=1` set. Enable it ONLY
 * on dev/test deployments, never in production.
 *
 * Invoked from Playwright via
 * `pnpm exec convex run features/curriculumFlagTesting:<fn> '<json>'`
 * (see e2e/curriculum-edit-flag.spec.ts).
 *
 * Why an "arm" step rather than a plain read: the behaviour under test writes
 * to a row the whole dev deployment shares, and the enqueue it would trigger
 * is a real paid retranslation that overwrites dev curriculum content.
 * `armProbe` parks the row's `flagCount` at the cap first, so the spec still
 * exercises the full browser → mutation → shared-row path while the enqueue
 * short-circuits. `restoreProbe` puts the counter back afterwards, so repeat
 * runs neither accumulate nor drift. The enqueue itself, the suggestion
 * payload, and every exclusion are covered by convex-test in
 * convex/tests/features/scheduling.test.ts.
 */

/**
 * Decks scanned per call. A course has one deck today; the headroom is for
 * the multi-deck shape without turning either hook into an unbounded scan.
 */
const MAX_DECKS = 5;

/**
 * Find a card in the user's active course that is backed by a SHARED
 * curriculum text and has a flaggable translation, park that translation's
 * `flagCount` at the cap, and report what the spec needs to drive the UI.
 *
 * Returns null when the user has no such card, which the spec skips on rather
 * than failing: a fixture user whose cards are all custom or already forked
 * has nothing to say about this behaviour.
 */
export const armProbe = internalMutation({
  args: { email: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      cardId: v.id('cards'),
      textId: v.id('texts'),
      sourceLanguage: v.string(),
      sourceText: v.string(),
      targetLanguage: v.string(),
      targetText: v.string(),
      /** The counter before arming, to restore afterwards. */
      originalFlagCount: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const { course } = await activeCourseForEmail(ctx, args.email);

    const decks = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
      .take(MAX_DECKS);

    const courseLanguages = new Set([
      ...course.baseLanguages,
      ...course.targetLanguages,
    ]);

    for (const deck of decks) {
      const cards = await ctx.db
        .query('cards')
        .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
        .take(200);

      for (const card of cards) {
        if (card.isHidden) continue;
        const text = await ctx.db.get(card.textId);
        // Shared curriculum rows only: a user-owned text takes Path A and has
        // no shared row to complain about.
        if (!text || text.userCreated) continue;

        const translations = await liveTranslationsForText(ctx, text._id, 20);

        const flaggable = translations.find(
          (tr) =>
            tr.targetLanguage !== text.language &&
            courseLanguages.has(tr.targetLanguage) &&
            tr.translatedText.length > 0 &&
            mayRegenerateTranslation(text, tr),
        );
        if (!flaggable) continue;

        const originalFlagCount = flaggable.flagCount ?? null;
        // Park at the cap so the edit's enqueue short-circuits. The counter
        // still increments, which is the assertion the spec makes.
        await ctx.db.patch(flaggable._id, {
          flagCount: FLAG_AUTO_RETRANSLATION_MAX,
        });

        return {
          cardId: card._id,
          textId: text._id,
          sourceLanguage: text.language,
          sourceText: text.text,
          targetLanguage: flaggable.targetLanguage,
          targetText: flaggable.translatedText,
          originalFlagCount,
        };
      }
    }

    return null;
  },
});

/** Read a shared translation row's flag counter and current wording. */
export const readTranslation = internalQuery({
  args: { textId: v.id('texts'), targetLanguage: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      flagCount: v.union(v.number(), v.null()),
      translatedText: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const row = await liveTranslation(ctx, args.textId, args.targetLanguage);
    if (!row) return null;
    return {
      flagCount: row.flagCount ?? null,
      translatedText: row.translatedText,
    };
  },
});

/**
 * How many cards in this user's ACTIVE course still point at the given text.
 * The spec's inverse of `armProbe`: it arms a card in the active course, so
 * the count that proves the fork has to look in the same place. The count
 * must be per-user, not global — the deployment's other fixture users study
 * the same shared curriculum rows, so a global count would never reach zero.
 *
 * Walked deck-first through `by_deckId_and_textId`, never `by_textId`. The
 * old version scanned `by_textId` across EVERY account and filtered down to
 * the caller afterwards, under a `.take(200)` ceiling: one row per account
 * that studies the sentence, so on a deployment carrying leftover fixture
 * users the caller's own card fell outside the window and the count read 0
 * with nothing wrong. That broke curriculum-edit-flag.spec.ts twice (see
 * e2e/global-teardown.ts, which purges accounts to keep the ceiling out of
 * reach). Deck-scoped, the read is bounded by the deck count instead and no
 * number of other users can push the answer around.
 */
export const userCardCountForText = internalQuery({
  args: { email: v.string(), textId: v.id('texts') },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const { course } = await activeCourseForEmail(ctx, args.email);

    const decks = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
      .take(MAX_DECKS);

    let count = 0;
    for (const deck of decks) {
      const cards = await ctx.db
        .query('cards')
        .withIndex('by_deckId_and_textId', (q) =>
          q.eq('deckId', deck._id).eq('textId', args.textId),
        )
        .collect();
      count += cards.length;
    }
    return count;
  },
});

/** Put the counter back where `armProbe` found it. */
export const restoreProbe = internalMutation({
  args: {
    textId: v.id('texts'),
    targetLanguage: v.string(),
    originalFlagCount: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const row = await liveTranslation(ctx, args.textId, args.targetLanguage);
    if (row) {
      await ctx.db.patch(row._id, {
        flagCount: args.originalFlagCount ?? undefined,
      });
    }
    return null;
  },
});

/**
 * The per-card rendering corrections the Flag dialog writes
 * (`cards.renderingGenderOverride` / `renderingPolitenessOverride`), so the
 * spec can prove the dialog's politeness pick reached the mutation.
 */
export const readCardRendering = internalQuery({
  args: { cardId: v.id('cards') },
  returns: v.union(
    v.null(),
    v.object({
      renderingGenderOverride: v.optional(voiceGenderValidator),
      renderingPolitenessOverride: v.optional(politenessLevelValidator),
    }),
  ),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const card = await ctx.db.get(args.cardId);
    if (!card) return null;
    return {
      renderingGenderOverride: card.renderingGenderOverride,
      renderingPolitenessOverride: card.renderingPolitenessOverride,
    };
  },
});

/** Drop the corrections a spec's flag wrote, so repeat runs start clean. */
export const clearCardRendering = internalMutation({
  args: { cardId: v.id('cards') },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const card = await ctx.db.get(args.cardId);
    if (card) {
      await ctx.db.patch(card._id, {
        renderingGenderOverride: undefined,
        renderingPolitenessOverride: undefined,
      });
    }
    return null;
  },
});
