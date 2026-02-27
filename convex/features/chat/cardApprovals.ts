import { v, ConvexError } from 'convex/values';
import { mutation, query, internalMutation } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { getAuthUser } from '../../db/users';
import { getActiveCourseForUser } from '../../db/courses';
import { getDeckByCourseId } from '../../db/decks';
import { cardApprovalStatusValidator } from '../../types';
import type { Id, Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

/** Maximum length for main text in card approvals. */
const MAX_MAIN_TEXT_LENGTH = 300;

/**
 * Fetches an approval and validates the user is authorized to act on it.
 * Throws if not found, not owned by user, or not pending.
 */
async function getAuthenticatedPendingApproval(
  ctx: MutationCtx,
  approvalId: Id<'cardApprovals'>,
  user: { _id: string },
): Promise<Doc<'cardApprovals'>> {
  const approval = await ctx.db.get(approvalId);
  if (!approval) throw new ConvexError('Approval not found');
  if (approval.userId !== user._id) throw new ConvexError('Not authorized');
  if (approval.status !== 'pending')
    throw new ConvexError('Approval already processed');
  return approval;
}

/**
 * Core approval logic for approveCard.
 * Creates text, translations, card, and schedules TTS.
 */
async function processApproval(
  ctx: MutationCtx,
  approval: Doc<'cardApprovals'>,
  user: { _id: string },
) {
  const active = await getActiveCourseForUser(ctx, user._id);
  if (!active) throw new ConvexError('No active course found');
  const { course } = active;

  let deck = await getDeckByCourseId(ctx, course._id);
  if (!deck) throw new ConvexError('Failed to create deck');


  const mainEntry = approval.translations[0];
  const mainText = mainEntry.text.slice(0, MAX_MAIN_TEXT_LENGTH);

  const textId: Id<'texts'> = await ctx.db.insert('texts', {
    text: mainText,
    language: mainEntry.language,
    userCreated: true,
    userId: user._id,
  });

  for (let i = 1; i < approval.translations.length; i++) {
    const entry = approval.translations[i];
    await ctx.db.insert('translations', {
      textId,
      targetLanguage: entry.language,
      translatedText: entry.text,
    });
  }

  const now = Date.now();
  const cardId: Id<'cards'> = await ctx.db.insert('cards', {
    deckId: deck._id,
    textId,
    dueDate: now,
    isMastered: false,
    isHidden: false,
    isFavorite: false,
    schedulingPhase: 'preReview',
    preReviewCount: 0,
  });

  await ctx.db.patch(deck._id, { cardCount: deck.cardCount + 1 });

  await ctx.scheduler.runAfter(
    0,
    internal.features.decks.prepareCardContent,
    {
      textId,
      baseLanguages: course.baseLanguages,
      targetLanguages: course.targetLanguages,
    },
  );

  await ctx.db.patch(approval._id, {
    status: 'approved',
    processedAt: now,
    cardId,
  });

  return cardId;
}

/**
 * Internal mutation to create approval request from tool handler.
 */
export const createApprovalRequestInternal = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
    toolCallId: v.string(),
    translations: v.array(v.object({ language: v.string(), text: v.string() })),
    userId: v.string(),
  },
  returns: v.id('cardApprovals'),
  handler: async (ctx, args) => {
    if (args.translations.length === 0) {
      throw new ConvexError('translations must not be empty');
    }

    const active = await getActiveCourseForUser(ctx, args.userId);
    if (!active) throw new ConvexError('No active course found for user');

    const courseLanguages = new Set([
      ...active.course.baseLanguages,
      ...active.course.targetLanguages,
    ]);
    const providedLanguages = args.translations.map((t) => t.language);
    const invalidLanguages = providedLanguages.filter(
      (lang) => !courseLanguages.has(lang),
    );
    if (invalidLanguages.length > 0) {
      throw new ConvexError(
        `Languages not in course: ${invalidLanguages.join(', ')}. Valid languages: ${[...courseLanguages].join(', ')}`,
      );
    }

    const missingLanguages = [...courseLanguages].filter(
      (lang) => !providedLanguages.includes(lang),
    );
    if (missingLanguages.length > 0) {
      throw new ConvexError(
        `Missing course languages: ${missingLanguages.join(', ')}. All course languages must be included.`,
      );
    }

    const cappedTranslations = args.translations.map((t, i) =>
      i === 0 ? { ...t, text: t.text.slice(0, MAX_MAIN_TEXT_LENGTH) } : t,
    );

    const approvalId = await ctx.db.insert('cardApprovals', {
      threadId: args.threadId,
      messageId: args.messageId,
      toolCallId: args.toolCallId,
      translations: cappedTranslations,
      userId: args.userId,
      status: 'pending',
    });

    return approvalId;
  },
});

/**
 * Approve a single card and create it in the user's deck.
 */
export const approveCard = mutation({
  args: {
    approvalId: v.id('cardApprovals'),
  },
  returns: v.object({
    success: v.boolean(),
    cardId: v.optional(v.id('cards')),
  }),
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) throw new ConvexError('Not authenticated');

    const approval = await getAuthenticatedPendingApproval(
      ctx,
      args.approvalId,
      user,
    );
    const cardId = await processApproval(ctx, approval, user);
    return { success: true, cardId };
  },
});

/**
 * Reject a card creation.
 */
export const rejectCard = mutation({
  args: {
    approvalId: v.id('cardApprovals'),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) throw new ConvexError('Not authenticated');

    await getAuthenticatedPendingApproval(ctx, args.approvalId, user);

    await ctx.db.patch(args.approvalId, {
      status: 'rejected',
      processedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get all approvals for a thread (efficient batch query).
 */
export const getApprovalsByThread = query({
  args: {
    threadId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id('cardApprovals'),
      toolCallId: v.string(),
      translations: v.array(v.object({ language: v.string(), text: v.string() })),
      status: cardApprovalStatusValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const approvals = await ctx.db
      .query('cardApprovals')
      .withIndex('by_thread_and_user', (q) =>
        q.eq('threadId', args.threadId).eq('userId', user._id),
      )
      .collect();

    return approvals.map((a) => ({
      _id: a._id,
      toolCallId: a.toolCallId,
      translations: a.translations,
      status: a.status,
    }));
  },
});
