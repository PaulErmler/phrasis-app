/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import { llmPool } from '@/convex/lib/workpools';
import { FLAG_AUTO_RETRANSLATION_MAX } from '../../../lib/languages';
import { USER_PROVIDED_TRANSLATION_SOURCE } from '../../../lib/translationProvenance';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { liveTranslation } from '../../db/translationReads';

const modules = import.meta.glob('/convex/**/*.ts');

// editCard fans content work out on 0ms timers; drain inside the test context.
drainSchedulerAfterEach();

/**
 * The E2E hooks behind features/curriculumFlagTesting.ts, plus a convex-test
 * port of the flow e2e/curriculum-edit-flag.spec.ts drives through them
 * (that spec never runs in CI). The e2e spec's own remaining value is
 * proving the edit DIALOG is wired to the mutation; everything it asserts
 * about the backend — arm at the cap, edit increments past it without
 * enqueueing, shared wording untouched, card forks off the shared text,
 * fork carries the user's wording, restore puts the counter back — is
 * proven here against `editCard` directly.
 */

const EMAIL = 'user-a@e2e.test';

async function seedProfile(
  t: TestConvex<typeof schema>,
  userId: string,
  email: string,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('userProfiles', {
      userId,
      email,
      name: 'Test User',
      createdAt: Date.now(),
      searchText: `${email} test user`,
    });
  });
}

/**
 * The e2e fixture in miniature: user_A studies an en→sv course whose one
 * card is backed by a SHARED curriculum text ("Hej", sv) with a flaggable
 * English translation ("Hello"). Mirrors the seedCurriculumCard helper in
 * scheduling.test.ts, plus the userProfiles row the email-addressed hooks
 * resolve the user through.
 */
async function seedCurriculumFixture(
  t: TestConvex<typeof schema>,
  opts: {
    flagCount?: number;
    translationSource?: string;
    userCreated?: boolean;
  } = {},
) {
  await seedProfile(t, 'user_A', EMAIL);
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['sv'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Hej',
      language: 'sv',
      userCreated: opts.userCreated ?? false,
      ...(opts.userCreated ? { userId: 'user_A' } : {}),
      collectionId,
      collectionRank: 1,
    });
    const translationId = await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'en',
      translatedText: 'Hello',
      ...(opts.flagCount != null ? { flagCount: opts.flagCount } : {}),
      ...(opts.translationSource
        ? { translationSource: opts.translationSource }
        : {}),
    });
    const cardId = await ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      collectionOrigin: 'premade',
      dueDate: Date.now() - 1000,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    // Fund the edit the ported flow performs (editCard consumes CARD_EDITS).
    await ctx.db.insert('usageQuotas', {
      userId: 'user_A',
      features: {
        card_edits: { balance: 100, included: 100, used: 0, unlimited: false },
      },
      lastSyncedAt: Date.now(),
    });
    return { cardId, textId, translationId, courseId, deckId, collectionId };
  });
}

