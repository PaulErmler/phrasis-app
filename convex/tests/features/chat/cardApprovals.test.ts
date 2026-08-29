/// <reference types="vite/client" />
import { vi } from 'vitest';

// approveCard schedules `generateSentenceMetadata` (a raw scheduler action).
// Mock the LLM + retrier at file level (same stubs as sentenceMetadata.test.ts)
// so the chain resolves instantly instead of fetching OpenRouter; tests that
// invoke approveCard then drain it with finishAllScheduledFunctions so nothing
// is still running when the vitest worker tears down.
vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: '{}' })),
}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => () => ({}),
}));
vi.mock('@convex-dev/action-retrier', () => {
  class ActionRetrier {
    constructor(_component: unknown, _opts: unknown) {}
    async run(ctx: any, fnRef: any, args: any): Promise<string> {
      await ctx.runAction(fnRef, args);
      return 'job_stub';
    }
  }
  return { ActionRetrier };
});

import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, afterEach } from 'vitest';
import schema from '../../../schema';
import { api, internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../../../lib/scheduling';

const modules = import.meta.glob('/convex/**/*.ts');

afterEach(() => {
  vi.useRealTimers();
});

async function seedCourse(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    return { courseId };
  });
}

describe('features/chat/cardApprovals', () => {
  describe('createApprovalRequestInternal', () => {
    it('rejects empty translations', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      await expect(
        t.mutation(
          internal.features.chat.cardApprovals.createApprovalRequestInternal,
          {
            threadId: 'thread_1',
            messageId: 'm1',
            toolCallId: 'tc1',
            translations: [],
            userId: 'user_A',
          },
        ),
      ).rejects.toThrow();
    });

    it('rejects translations with missing course language', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      await expect(
        t.mutation(
          internal.features.chat.cardApprovals.createApprovalRequestInternal,
          {
            threadId: 'thread_1',
            messageId: 'm1',
            toolCallId: 'tc1',
            translations: [{ language: 'es', text: 'Hola' }], // missing "en"
            userId: 'user_A',
          },
        ),
      ).rejects.toThrow();
    });

    it('creates an approval when all course languages are provided', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      const approvalId = await t.mutation(
        internal.features.chat.cardApprovals.createApprovalRequestInternal,
        {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId: 'tc1',
          translations: [
            { language: 'en', text: 'Hello' },
            { language: 'es', text: 'Hola' },
          ],
          userId: 'user_A',
        },
      );
      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.status).toBe('pending');
    });
  });

  describe('rejectCard', () => {
    it('rejects unauthenticated', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId: 'tc1',
          translations: [{ language: 'en', text: 'x' }],
          userId: 'user_A',
          status: 'pending',
        }),
      );
      await expect(
        t.mutation(api.features.chat.cardApprovals.rejectCard, {
          approvalId,
        }),
      ).rejects.toThrow();
    });

    it('marks a pending approval as rejected', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId: 'tc1',
          translations: [{ language: 'en', text: 'x' }],
          userId: 'user_A',
          status: 'pending',
        }),
      );
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.rejectCard,
        { approvalId },
      );
      expect(res.success).toBe(true);
      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.status).toBe('rejected');
      expect(approval?.processedAt).toBeTypeOf('number');
    });

    it("rejects another user's approval", async () => {
      const t = convexTest(schema, modules);
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId: 'tc1',
          translations: [{ language: 'en', text: 'x' }],
          userId: 'user_B',
          status: 'pending',
        }),
      );
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.mutation(api.features.chat.cardApprovals.rejectCard, {
          approvalId,
        }),
      ).rejects.toThrow();
    });
  });

  describe('getApprovalsByThread', () => {
    it('returns [] unauthenticated', async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(
        api.features.chat.cardApprovals.getApprovalsByThread,
        { threadId: 'thread_x' },
      );
      expect(res).toEqual([]);
    });

    it('returns approvals for the authenticated user only', async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId: 'tc-A',
          translations: [{ language: 'en', text: 'a' }],
          userId: 'user_A',
          status: 'pending',
        });
        await ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm2',
          toolCallId: 'tc-B',
          translations: [{ language: 'en', text: 'b' }],
          userId: 'user_B',
          status: 'pending',
        });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.chat.cardApprovals.getApprovalsByThread,
        { threadId: 'thread_1' },
      );
      expect(res).toHaveLength(1);
      expect(res[0].toolCallId).toBe('tc-A');
    });
  });

  describe('updateApprovalTranslations', () => {
    async function seedPending(
      t: TestConvex<typeof schema>,
      userId = 'user_A',
    ) {
      return t.run(async (ctx) =>
        ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId: 'tc1',
          translations: [
            { language: 'en', text: 'Hello' },
            { language: 'es', text: 'Hola' },
          ],
          userId,
          status: 'pending',
        }),
      );
    }

    it('rejects unauthenticated', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedPending(t);
      await expect(
        t.mutation(api.features.chat.cardApprovals.updateApprovalTranslations, {
          approvalId,
          translations: [
            { language: 'en', text: 'Hi' },
            { language: 'es', text: 'Hola' },
          ],
        }),
      ).rejects.toThrow();
    });

    it("rejects another user's approval", async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedPending(t, 'user_B');
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.mutation(
          api.features.chat.cardApprovals.updateApprovalTranslations,
          {
            approvalId,
            translations: [
              { language: 'en', text: 'Hi' },
              { language: 'es', text: 'Hola' },
            ],
          },
        ),
      ).rejects.toThrow();
    });

    it('updates translations on a pending approval', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedPending(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.updateApprovalTranslations,
        {
          approvalId,
          translations: [
            { language: 'en', text: 'Good morning' },
            { language: 'es', text: 'Buenos días' },
          ],
        },
      );
      expect(res.success).toBe(true);
      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.status).toBe('pending');
      expect(approval?.translations).toEqual([
        { language: 'en', text: 'Good morning' },
        { language: 'es', text: 'Buenos días' },
      ]);
    });

    it('rejects edits to already-approved approvals', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId: 'tc1',
          translations: [
            { language: 'en', text: 'Hello' },
            { language: 'es', text: 'Hola' },
          ],
          userId: 'user_A',
          status: 'approved',
        }),
      );
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.mutation(
          api.features.chat.cardApprovals.updateApprovalTranslations,
          {
            approvalId,
            translations: [
              { language: 'en', text: 'Hi' },
              { language: 'es', text: 'Hola' },
            ],
          },
        ),
      ).rejects.toThrow();
    });

    it('rejects language set mismatch', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedPending(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.mutation(
          api.features.chat.cardApprovals.updateApprovalTranslations,
          {
            approvalId,
            translations: [
              { language: 'en', text: 'Hi' },
              { language: 'fr', text: 'Salut' },
            ],
          },
        ),
      ).rejects.toThrow();
    });

    it('rejects empty text', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedPending(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.mutation(
          api.features.chat.cardApprovals.updateApprovalTranslations,
          {
            approvalId,
            translations: [
              { language: 'en', text: '   ' },
              { language: 'es', text: 'Hola' },
            ],
          },
        ),
      ).rejects.toThrow();
    });

    it('caps text to MAX_CARD_TEXT_LENGTH', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedPending(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const longText = 'a'.repeat(500);
      await asUser.mutation(
        api.features.chat.cardApprovals.updateApprovalTranslations,
        {
          approvalId,
          translations: [
            { language: 'en', text: longText },
            { language: 'es', text: 'Hola' },
          ],
        },
      );
      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.translations[0].text.length).toBe(150);
    });

    it('user-edited languages are stored verbatim as user-provided; untouched ones stay machine post-processed', async () => {
      const t = convexTest(schema, modules);
      // Two target languages so one can be edited and one left untouched.
      await t.run(async (ctx) => {
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['es', 'de'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            custom_sentences: {
              balance: 5,
              included: 5,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
      });
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId: 'tc1',
          translations: [
            { language: 'en', text: 'Fill in the blank' },
            { language: 'es', text: 'Rellena el hueco._' },
            { language: 'de', text: 'Fülle die Lücke._' },
          ],
          userId: 'user_A',
          status: 'pending',
        }),
      );
      const asUser = t.withIdentity({ subject: 'user_A' });
      // User deliberately ends the Spanish text with '_' (e.g. a blank);
      // en and de are passed through unchanged.
      await asUser.mutation(
        api.features.chat.cardApprovals.updateApprovalTranslations,
        {
          approvalId,
          translations: [
            { language: 'en', text: 'Fill in the blank' },
            { language: 'es', text: 'Rellena el _' },
            { language: 'de', text: 'Fülle die Lücke._' },
          ],
        },
      );
      const pending = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(pending?.userEditedLanguages).toEqual(['es']);

      vi.useFakeTimers();
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId },
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query('translations')
          .withIndex('by_textId', (q) => q.eq('textId', res.textId!))
          .collect(),
      );
      const es = translations.find((tr) => tr.targetLanguage === 'es');
      const de = translations.find((tr) => tr.targetLanguage === 'de');
      // User-typed text is stored VERBATIM (trailing '_' kept) and tagged
      // user-provided so future machine-output backfills skip it.
      expect(es?.translatedText).toBe('Rellena el _');
      expect(es?.translationSource).toBe('user-provided');
      // Untouched chat-model output still gets the post-processing step.
      expect(de?.translatedText).toBe('Fülle die Lücke.');
      expect(de?.translationSource).not.toBe('user-provided');
    });

    it('edits flow into approveCard', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            custom_sentences: {
              balance: 5,
              included: 5,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
      });
      const approvalId = await seedPending(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(
        api.features.chat.cardApprovals.updateApprovalTranslations,
        {
          approvalId,
          translations: [
            { language: 'en', text: 'Edited main' },
            { language: 'es', text: 'Principal editado' },
          ],
        },
      );
      vi.useFakeTimers();
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId },
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const text = await t.run(async (ctx) => ctx.db.get(res.textId!));
      expect(text?.text).toBe('Edited main');
    });
  });

  describe('approveCard', () => {
    it('happy path: consumes quota, inserts text + translations, flips approval to approved', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      // Seed quota for CUSTOM_SENTENCES.
      await t.run(async (ctx) => {
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            custom_sentences: {
              balance: 5,
              included: 5,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
      });
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId: 'tc1',
          translations: [
            { language: 'en', text: 'Hello' },
            { language: 'es', text: 'Hola' },
          ],
          userId: 'user_A',
          status: 'pending',
        }),
      );
      const asUser = t.withIdentity({ subject: 'user_A' });
      vi.useFakeTimers();
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId },
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(res.success).toBe(true);
      expect(res.textId).toBeDefined();

      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.status).toBe('approved');
      expect(approval?.textId).toBe(res.textId);

      const text = await t.run(async (ctx) => ctx.db.get(res.textId!));
      // First translation ("en") becomes the main text; others land in translations.
      expect(text?.text).toBe('Hello');
      expect(text?.language).toBe('en');
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query('translations')
          .withIndex('by_textId', (q) => q.eq('textId', res.textId!))
          .collect(),
      );
      expect(translations.map((tr) => tr.targetLanguage)).toEqual(['es']);

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query('usageQuotas')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
          .first(),
      );
      expect(quota?.features.custom_sentences.balance).toBe(4);
    });
  });

  describe('approveCard: chat collection get-or-create', () => {
    async function seedQuota(t: TestConvex<typeof schema>) {
      await t.run(async (ctx) => {
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            custom_sentences: {
              balance: 5,
              included: 5,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
      });
    }

    async function seedApproval(
      t: TestConvex<typeof schema>,
      toolCallId = 'tc1',
    ) {
      return t.run(async (ctx) =>
        ctx.db.insert('cardApprovals', {
          threadId: 'thread_1',
          messageId: 'm1',
          toolCallId,
          translations: [
            { language: 'en', text: `Hello ${toolCallId}` },
            { language: 'es', text: `Hola ${toolCallId}` },
          ],
          userId: 'user_A',
          status: 'pending',
        }),
      );
    }

    async function getSettings(
      t: TestConvex<typeof schema>,
      courseId: Id<'courses'>,
    ) {
      return t.run(async (ctx) =>
        ctx.db
          .query('courseSettings')
          .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
          .first(),
      );
    }

    it('creates the Chat collection and inserts a courseSettings row when none exists', async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      await seedQuota(t);
      const approvalId = await seedApproval(t);

      const asUser = t.withIdentity({ subject: 'user_A' });
      vi.useFakeTimers();
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId },
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const text = await t.run(async (ctx) => ctx.db.get(res.textId!));
      const collection = await t.run(async (ctx) =>
        ctx.db.get(text!.collectionId!),
      );
      expect(collection?.name).toBe('Chat');
      expect(collection?.origin).toBe('chat');

      // No courseSettings row existed → the helper inserts one with the
      // default initial review count and the new collection activated.
      const settings = await getSettings(t, courseId);
      expect(settings?.chatCollectionId).toBe(collection?._id);
      expect(settings?.activeCustomCollectionIds).toEqual([collection?._id]);
      expect(settings?.initialReviewCount).toBe(DEFAULT_INITIAL_REVIEW_COUNT);
    });

    it('patches existing courseSettings and appends to activeCustomCollectionIds', async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      await seedQuota(t);
      const existingCollectionId = await t.run(async (ctx) => {
        const id = await ctx.db.insert('collections', {
          name: 'Custom',
          textCount: 0,
          origin: 'custom',
        });
        await ctx.db.insert('courseSettings', {
          courseId,
          initialReviewCount: 7,
          customCollectionId: id,
          activeCustomCollectionIds: [id],
        });
        return id;
      });
      const approvalId = await seedApproval(t);

      const asUser = t.withIdentity({ subject: 'user_A' });
      vi.useFakeTimers();
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId },
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const text = await t.run(async (ctx) => ctx.db.get(res.textId!));
      const settings = await getSettings(t, courseId);
      expect(settings?.chatCollectionId).toBe(text?.collectionId);
      expect(settings?.activeCustomCollectionIds).toEqual([
        existingCollectionId,
        text?.collectionId,
      ]);
      // The pre-existing settings row is patched, not replaced.
      expect(settings?.initialReviewCount).toBe(7);
      expect(settings?.customCollectionId).toBe(existingCollectionId);
    });

    it('reuses the same chat collection on a second approval', async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      await seedQuota(t);
      const firstApproval = await seedApproval(t, 'tc1');
      const secondApproval = await seedApproval(t, 'tc2');

      const asUser = t.withIdentity({ subject: 'user_A' });
      vi.useFakeTimers();
      const first = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId: firstApproval },
      );
      const second = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId: secondApproval },
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const [firstText, secondText] = await t.run(async (ctx) =>
        Promise.all([ctx.db.get(first.textId!), ctx.db.get(second.textId!)]),
      );
      expect(secondText?.collectionId).toBe(firstText?.collectionId);

      const chatCollections = await t.run(async (ctx) => {
        const all = await ctx.db.query('collections').collect();
        return all.filter((c) => c.origin === 'chat');
      });
      expect(chatCollections).toHaveLength(1);
      expect(chatCollections[0].textCount).toBe(2);

      const settings = await getSettings(t, courseId);
      expect(settings?.chatCollectionId).toBe(firstText?.collectionId);
      expect(settings?.activeCustomCollectionIds).toEqual([
        firstText?.collectionId,
      ]);
    });
  });
});
