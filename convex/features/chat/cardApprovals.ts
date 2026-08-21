import { v, ConvexError } from 'convex/values';
import { mutation, query, internalMutation } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { getAuthUserId } from '../../db/users';
import { EVENTS, track } from '../../analytics';
import { getActiveCourseForUser } from '../../db/courses';
import {
  getOrCreateChatCollection,
} from '../../db/collections';
import {
  cardApprovalKindValidator,
  cardApprovalResolutionValidator,
  cardApprovalStatusValidator,
  proposedCardMetadataValidator,
  translationEntriesValidator,
} from '../../types';
import type { Id, Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { consumeQuota } from '../../usage/helpers';
import { FEATURE_IDS } from '../featureIds';
import { applyCardEdit } from '../scheduling';
import { applyTextMetadata } from '../sentenceMetadata';
import { resolveCardContext } from './cardContext';
import { MAX_CARD_TEXT_LENGTH } from '../../../lib/constants/learning';
import { trackEvent } from '../../db/stats/dailyStats';
import {
  getTranslationSource,
  postProcessTranslation,
} from '../../../lib/languages';
import { USER_PROVIDED_TRANSLATION_SOURCE } from '../../../lib/translationProvenance';
import { OPENROUTER_CHAT_REASONING, OPENROUTER_MODELS } from '../../config/aiModels';

/**
 * Require an authenticated user ID, throwing if not logged in.
 * File-local so the wire message stays exactly 'Not authenticated'
 * (db/users.requireAuthUserId throws 'Unauthenticated').
 */
async function requireUser(ctx: MutationCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError('Not authenticated');
  return userId;
}

/**
 * Fetches an approval and validates the user is authorized to act on it.
 * Throws if not found, not owned by user, or not pending.
 */
async function getAuthenticatedPendingApproval(
  ctx: MutationCtx,
  approvalId: Id<'cardApprovals'>,
  userId: string,
): Promise<Doc<'cardApprovals'>> {
  const approval = await ctx.db.get(approvalId);
  if (!approval) throw new ConvexError('Approval not found');
  if (approval.userId !== userId) throw new ConvexError('Not authorized');
  if (approval.status !== 'pending')
    throw new ConvexError('Approval already processed');
  return approval;
}

/**
 * Core approval logic for approveCard.
 * Creates text + translations and adds them to the per-course chat collection.
 * Cards are created later when the learning system needs new cards.
 */
async function processApproval(
  ctx: MutationCtx,
  approval: Doc<'cardApprovals'>,
  userId: string,
): Promise<Id<'texts'>> {
  const active = await getActiveCourseForUser(ctx, userId);
  if (!active) throw new ConvexError('No active course found');
  const { course } = active;

  const chatCollection = await getOrCreateChatCollection(ctx, course._id);

  const mainEntry = approval.translations[0];
  const mainText = mainEntry.text.slice(0, MAX_CARD_TEXT_LENGTH);

  const nextRank = chatCollection.textCount + 1;

  const textId: Id<'texts'> = await ctx.db.insert('texts', {
    text: mainText,
    language: mainEntry.language,
    userCreated: true,
    userId,
    collectionId: chatCollection._id,
    collectionRank: nextRank,
  });

  // The approval's translations were produced by the language-teacher chat
  // model (see OPENROUTER_MODELS.languageTeacher + OPENROUTER_CHAT_REASONING).
  const chatTranslationSource = getTranslationSource(
    OPENROUTER_MODELS.languageTeacher,
    OPENROUTER_CHAT_REASONING,
  );

  const userEditedLanguages = new Set(approval.userEditedLanguages ?? []);

  for (let i = 1; i < approval.translations.length; i++) {
    const entry = approval.translations[i];
    // User-edited entries (EditApprovalDialog) are the user's own words:
    // store VERBATIM and tag user-provided. The machine post-processing
    // step must never touch user-typed text (a deliberate trailing '_'
    // would be stripped), and the tag shields the row from future
    // machine-output backfills. Untouched entries are chat-model output
    // and get the language's post-processing step (default: strip
    // trailing '_' runs).
    const userEdited = userEditedLanguages.has(entry.language);
    await ctx.db.insert('translations', {
      textId,
      targetLanguage: entry.language,
      translatedText: userEdited
        ? entry.text
        : postProcessTranslation(entry.language, entry.text),
      translationSource: userEdited
        ? USER_PROVIDED_TRANSLATION_SOURCE
        : chatTranslationSource,
    });
  }

  await ctx.db.patch(chatCollection._id, {
    textCount: chatCollection.textCount + 1,
  });

  // Generate linguistic metadata first using all chat-produced translations,
  // then prepareCardContent runs from inside the metadata action so audio is
  // generated with the correct, consistent voice gender from the start.
  await ctx.scheduler.runAfter(
    0,
    internal.features.sentenceMetadata.generateSentenceMetadata,
    {
      textId,
      translations: approval.translations,
      schedulePrepareCard: true,
      baseLanguages: course.baseLanguages,
      targetLanguages: course.targetLanguages,
      userId,
    },
  );

  await ctx.db.patch(approval._id, {
    status: 'approved',
    processedAt: Date.now(),
    textId,
  });

  return textId;
}

/**
 * Internal mutation to create approval request from tool handler.
 */
export const createApprovalRequestInternal = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
    toolCallId: v.string(),
    translations: translationEntriesValidator,
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
      i === 0 ? { ...t, text: t.text.slice(0, MAX_CARD_TEXT_LENGTH) } : t,
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
 * Whether a proposedMetadata object carries at least one committed field.
 * The model may send an empty object; treat that the same as absent.
 */
function hasProposedMetadata(
  metadata: Doc<'cardApprovals'>['proposedMetadata'],
): metadata is NonNullable<Doc<'cardApprovals'>['proposedMetadata']> {
  return (
    metadata !== undefined &&
    Object.values(metadata).some((value) => value !== undefined)
  );
}

/**
 * Create an "also correct" approval from the markAlsoCorrect tool handler.
 *
 * `translations` carries only the languages the model changed (full corrected
 * sentence each, the user may have asked about a single word or verb form).
 * The stored row holds the FULL course-language set merged over the card's
 * current entries, base languages first, so `processApproval`'s
 * translations[0]-is-main-text convention holds on the add-as-new-card path.
 */
export const createAlsoCorrectApprovalInternal = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
    toolCallId: v.string(),
    cardId: v.id('cards'),
    translations: translationEntriesValidator,
    proposedMetadata: v.optional(proposedCardMetadataValidator),
    userId: v.string(),
  },
  // 'identical' is a NO-OP outcome, not a failure: the user's version already
  // matches the card. The tool turns it into a distinct success string so the
  // chat renders nothing rather than an error box. See MARK_ALSO_CORRECT_NOOP.
  returns: v.union(
    v.object({
      status: v.literal('created'),
      approvalId: v.id('cardApprovals'),
    }),
    v.object({ status: v.literal('identical') }),
  ),
  handler: async (ctx, args) => {
    // Ownership via card → deck → course. The tool passes the agent ctx's
    // userId; never trust the closed-over cardId alone. resolveCardContext is
    // the ONE walk + sentence assembly shared with the prompt-context path,
    // so what this approval stores is exactly what the tool prompt saw.
    const context = await resolveCardContext(ctx, args.cardId, args.userId);
    if (!context) throw new ConvexError('Not authorized');

    // Base languages first, then target. The order createCard proposals use
    // and processApproval depends on (entry 0 becomes the texts row).
    const courseLanguages = [
      ...new Set([...context.baseLanguages, ...context.targetLanguages]),
    ];

    const providedLanguages = args.translations.map((t) => t.language);
    const invalidLanguages = providedLanguages.filter(
      (lang) => !courseLanguages.includes(lang),
    );
    if (invalidLanguages.length > 0) {
      throw new ConvexError(
        `Languages not in course: ${invalidLanguages.join(', ')}. Valid languages: ${courseLanguages.join(', ')}`,
      );
    }
    if (new Set(providedLanguages).size !== providedLanguages.length) {
      throw new ConvexError('Duplicate language in translations.');
    }

    // The card's current per-language sentences, from the shared context
    // (course-scoped, source language included).
    const currentByLanguage = new Map<string, string>([
      [context.sourceLanguage, context.sourceText],
      ...context.translations.map(
        (t) => [t.language, t.text] as [string, string],
      ),
    ]);

    const proposedByLanguage = new Map(
      args.translations.map((t) => [
        t.language,
        t.text.slice(0, MAX_CARD_TEXT_LENGTH),
      ]),
    );
    for (const [, proposed] of proposedByLanguage) {
      if (proposed.trim().length === 0) {
        throw new ConvexError('Translation text must not be empty');
      }
    }
    const changedLanguages = [...proposedByLanguage.entries()]
      .filter(([lang, proposed]) => currentByLanguage.get(lang) !== proposed)
      .map(([lang]) => lang);

    const metadata = hasProposedMetadata(args.proposedMetadata)
      ? args.proposedMetadata
      : undefined;
    // Not an error: the single most common Writing-mode case is a user who
    // typed the sentence correctly (or missed only a diacritic), for which the
    // prompt's "keep the user's wording, fix punctuation/diacritics" rule
    // yields the card's own text. Throwing here surfaced as a red "Could not
    // save your version" box on a right answer. The model's prose already
    // tells the user they were correct, so there is simply nothing to offer.
    if (changedLanguages.length === 0 && !metadata) {
      return { status: 'identical' as const };
    }

    const merged = courseLanguages
      .map((lang) => ({
        language: lang,
        text: proposedByLanguage.get(lang) ?? currentByLanguage.get(lang) ?? '',
      }))
      .filter((entry) => entry.text.length > 0);
    // A card whose content pipeline hasn't produced every course language yet
    // can still be REPLACED (applyCardEdit only touches the languages it is
    // given), it just can't be added as a new card, which would create a card
    // with a blank line. Degrade to a replace-only offer instead of failing the
    // whole tool call; `approveCard` enforces the same rule server-side.
    const replaceOnly = merged.length < courseLanguages.length;

    const approvalId = await ctx.db.insert('cardApprovals', {
      threadId: args.threadId,
      messageId: args.messageId,
      toolCallId: args.toolCallId,
      translations: merged,
      userId: args.userId,
      status: 'pending',
      kind: 'alsoCorrect',
      cardId: args.cardId,
      changedLanguages,
      proposedMetadata: metadata,
      ...(replaceOnly ? { replaceOnly: true } : {}),
    });

    return { status: 'created' as const, approvalId };
  },
});