describe('features/curriculumFlagTesting', () => {
  describe('without E2E_TEST_HOOKS', () => {
    beforeEach(() => {
      delete process.env.E2E_TEST_HOOKS;
    });

    it('refuses every entry point', async () => {
      const t = convexTest(schema, modules);
      // A real id: the arg validator runs before the gate, so a fake string
      // would fail for the wrong reason.
      const textId = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        return ctx.db.insert('texts', {
          text: 'Hej',
          language: 'sv',
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
      });
      await expect(
        t.mutation(internal.features.curriculumFlagTesting.armProbe, {
          email: EMAIL,
        }),
      ).rejects.toThrow(/test hooks are disabled/);
      await expect(
        t.query(internal.features.curriculumFlagTesting.readTranslation, {
          textId,
          targetLanguage: 'en',
        }),
      ).rejects.toThrow(/test hooks are disabled/);
      await expect(
        t.query(internal.features.curriculumFlagTesting.userCardCountForText, {
          email: EMAIL,
          textId,
        }),
      ).rejects.toThrow(/test hooks are disabled/);
      await expect(
        t.mutation(internal.features.curriculumFlagTesting.restoreProbe, {
          textId,
          targetLanguage: 'en',
          originalFlagCount: null,
        }),
      ).rejects.toThrow(/test hooks are disabled/);
    });
  });

  describe('with E2E_TEST_HOOKS=1', () => {
    beforeEach(() => {
      process.env.E2E_TEST_HOOKS = '1';
      vi.mocked(llmPool.enqueueAction).mockClear();
    });
    afterEach(() => {
      delete process.env.E2E_TEST_HOOKS;
    });

    describe('armProbe', () => {
      it('parks the flaggable translation at the cap and reports the probe', async () => {
        const t = convexTest(schema, modules);
        const { cardId, textId, translationId } =
          await seedCurriculumFixture(t);

        const probe = await t.mutation(
          internal.features.curriculumFlagTesting.armProbe,
          { email: EMAIL },
        );

        expect(probe).toEqual({
          cardId,
          textId,
          sourceLanguage: 'sv',
          sourceText: 'Hej',
          targetLanguage: 'en',
          targetText: 'Hello',
          originalFlagCount: null, // counter was unset before arming
        });
        const row = await t.run(async (ctx) => ctx.db.get(translationId));
        expect(row?.flagCount).toBe(FLAG_AUTO_RETRANSLATION_MAX);
      });

      it('reports the pre-arm counter so restore can put it back exactly', async () => {
        const t = convexTest(schema, modules);
        await seedCurriculumFixture(t, { flagCount: 1 });

        const probe = await t.mutation(
          internal.features.curriculumFlagTesting.armProbe,
          { email: EMAIL },
        );
        expect(probe?.originalFlagCount).toBe(1);
      });

      it('returns null when every card sits on a user-created text', async () => {
        const t = convexTest(schema, modules);
        await seedCurriculumFixture(t, { userCreated: true });

        const probe = await t.mutation(
          internal.features.curriculumFlagTesting.armProbe,
          { email: EMAIL },
        );
        expect(probe).toBeNull();
      });

      it('returns null when the only translation is protected (user-provided)', async () => {
        const t = convexTest(schema, modules);
        const { translationId } = await seedCurriculumFixture(t, {
          translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
        });

        const probe = await t.mutation(
          internal.features.curriculumFlagTesting.armProbe,
          { email: EMAIL },
        );
        expect(probe).toBeNull();
        // And it didn't touch the protected row on the way past.
        const row = await t.run(async (ctx) => ctx.db.get(translationId));
        expect(row?.flagCount).toBeUndefined();
      });

      it('throws for an email without a userProfiles row', async () => {
        const t = convexTest(schema, modules);
        await expect(
          t.mutation(internal.features.curriculumFlagTesting.armProbe, {
            email: 'nobody@e2e.test',
          }),
        ).rejects.toThrow(/No userProfiles row/);
      });

      it('throws when the user has no active course', async () => {
        const t = convexTest(schema, modules);
        await seedProfile(t, 'user_A', EMAIL);
        await t.run(async (ctx) => {
          await ctx.db.insert('userSettings', {
            userId: 'user_A',
            hasCompletedOnboarding: true,
            // no activeCourseId
          });
        });
        await expect(
          t.mutation(internal.features.curriculumFlagTesting.armProbe, {
            email: EMAIL,
          }),
        ).rejects.toThrow(/No active course/);
      });
    });

    describe('readTranslation / userCardCountForText', () => {
      it('reads the counter and wording, null for a missing row', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedCurriculumFixture(t, { flagCount: 2 });

        expect(
          await t.query(
            internal.features.curriculumFlagTesting.readTranslation,
            { textId, targetLanguage: 'en' },
          ),
        ).toEqual({ flagCount: 2, translatedText: 'Hello' });
        expect(
          await t.query(
            internal.features.curriculumFlagTesting.readTranslation,
            { textId, targetLanguage: 'de' },
          ),
        ).toBeNull();
      });

      it("counts only the addressed user's cards on the shared text", async () => {
        const t = convexTest(schema, modules);
        const { textId, collectionId } = await seedCurriculumFixture(t);
        // A second learner studying the same shared curriculum row.
        const EMAIL_B = 'user-b@e2e.test';
        await seedProfile(t, 'user_B', EMAIL_B);
        await t.run(async (ctx) => {
          const courseB = await ctx.db.insert('courses', {
            userId: 'user_B',
            baseLanguages: ['en'],
            targetLanguages: ['sv'],
          });
          const deckB = await ctx.db.insert('decks', {
            courseId: courseB,
            name: 'd',
            cardCount: 1,
          });
          await ctx.db.insert('cards', {
            deckId: deckB,
            textId,
            collectionId,
            collectionOrigin: 'premade',
            dueDate: Date.now(),
            isMastered: false,
            isHidden: false,
            schedulingPhase: 'preReview',
            preReviewCount: 0,
          });
        });

        expect(
          await t.query(
            internal.features.curriculumFlagTesting.userCardCountForText,
            { email: EMAIL, textId },
          ),
        ).toBe(1);
        expect(
          await t.query(
            internal.features.curriculumFlagTesting.userCardCountForText,
            { email: EMAIL_B, textId },
          ),
        ).toBe(1);
      });
    });

    describe('restoreProbe', () => {
      it('restores a numeric counter and clears a null one', async () => {
        const t = convexTest(schema, modules);
        const { textId, translationId } = await seedCurriculumFixture(t, {
          flagCount: FLAG_AUTO_RETRANSLATION_MAX,
        });

        await t.mutation(internal.features.curriculumFlagTesting.restoreProbe, {
          textId,
          targetLanguage: 'en',
          originalFlagCount: 1,
        });
        expect(
          (await t.run(async (ctx) => ctx.db.get(translationId)))?.flagCount,
        ).toBe(1);

        await t.mutation(internal.features.curriculumFlagTesting.restoreProbe, {
          textId,
          targetLanguage: 'en',
          originalFlagCount: null,
        });
        expect(
          (await t.run(async (ctx) => ctx.db.get(translationId)))?.flagCount,
        ).toBeUndefined();
      });

      it('no-ops on a missing translation row', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedCurriculumFixture(t);
        await expect(
          t.mutation(internal.features.curriculumFlagTesting.restoreProbe, {
            textId,
            targetLanguage: 'de',
            originalFlagCount: 2,
          }),
        ).resolves.toBeNull();
      });
    });

    describe('the e2e flow, ported: arm → edit → assert → restore', () => {
      it('an edit past the armed cap flags the shared row, forks the card, and enqueues nothing', async () => {
        const t = convexTest(schema, modules);
        const { cardId, textId } = await seedCurriculumFixture(t);
        const asUser = t.withIdentity({ subject: 'user_A' });

        // Arm: park the shared row's counter at the cap.
        const probe = (await t.mutation(
          internal.features.curriculumFlagTesting.armProbe,
          { email: EMAIL },
        ))!;
        expect(probe).not.toBeNull();

        // The user's card points at the shared curriculum text to begin with.
        expect(
          await t.query(
            internal.features.curriculumFlagTesting.userCardCountForText,
            { email: EMAIL, textId: probe.textId },
          ),
        ).toBeGreaterThan(0);

        // The edit the dialog performs: ONLY the target-language line changes
        // (changing the source line would deliberately suppress flagging).
        const edited = `${probe.targetText} (e2e)`;
        await asUser.mutation(api.features.scheduling.editCard, {
          cardId: probe.cardId,
          translations: [
            { language: probe.sourceLanguage, text: probe.sourceText },
            { language: probe.targetLanguage, text: edited },
          ],
          timezone: 'UTC',
        });

        // The shared row is flagged: armed at the cap (2), the edit takes it
        // to 3 — and the wording every other learner studies is untouched.
        expect(
          await t.query(
            internal.features.curriculumFlagTesting.readTranslation,
            { textId: probe.textId, targetLanguage: probe.targetLanguage },
          ),
        ).toEqual({
          flagCount: FLAG_AUTO_RETRANSLATION_MAX + 1,
          translatedText: probe.targetText,
        });

        // Over the cap → the paid retranslation was NOT enqueued. This is the
        // short-circuit that makes the e2e spec safe to run on a shared dev
        // deployment.
        expect(vi.mocked(llmPool.enqueueAction)).not.toHaveBeenCalled();

        // The user's card moved to a private fork off the shared text…
        expect(
          await t.query(
            internal.features.curriculumFlagTesting.userCardCountForText,
            { email: EMAIL, textId: probe.textId },
          ),
        ).toBe(0);

        // …and the fork carries their wording (same card id — Path B patches
        // textId in place, never replacing the card document).
        const forked = await t.run(async (ctx) => {
          const card = (await ctx.db.get(cardId))!;
          expect(card.textId).not.toBe(textId);
          return liveTranslation(ctx, card.textId, probe.targetLanguage);
        });
        expect(forked?.translatedText).toBe(edited);

        // Restore: the counter goes back where armProbe found it.
        await t.mutation(internal.features.curriculumFlagTesting.restoreProbe, {
          textId: probe.textId,
          targetLanguage: probe.targetLanguage,
          originalFlagCount: probe.originalFlagCount,
        });
        expect(
          (
            await t.query(
              internal.features.curriculumFlagTesting.readTranslation,
              { textId: probe.textId, targetLanguage: probe.targetLanguage },
            )
          )?.flagCount,
        ).toBeNull();
      });
    });
  });
});
