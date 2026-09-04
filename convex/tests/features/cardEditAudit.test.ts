/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { isRetranslationReason } from '../../types';
import { llmPool } from '@/convex/lib/workpools';
import { getVoiceForLanguage } from '../../../lib/languages';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { liveTranslation } from '../../db/translationReads';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

// Resolved the same way the worker does, so an audibly-changed retranslation
// runs its real TTS enqueue instead of tripping the curated-voice guard.
const TEST_VOICE = getVoiceForLanguage('en', 'female');

// The workpools are module-mocked globally (tests/convexTestSetup.ts). Each
// enqueue call's third argument is the worker's fnArgs, which is where the
// audit id and reason ride.
const llmEnqueues = () =>
  vi.mocked(llmPool.enqueueAction).mock.calls.map(
    (c) =>
      c[2] as {
        targetLanguage: string;
        translationReason?: string;
        retranslationAuditId?: Id<'cardEditRetranslations'>;
      },
  );

beforeEach(() => {
  vi.mocked(llmPool.enqueueAction).mockClear();
});

const listEdits = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => ctx.db.query('cardEdits').collect());
const listRetranslations = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => ctx.db.query('cardEditRetranslations').collect());

/**
 * Card on a SHARED curriculum text, so `editCard` takes Path B (fork). The
 * text's own language is 'sv' and the course is en→sv: the 'en' row is an
 * ordinary translation the user can edit, 'sv' is the curriculum source line.
 */
async function seedCurriculumCard(
  t: TestConvex<typeof schema>,
  opts: { flagCount?: number; userCreated?: boolean } = {},
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
      origin: 'premade',
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
      translationSource: 'openrouter/gemini-flash-lite-low',
      ...(opts.flagCount != null ? { flagCount: opts.flagCount } : {}),
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
    await ctx.db.insert('usageQuotas', {
      userId: 'user_A',
      features: {
        card_edits: { balance: 100, included: 100, used: 0, unlimited: false },
        translation_flags: {
          balance: 100,
          included: 100,
          used: 0,
          unlimited: false,
        },
      },
      lastSyncedAt: Date.now(),
    });
    return { cardId, textId, translationId, courseId };
  });
}

/** Same shape, but the text is the user's own, so `editCard` takes Path A. */
async function seedOwnedCard(t: TestConvex<typeof schema>) {
  const seeded = await seedCurriculumCard(t, { userCreated: true });
  return seeded;
}