/**
 * Accept an "also correct" proposal by replacing the discussed card's text
 * (and optionally its metadata) instead of creating a new card.
 *
 * Reuses `applyCardEdit` (Path A/B copy-on-write, audio invalidation for
 * audibly-changed languages) with quota handled here, then applies the
 * model's proposed metadata via `applyTextMetadata`, whose prepareCardContent
 * pass is what re-voices audio after a speaker-gender change. When metadata is
 * present the edit is forced onto a user-owned text row (ensureUserOwnedText)
 * so a shared/dataset text other users reference is never patched.
 */
export const replaceCardFromApproval = mutation({
  args: {
    approvalId: v.id('cardApprovals'),
    timezone: v.string(),
  },
  // `cardId` is the card the edit LEFT BEHIND (a new document on Path B). The
  // learn view keys its thread-rotation suppression off this exact identity,
  // so it must be the replacement's id, not the input's.
  returns: v.object({
    success: v.boolean(),
    cardId: v.id('cards'),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const approval = await getAuthenticatedPendingApproval(
      ctx,
      args.approvalId,
      userId,
    );
    if ((approval.kind ?? 'createCard') !== 'alsoCorrect' || !approval.cardId) {
      throw new ConvexError('Approval does not support replacing a card');
    }
    const previousCardId = approval.cardId;

    // A proposal whose card is already gone. Replaced from another thread or
    // another device. Gets a specific code rather than the generic "Card not
    // found", so the client can say the card changed instead of leaving a
    // button that silently does nothing on every retry. This is the only read
    // of the card here: ownership is checked (once) inside applyCardEdit,
    // which also hands back the course this handler needs afterwards.
    if ((await ctx.db.get(previousCardId)) === null) {
      throw new ConvexError({
        code: 'CARD_REPLACED',
        message: 'This card has changed since the suggestion was made.',
      });
    }

    const metadata = hasProposedMetadata(approval.proposedMetadata)
      ? approval.proposedMetadata
      : undefined;

    // Write ONLY the languages the model actually changed. `translations`
    // holds the full course-language set merged at PROPOSAL time, so passing it
    // wholesale would diff a stale snapshot against the card and silently
    // revert any edit the user made to an untouched language in between (and
    // drop that language's audio with it). `changedLanguages` is absent only on
    // rows written before it existed, where the full set is the best available.
    const changed = new Set(approval.changedLanguages ?? []);
    const translationsToWrite =
      approval.changedLanguages === undefined
        ? approval.translations
        : approval.translations.filter((t) => changed.has(t.language));

    const {
      textId,
      cardId: replacementCardId,
      changed: editChanged,
      course,
    } = await applyCardEdit(ctx, {
      cardId: previousCardId,
      translations: translationsToWrite,
      timezone: args.timezone,
      ensureUserOwnedText: metadata !== undefined,
      skipQuota: true,
      // A definitive proposed gender must reach the text row BEFORE the
      // edit's own content scheduling. applyTextMetadata below runs after
      // applyCardEdit already enqueued (and claimed) the re-synthesis, so a
      // gender applied only there ships wrong-voice audio. Non-definitive
      // values keep the row's gender and stay applyTextMetadata's business.
      proposedAudioSpeakerGender:
        metadata?.speakerGender === 'male' || metadata?.speakerGender === 'female'
          ? metadata.speakerGender
          : undefined,
      // `suggestCurriculumFix` is deliberately omitted. The manual edit dialog
      // sets it so a retyped curriculum translation flags the shared row and
      // suggests the user's wording to a retranslation. Accepting an
      // "also correct" alternative from the tutor is not the same claim: both
      // renderings are usually fine, which is the point of the tool, and
      // flagging here would spend the shared row's capped auto-retranslations
      // on sentences nobody said were wrong.
    });

    // Bill only a real write. A no-op diff (the card was edited to exactly the
    // proposed wording in the meantime) resolves the approval below but keeps
    // applyCardEdit's documented promise. "`Changed: false` consumes nothing"
    // True for this caller too. Convex mutations are transactional, so a
    // USAGE_LIMIT throw here still rolls back the edit above.
    if (editChanged) {
      await consumeQuota(ctx, userId, FEATURE_IDS.CARD_EDITS);
    }

    if (metadata) {
      await applyTextMetadata(ctx, {
        textId,
        metadata,
        schedulePrepareCard: true,
        baseLanguages: course.baseLanguages,
        targetLanguages: course.targetLanguages,
      });
    }

    await ctx.db.patch(approval._id, {
      status: 'approved',
      resolution: 'replaced',
      processedAt: Date.now(),
      textId,
      cardId: replacementCardId,
    });

    // Path B replaced the card document, so every OTHER pending proposal for
    // the old card now points at a deleted row and would dead-end on "Card not
    // found". The button just appearing to do nothing. Retarget them.
    //
    // Scoped to this thread because `by_thread_and_user` is the only index on
    // cardApprovals, and it is the right scope in practice: markAlsoCorrect is
    // registered only on card-context turns and the learn view rotates threads
    // when the card changes, so a card's proposals live in one conversation by
    // construction. A stray cross-thread row is left to the "card has changed"
    // error rather than paying for a by_cardId index on every insert.
    if (replacementCardId !== previousCardId) {
      const siblings = await ctx.db
        .query('cardApprovals')
        .withIndex('by_thread_and_user', (q) =>
          q.eq('threadId', approval.threadId).eq('userId', userId),
        )
        // Bounded in practice by the approvals a single thread can hold; the
        // cap is a pure backstop against an unbounded read.
        .take(500);
      for (const sibling of siblings) {
        if (sibling._id === approval._id) continue;
        if (sibling.status !== 'pending') continue;
        if (sibling.cardId !== previousCardId) continue;
        await ctx.db.patch(sibling._id, { cardId: replacementCardId });
      }
    }

    await track(ctx, userId, EVENTS.CHAT_CARD_APPROVAL, {
      outcome: 'approved',
      kind: 'alsoCorrect',
      resolution: 'replaced',
      thread_id: approval.threadId,
      changed_languages: approval.changedLanguages ?? [],
      has_metadata: metadata !== undefined,
    });

    return { success: true, cardId: replacementCardId };
  },
});

/**
 * Approve a card proposal and add the text to the chat collection.
 */
export const approveCard = mutation({
  args: {
    approvalId: v.id('cardApprovals'),
  },
  returns: v.object({
    success: v.boolean(),
    textId: v.optional(v.id('texts')),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await consumeQuota(ctx, userId, FEATURE_IDS.CUSTOM_SENTENCES, 1);

    const approval = await getAuthenticatedPendingApproval(
      ctx,
      args.approvalId,
      userId,
    );
    // Replace-only rows carry a partial language set (the card was still
    // missing a translation when the proposal was made), so the add path would
    // create a card with a blank line. The UI hides the button; this is the
    // server-side enforcement. Throwing rolls the whole mutation back,
    // including the quota consumed above.
    if (approval.replaceOnly === true) {
      throw new ConvexError(
        'This version can only replace the card — it is missing text for some course languages.',
      );
    }

    const textId = await processApproval(ctx, approval, userId);

    const kind = approval.kind ?? 'createCard';
    if (kind === 'alsoCorrect') {
      await ctx.db.patch(approval._id, { resolution: 'newCard' });
    }

    // Track card approval event
    const active = await getActiveCourseForUser(ctx, userId);
    if (active) {
      await trackEvent(ctx, { userId, courseId: active.course._id, field: 'chatCardsApproved' });
    }
    await track(ctx, userId, EVENTS.CHAT_CARD_APPROVAL, {
      outcome: 'approved',
      kind,
      ...(kind === 'alsoCorrect' ? { resolution: 'newCard' } : {}),
      thread_id: approval.threadId,
      edited_languages: approval.userEditedLanguages ?? [],
    });

    return { success: true, textId };
  },
});

/**
 * Update the translations on a pending approval before it's accepted.
 */
export const updateApprovalTranslations = mutation({
  args: {
    approvalId: v.id('cardApprovals'),
    translations: translationEntriesValidator,
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const approval = await getAuthenticatedPendingApproval(
      ctx,
      args.approvalId,
      userId,
    );

    const existingLanguages = new Set(
      approval.translations.map((t) => t.language),
    );
    const incomingLanguages = new Set(args.translations.map((t) => t.language));
    if (
      existingLanguages.size !== incomingLanguages.size ||
      [...existingLanguages].some((l) => !incomingLanguages.has(l))
    ) {
      throw new ConvexError('Translation languages must match the original set');
    }

    for (const { text } of args.translations) {
      if (text.trim().length === 0) {
        throw new ConvexError('Translation text must not be empty');
      }
    }

    const cappedTranslations = args.translations.map((t) => ({
      language: t.language,
      text: t.text.slice(0, MAX_CARD_TEXT_LENGTH),
    }));

    // Record which languages the user actually changed (union across
    // repeated edits, the dialog can be reopened). processApproval stores
    // these verbatim as user-provided instead of running the machine
    // post-processing step on them.
    const previousTextByLanguage = new Map(
      approval.translations.map((t) => [t.language, t.text]),
    );
    const userEditedLanguages = new Set(approval.userEditedLanguages ?? []);
    for (const entry of cappedTranslations) {
      if (previousTextByLanguage.get(entry.language) !== entry.text) {
        userEditedLanguages.add(entry.language);
      }
    }

    await ctx.db.patch(args.approvalId, {
      translations: cappedTranslations,
      userEditedLanguages: [...userEditedLanguages],
    });

    return { success: true };
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
    const userId = await requireUser(ctx);

    const approval = await getAuthenticatedPendingApproval(
      ctx,
      args.approvalId,
      userId,
    );

    await ctx.db.patch(args.approvalId, {
      status: 'rejected',
      processedAt: Date.now(),
    });

    // The reject rate is the quality signal for the proposing tool. A rise
    // means the model is proposing things people don't want. `kind` is
    // REQUIRED for that reading to hold: this one mutation backs both the
    // createCard reject and the also-correct dismiss, so without it a rise in
    // "createCard rejects" could just be markAlsoCorrect being dismissed, with
    // no way to separate them after the fact.
    await track(ctx, userId, EVENTS.CHAT_CARD_APPROVAL, {
      outcome: 'rejected',
      kind: approval.kind ?? 'createCard',
      thread_id: approval.threadId,
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
      translations: translationEntriesValidator,
      status: cardApprovalStatusValidator,
      kind: v.optional(cardApprovalKindValidator),
      cardId: v.optional(v.id('cards')),
      resolution: v.optional(cardApprovalResolutionValidator),
      changedLanguages: v.optional(v.array(v.string())),
      proposedMetadata: v.optional(proposedCardMetadataValidator),
      replaceOnly: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const approvals = await ctx.db
      .query('cardApprovals')
      .withIndex('by_thread_and_user', (q) =>
        q.eq('threadId', args.threadId).eq('userId', userId),
      )
      .take(500);

    return approvals.map((a) => ({
      _id: a._id,
      toolCallId: a.toolCallId,
      translations: a.translations,
      status: a.status,
      kind: a.kind,
      cardId: a.cardId,
      resolution: a.resolution,
      changedLanguages: a.changedLanguages,
      proposedMetadata: a.proposedMetadata,
      replaceOnly: a.replaceOnly,
    }));
  },
});
