import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mayRegenerateTranslation } from '../../lib/translationProvenance';
import { FLAG_AUTO_RETRANSLATION_MAX } from '../../lib/languages';

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

function assertTestHooksEnabled(): void {
  if (process.env.E2E_TEST_HOOKS !== '1') {
    throw new Error(
      'E2E test hooks are disabled (set E2E_TEST_HOOKS=1 on a dev deployment)',
    );
  }
}

async function requireUserIdByEmail(
  ctx: QueryCtx | MutationCtx,
  rawEmail: string,
): Promise<string> {
  const email = rawEmail.trim().toLowerCase();
  const profile = await ctx.db
    .query('userProfiles')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first();
  if (!profile) throw new Error(`No userProfiles row for "${email}"`);
  return profile.userId;
}

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
    const userId = await requireUserIdByEmail(ctx, args.email);

    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    const courseId = settings?.activeCourseId;
    if (!courseId) throw new Error(`No active course for "${args.email}"`);
    const course = await ctx.db.get(courseId);
    if (!course) throw new Error(`Active course ${courseId} is missing`);

    const decks = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
      .take(5);

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

        const translations = await ctx.db
          .query('translations')
          .withIndex('by_textId', (q) => q.eq('textId', text._id))
          .take(10);

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
    const row = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
      )
      .first();
    if (!row) return null;
    return {
      flagCount: row.flagCount ?? null,
      translatedText: row.translatedText,
    };
  },
});

/**
 * How many of this user's cards still point at the given text. Scoped to one
 * user because the dev deployment's other fixture users study the same shared
 * curriculum rows; a global count would never reach zero.
 */
export const userCardCountForText = internalQuery({
  args: { email: v.string(), textId: v.id('texts') },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_textId', (q) => q.eq('textId', args.textId))
      .take(200);

    let count = 0;
    for (const card of cards) {
      const deck = await ctx.db.get(card.deckId);
      if (!deck) continue;
      const course = await ctx.db.get(deck.courseId);
      if (course?.userId === userId) count += 1;
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
    const row = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
      )
      .first();
    if (row) {
      await ctx.db.patch(row._id, {
        flagCount: args.originalFlagCount ?? undefined,
      });
    }
    return null;
  },
});