describe('features/cardEditAudit', () => {
  describe('manual edit', () => {
    it('Path A: logs an in-place edit with before/after and language roles', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedOwnedCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      const edits = await listEdits(t);
      expect(edits).toHaveLength(1);
      const edit = edits[0];
      expect(edit.kind).toBe('manual_edit');
      expect(edit.path).toBe('in_place');
      // Nothing was forked, so both identities are unchanged.
      expect(edit.cardIdAfter).toBe(edit.cardIdBefore);
      expect(edit.textIdAfter).toBe(textId);
      expect(edit.sourceLanguage).toBe('sv');
      expect(edit.sourceText).toBe('Hej');
      expect(edit.baseLanguages).toEqual(['en']);
      expect(edit.targetLanguages).toEqual(['sv']);
      expect(edit.textWasUserCreated).toBe(true);

      // Only the language that actually changed is recorded.
      expect(edit.changes).toEqual([
        {
          language: 'en',
          role: 'base',
          isSourceLanguage: false,
          before: 'Hello',
          after: 'Hi there',
          beforeTranslationSource: 'openrouter/gemini-flash-lite-low',
          soundsSame: false,
        },
      ]);
    });

    it('Path B: logs a fork pointing at the new text on the same card', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCurriculumCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      const [edit] = await listEdits(t);
      expect(edit.path).toBe('fork');
      expect(edit.cardIdBefore).toBe(cardId);
      // The card is patched in place — only its text row is forked.
      expect(edit.cardIdAfter).toBe(cardId);
      expect(edit.textIdBefore).toBe(textId);
      expect(edit.textIdAfter).not.toBe(textId);
      expect(edit.collectionOrigin).toBe('premade');
      expect(edit.textWasUserCreated).toBe(false);

      // The card really points at the forked text the audit row names.
      const edited = await t.run(async (ctx) => ctx.db.get(edit.cardIdAfter));
      expect(edited?.textId).toBe(edit.textIdAfter);
    });

    it('records the triggered retranslation against the SHARED text, not the fork', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCurriculumCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      const [edit] = await listEdits(t);
      const rows = await listRetranslations(t);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        cardEditId: edit._id,
        userId: 'user_A',
        language: 'en',
        role: 'base',
        // The shared curriculum row — what every other learner studies — not
        // the private copy this user's card now points at.
        textId,
        beforeText: 'Hello',
        userSuggestion: 'Hi there',
        flagCountAfter: 1,
        status: 'enqueued',
        rule: 'retranslation_high',
      });
      expect(rows[0].resolvedAt).toBeUndefined();

      // The job carries both the reason and the row it must resolve.
      const enqueued = llmEnqueues();
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0].translationReason).toBe('curriculum_fix');
      expect(enqueued[0].retranslationAuditId).toBe(rows[0]._id);
    });

    it('writes no row for a no-op diff', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedOwnedCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hello' },
        ],
        timezone: 'UTC',
      });

      expect(await listEdits(t)).toEqual([]);
    });
  });

  describe('flag', () => {
    it('logs the gesture with no proposed wording, and enqueues with reason "flag"', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCurriculumCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.flagTranslation, {
        cardId,
      });

      const [edit] = await listEdits(t);
      expect(edit.kind).toBe('flag');
      expect(edit.path).toBe('none');
      expect(edit.cardIdAfter).toBe(cardId);
      expect(edit.textIdAfter).toBe(textId);
      expect(edit.changes).toHaveLength(1);
      // A flag disputes the wording without proposing a replacement, so there
      // is nothing to diff.
      expect(edit.changes[0].after).toBeUndefined();
      expect(edit.changes[0].soundsSame).toBeUndefined();
      expect(edit.changes[0]).toMatchObject({
        language: 'en',
        role: 'base',
        before: 'Hello',
        beforeFlagCount: 0,
      });

      const rows = await listRetranslations(t);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('enqueued');
      expect(rows[0].userSuggestion).toBeUndefined();
      expect(llmEnqueues()[0].translationReason).toBe('flag');
    });

    it('logs an over-cap flag as skipped_capped and enqueues nothing', async () => {
      const t = convexTest(schema, modules);
      // FLAG_AUTO_RETRANSLATION_MAX is 2, so a third flag is over-cap.
      const { cardId } = await seedCurriculumCard(t, { flagCount: 2 });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.flagTranslation, {
        cardId,
      });

      const rows = await listRetranslations(t);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('skipped_capped');
      expect(rows[0].flagCountAfter).toBe(3);
      expect(rows[0].resolvedAt).toEqual(expect.any(Number));
      expect(llmEnqueues()).toHaveLength(0);
    });

    it('logs a user-created flag as an unattempted gesture', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCurriculumCard(t, { userCreated: true });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.flagTranslation, {
        cardId,
      });

      // The gesture is recorded — `textWasUserCreated` is what explains why no
      // retranslation followed — but no attempt row is invented for work the
      // policy never started.
      const [edit] = await listEdits(t);
      expect(edit.kind).toBe('flag');
      expect(edit.textWasUserCreated).toBe(true);
      expect(await listRetranslations(t)).toEqual([]);
      expect(llmEnqueues()).toHaveLength(0);
    });
  });

  describe('resolution at the write choke point', () => {
    /** Drive one manual edit and hand back its pending retranslation row. */
    async function seedPendingRetranslation(t: TestConvex<typeof schema>) {
      const { cardId, textId, translationId } = await seedCurriculumCard(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });
      const [row] = await listRetranslations(t);
      const claim = await t.run(async (ctx) =>
        ctx.db
          .query('llmTranslationClaims')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', 'en'),
          )
          .first(),
      );
      return { textId, translationId, auditId: row._id, claimId: claim!._id };
    }

    it('marks an applied retranslation with the wording the model produced', async () => {
      const t = convexTest(schema, modules);
      const { textId, auditId, claimId } = await seedPendingRetranslation(t);

      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: 'en',
        translatedText: 'Hey there',
        voiceName: TEST_VOICE,
        translationSource: 'openrouter/gemini-pro-medium',
        replaceExisting: true,
        expectedClaimId: claimId,
        retranslationAuditId: auditId,
      });

      const row = await t.run(async (ctx) => ctx.db.get(auditId));
      expect(row?.status).toBe('applied');
      expect(row?.afterText).toBe('Hey there');
      expect(row?.afterTranslationSource).toBe('openrouter/gemini-pro-medium');
      expect(row?.resolvedAt).toEqual(expect.any(Number));
    });

    it('distinguishes a punctuation-only retranslation, which keeps its audio', async () => {
      const t = convexTest(schema, modules);
      const { textId, auditId, claimId } = await seedPendingRetranslation(t);

      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: 'en',
        // Same words, different punctuation: audibly identical.
        translatedText: 'Hello!',
        voiceName: TEST_VOICE,
        replaceExisting: true,
        expectedClaimId: claimId,
        retranslationAuditId: auditId,
      });

      const row = await t.run(async (ctx) => ctx.db.get(auditId));
      expect(row?.status).toBe('applied_audio_kept');
      expect(row?.afterText).toBe('Hello!');
    });

    it('marks a result whose claim was reclaimed mid-flight as superseded', async () => {
      const t = convexTest(schema, modules);
      const { textId, translationId, auditId, claimId } =
        await seedPendingRetranslation(t);

      // A reclaim deletes + reinserts the claim under a new _id, which is what
      // makes the in-flight job's token stale.
      await t.run(async (ctx) => {
        await ctx.db.delete(claimId);
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'en',
          claimedAt: Date.now(),
        });
      });

      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: 'en',
        translatedText: 'Stale result',
        voiceName: TEST_VOICE,
        replaceExisting: true,
        expectedClaimId: claimId,
        retranslationAuditId: auditId,
      });

      const row = await t.run(async (ctx) => ctx.db.get(auditId));
      expect(row?.status).toBe('dropped_superseded');
      expect(row?.afterText).toBeUndefined();
      // And the write really was skipped.
      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.translatedText).toBe('Hello');
    });

    it('marks a vanished text as dropped rather than leaving the row pending', async () => {
      const t = convexTest(schema, modules);
      const { auditId, claimId } = await seedPendingRetranslation(t);
      const orphanTextId = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'tmp',
          textCount: 0,
        });
        const id = await ctx.db.insert('texts', {
          text: 'gone',
          language: 'sv',
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        await ctx.db.delete(id);
        return id;
      });

      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId: orphanTextId,
        targetLanguage: 'en',
        translatedText: 'anything',
        voiceName: TEST_VOICE,
        replaceExisting: true,
        expectedClaimId: claimId,
        retranslationAuditId: auditId,
      });

      const row = await t.run(async (ctx) => ctx.db.get(auditId));
      expect(row?.status).toBe('dropped_text_deleted');
    });

    it('marks a result refused by the user-created backstop', async () => {
      const t = convexTest(schema, modules);
      const { textId, translationId, auditId, claimId } =
        await seedPendingRetranslation(t);
      // The text became user-created while the job was in flight (no live
      // path enqueues against one, so this simulates the defence-in-depth
      // case the backstop exists for).
      await t.run(async (ctx) =>
        ctx.db.patch(textId, { userCreated: true, userId: 'user_A' }),
      );

      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: 'en',
        translatedText: 'Overwrite attempt',
        voiceName: TEST_VOICE,
        replaceExisting: true,
        expectedClaimId: claimId,
        retranslationAuditId: auditId,
      });

      const row = await t.run(async (ctx) => ctx.db.get(auditId));
      expect(row?.status).toBe('refused_user_created');
      expect(row?.afterText).toBeUndefined();
      // And the user's wording survived.
      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.translatedText).toBe('Hello');
    });

    it('records skipped_claim_contested when another job owns the claim', async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCurriculumCard(t);
      // A fresh foreign claim on (textId, 'en'): the edit's retranslation
      // request must be dropped, and dropped VISIBLY — the audit row is how
      // a reviewer tells "we declined to race" from "nothing happened".
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'en',
          claimedAt: Date.now(),
          workId: 'foreign-owner',
        });
      });

      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: 'sv', text: 'Hej' },
          { language: 'en', text: 'Hi there' },
        ],
        timezone: 'UTC',
      });

      const [row] = await listRetranslations(t);
      expect(row.status).toBe('skipped_claim_contested');
      expect(row.resolvedAt).toEqual(expect.any(Number));
      // No job was enqueued for the contested language.
      expect(
        llmEnqueues().filter((e) => e.targetLanguage === 'en'),
      ).toHaveLength(0);
    });

    it('survives an audit row that was purged while the job was in flight', async () => {
      const t = convexTest(schema, modules);
      const { textId, auditId, claimId } = await seedPendingRetranslation(t);
      await t.run(async (ctx) => ctx.db.delete(auditId));

      // Losing the audit trail must never fail the translation it describes.
      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: 'en',
        translatedText: 'Hey there',
        voiceName: TEST_VOICE,
        replaceExisting: true,
        expectedClaimId: claimId,
        retranslationAuditId: auditId,
      });

      const translation = await t.run(async (ctx) =>
        liveTranslation(ctx, textId, 'en'),
      );
      expect(translation?.translatedText).toBe('Hey there');
    });
  });

  describe('isRetranslationReason', () => {
    it('is true only for the reasons that mean a user disputed the wording', () => {
      expect(isRetranslationReason('flag')).toBe(true);
      expect(isRetranslationReason('curriculum_fix')).toBe(true);
      expect(isRetranslationReason('fill')).toBe(false);
      // Jobs enqueued before the field existed read as an ordinary fill.
      expect(isRetranslationReason(undefined)).toBe(false);
    });
  });
});
