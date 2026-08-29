import { ConvexError, v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import {
  MAX_CARD_TEXT_LENGTH,
  WRITING_ALTERNATIVES_MAX,
} from '../../lib/constants/learning';
import { normalizeForComparison } from '../lib/textComparison';
import {
  findAudioAssetByKey,
  scheduleBlobSwapDelete,
  upsertAudioAsset,
} from '../lib/audioAssets';
import { deleteStorageBlobIfUnreferenced } from '../lib/audio';
import { synthesizeSpeech } from './tts';
import {
  getCurrentTtsVersion,
  getTtsProviderForLanguage,
} from '../../lib/languages';
import {
  getVoiceForLanguage,
  resolveAudioSpeakerGender,
} from '../../lib/voices';
import { reserveRateLimitToken } from '../lib/rateLimitReserve';
import { TTS_RATE_LIMIT_BY_PROVIDER } from '../rateLimiter';
import { requireAuthUserId } from '../db/users';
import { captureGeneration } from '../lib/posthogAi';
import { costForCharacters } from '../config/aiCosts';
import { ttsProviderValidator, voiceGenderValidator } from '../types';

/**
 * Storage + content generation for writing-mode accepted alternatives.
 *
 * A `writingAlternatives` row is loose text with no `texts` row, exactly
 * like a chat card proposal, so content follows the approval model
 * (chat/approvalAudio.ts): annotations are written onto the row itself
 * (Node action in writingAlternativesNode.ts — espeak/lindera), and audio
 * goes through the content-addressed `audioAssets` store, reusing any
 * existing asset for the same sentence before synthesizing once.
 *
 * Unlike approval audio (click-to-request), generation is EAGER on store:
 * at most WRITING_ALTERNATIVES_MAX rows per (card, language), each stored at
 * most once, and the learner just proved they care about this sentence.
 */

/**
 * Insert an accepted alternative, dedupe against the primary and existing
 * rows, evict oldest past the cap, and schedule annotation + audio
 * generation. Shared by the AI-feedback grader (writingFeedback.ts) and the
 * chat "add as alternative" accept path (chat/cardApprovals.ts). Returns
 * null when nothing was stored (duplicate/empty).
 */
export async function storeWritingAlternative(
  ctx: MutationCtx,
  args: {
    userId: string;
    cardId: Id<'cards'>;
    language: string;
    text: string;
    primary: string;
  },
): Promise<Id<'writingAlternatives'> | null> {
  const text = args.text.slice(0, MAX_CARD_TEXT_LENGTH).trim();
  if (!text) return null;
  const normalized = normalizeForComparison(text);
  if (normalized === normalizeForComparison(args.primary)) return null;

  const existing = await ctx.db
    .query('writingAlternatives')
    .withIndex('by_cardId_and_language', (q) =>
      q.eq('cardId', args.cardId).eq('language', args.language),
    )
    .take(WRITING_ALTERNATIVES_MAX * 2);
  if (existing.some((r) => normalizeForComparison(r.text) === normalized)) {
    return null;
  }

  // Evict oldest rows down to cap-1 before inserting. `_creationTime`
  // ascending is the index default, so `existing` is oldest-first.
  for (const row of existing.slice(
    0,
    Math.max(0, existing.length - (WRITING_ALTERNATIVES_MAX - 1)),
  )) {
    await ctx.db.delete(row._id);
  }

  const alternativeId = await ctx.db.insert('writingAlternatives', {
    userId: args.userId,
    cardId: args.cardId,
    language: args.language,
    text,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.features.writingAlternativesNode.generateAlternativeAnnotations,
    { alternativeId },
  );
  await ctx.scheduler.runAfter(
    0,
    internal.features.writingAlternatives.generateAlternativeAudio,
    { alternativeId },
  );
  return alternativeId;
}

/**
 * The caller's stored accepted alternatives for one card, all languages.
 * Rows are per-user (a shared curriculum card can hold several users' rows),
 * so the index read is filtered to the caller — the index doesn't carry
 * userId. Feeds the edit dialog; the review payload gets its (richer,
 * annotated) copy from getCardForReview instead.
 */
export const listForCard = query({
  args: { cardId: v.id('cards') },
  returns: v.array(
    v.object({
      _id: v.id('writingAlternatives'),
      language: v.string(),
      text: v.string(),
    }),
  ),
  handler: async (ctx, { cardId }) => {
    const userId = await requireAuthUserId(ctx);
    const rows = await ctx.db
      .query('writingAlternatives')
      .withIndex('by_cardId_and_language', (q) => q.eq('cardId', cardId))
      .take(100); // bounded: WRITING_ALTERNATIVES_MAX per language
    return rows
      .filter((r) => r.userId === userId)
      .map((r) => ({ _id: r._id, language: r.language, text: r.text }));
  },
});

/** The card's primary sentence for a language (source text or translation row). */
async function primaryTextForLanguage(
  ctx: MutationCtx,
  cardId: Id<'cards'>,
  language: string,
): Promise<string | null> {
  const card = await ctx.db.get(cardId);
  if (!card) return null;
  const text = await ctx.db.get(card.textId);
  if (!text) return null;
  if (text.language === language) return text.text;
  const row = await ctx.db
    .query('translations')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', card.textId).eq('targetLanguage', language),
    )
    .first();
  return row?.translatedText ?? null;
}

/**
 * Reword a stored accepted alternative (edit dialog). Applies the same
 * dedupe rule as `storeWritingAlternative`: a new wording that now equals
 * the card's primary or another stored row deletes this row instead of
 * patching it — the reactive list simply loses the entry. A real reword
 * clears the row's annotations + audio pointer (they describe the old
 * sentence) and reschedules generation. No quota: per-user rows, no
 * curriculum fork, no cardEdits audit event.
 */
export const updateAlternative = mutation({
  args: { alternativeId: v.id('writingAlternatives'), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const row = await ctx.db.get(args.alternativeId);
    if (!row)
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Alternative not found',
      });
    if (row.userId !== userId)
      throw new ConvexError({ code: 'FORBIDDEN', message: 'Unauthorized' });

    const text = args.text.slice(0, MAX_CARD_TEXT_LENGTH).trim();
    if (!text)
      throw new ConvexError({
        code: 'EMPTY_TEXT',
        message: 'Alternative text cannot be empty',
      });
    const normalized = normalizeForComparison(text);
    if (normalized === normalizeForComparison(row.text)) return null;

    const primary = await primaryTextForLanguage(ctx, row.cardId, row.language);
    if (primary !== null && normalized === normalizeForComparison(primary)) {
      await ctx.db.delete(row._id);
      return null;
    }
    const siblings = await ctx.db
      .query('writingAlternatives')
      .withIndex('by_cardId_and_language', (q) =>
        q.eq('cardId', row.cardId).eq('language', row.language),
      )
      .take(WRITING_ALTERNATIVES_MAX * 2);
    if (
      siblings.some(
        (r) =>
          r._id !== row._id && normalizeForComparison(r.text) === normalized,
      )
    ) {
      await ctx.db.delete(row._id);
      return null;
    }

    await ctx.db.patch(row._id, {
      text,
      romanizedText: undefined,
      ipaText: undefined,
      furiganaText: undefined,
      audioAssetId: undefined,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.features.writingAlternativesNode.generateAlternativeAnnotations,
      { alternativeId: row._id },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.features.writingAlternatives.generateAlternativeAudio,
      { alternativeId: row._id },
    );
    return null;
  },
});

/**
 * Delete a stored accepted alternative (edit dialog). The audio asset is
 * shared and content-addressed, so it is left alone — exactly as card
 * deletion treats these rows.
 */
export const deleteAlternative = mutation({
  args: { alternativeId: v.id('writingAlternatives') },
  returns: v.null(),
  handler: async (ctx, { alternativeId }) => {
    const userId = await requireAuthUserId(ctx);
    const row = await ctx.db.get(alternativeId);
    if (!row)
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Alternative not found',
      });
    if (row.userId !== userId)
      throw new ConvexError({ code: 'FORBIDDEN', message: 'Unauthorized' });
    await ctx.db.delete(row._id);
    return null;
  },
});

const alternativeContextValidator = v.union(
  v.null(),
  v.object({
    text: v.string(),
    language: v.string(),
    /** Preferred-first gender candidates for asset lookup / synthesis. */
    genders: v.array(voiceGenderValidator),
    /** Asset already covering this sentence (either gender), if any. */
    reusableAssetId: v.union(v.id('audioAssets'), v.null()),
    hasAudio: v.boolean(),
    /** Owner of the alternative; synthesis cost bills to them. */
    userId: v.string(),
  }),
);

export type AlternativeContext = {
  text: string;
  language: string;
  genders: ('male' | 'female')[];
  reusableAssetId: Id<'audioAssets'> | null;
  hasAudio: boolean;
  userId: string;
} | null;

/**
 * Everything the generation actions need in one read. Gender prefers the
 * card text's resolved audio speaker so the alternative matches the voice
 * the learner hears on the card; both genders are probed for reuse.
 */
export const getAlternativeContext = internalQuery({
  args: { alternativeId: v.id('writingAlternatives') },
  returns: alternativeContextValidator,
  handler: async (ctx, { alternativeId }) => {
    const row = await ctx.db.get(alternativeId);
    if (!row) return null;
    const card = await ctx.db.get(row.cardId);
    const text = card ? await ctx.db.get(card.textId) : null;
    const primaryGender = resolveAudioSpeakerGender(
      text?.audioSpeakerGender ?? text?.speakerGender,
      alternativeId,
    );
    const genders: ('male' | 'female')[] = [
      primaryGender,
      primaryGender === 'male' ? 'female' : 'male',
    ];
    let reusableAssetId: Id<'audioAssets'> | null = null;
    for (const voiceGender of genders) {
      const asset = await findAudioAssetByKey(ctx, {
        language: row.language,
        voiceGender,
        // Alternatives carry no dialect pin, matching approval audio keys.
        regionVariant: undefined,
        spokenText: row.text,
      });
      if (asset) {
        reusableAssetId = asset._id;
        break;
      }
    }
    return {
      text: row.text,
      language: row.language,
      genders,
      reusableAssetId,
      hasAudio: row.audioAssetId !== undefined,
      userId: row.userId,
    };
  },
});

export const storeAlternativeAnnotations = internalMutation({
  args: {
    alternativeId: v.id('writingAlternatives'),
    romanizedText: v.optional(v.string()),
    ipaText: v.optional(v.string()),
    furiganaText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { alternativeId, ...fields }) => {
    if ((await ctx.db.get(alternativeId)) === null) return null; // evicted
    await ctx.db.patch(alternativeId, fields);
    return null;
  },
});

export const attachAlternativeAudio = internalMutation({
  args: {
    alternativeId: v.id('writingAlternatives'),
    assetId: v.id('audioAssets'),
  },
  returns: v.null(),
  handler: async (ctx, { alternativeId, assetId }) => {
    if ((await ctx.db.get(alternativeId)) === null) return null; // evicted
    await ctx.db.patch(alternativeId, { audioAssetId: assetId });
    return null;
  },
});

/**
 * Persist a fresh synthesis as a shared asset and point the row at it.
 * Same defer-to-completed semantics as chat/approvalAudio.ts: completed
 * (possibly validated) audio that landed for the key meanwhile wins.
 */
export const saveAlternativeAudio = internalMutation({
  args: {
    alternativeId: v.id('writingAlternatives'),
    language: v.string(),
    voiceGender: voiceGenderValidator,
    spokenText: v.string(),
    storageId: v.id('_storage'),
    voiceName: v.string(),
    provider: ttsProviderValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const key = {
      language: args.language,
      voiceGender: args.voiceGender,
      regionVariant: undefined,
      spokenText: args.spokenText,
    };
    const existing = await findAudioAssetByKey(ctx, key);
    let assetId: Id<'audioAssets'>;
    if (existing && existing.ttsQuality !== 'unknown') {
      await deleteStorageBlobIfUnreferenced(ctx, args.storageId);
      assetId = existing._id;
    } else {
      if ((await ctx.db.system.get(args.storageId)) === null) return null;
      const result = await upsertAudioAsset(ctx, key, {
        storageId: args.storageId,
        voiceName: args.voiceName,
        ttsProvider: args.provider,
        ttsQuality: 'unvalidated',
        speed: 1,
        ttsVersion: getCurrentTtsVersion(args.language),
      });
      if (result.outcome === 'kept') {
        await deleteStorageBlobIfUnreferenced(ctx, args.storageId);
      } else if (result.replacedStorageId) {
        await scheduleBlobSwapDelete(ctx, result.replacedStorageId);
      }
      assetId = result.assetId;
    }
    if ((await ctx.db.get(args.alternativeId)) !== null) {
      await ctx.db.patch(args.alternativeId, { audioAssetId: assetId });
    }
    return null;
  },
});

/**
 * Ensure audio for one alternative: reuse any existing asset for the
 * sentence, else synthesize once ('unvalidated', like approval previews —
 * there is no text row for the validation loop).
 */
export const generateAlternativeAudio = internalAction({
  args: { alternativeId: v.id('writingAlternatives') },
  returns: v.null(),
  handler: async (ctx, { alternativeId }) => {
    const context: AlternativeContext = await ctx.runQuery(
      internal.features.writingAlternatives.getAlternativeContext,
      { alternativeId },
    );
    if (!context || context.hasAudio) return null;
    if (context.reusableAssetId) {
      await ctx.runMutation(
        internal.features.writingAlternatives.attachAlternativeAudio,
        { alternativeId, assetId: context.reusableAssetId },
      );
      return null;
    }

    const voiceGender = context.genders[0];
    const provider = getTtsProviderForLanguage(context.language);
    const voiceName = getVoiceForLanguage(context.language, voiceGender);
    await reserveRateLimitToken(
      ctx,
      TTS_RATE_LIMIT_BY_PROVIDER[provider] ?? 'googleTts',
      { maxWaitMs: 30_000 },
    );
    const startedAt = Date.now();
    const blob = await synthesizeSpeech(
      context.text,
      voiceName,
      1,
      provider,
      context.language,
    );
    await captureGeneration(ctx, {
      distinctId: context.userId,
      feature: 'tts_synthesis',
      model: voiceName,
      provider,
      latencyMs: Date.now() - startedAt,
      costUsd:
        provider === 'google'
          ? costForCharacters('googleTts', context.text.length)
          : undefined,
      sharedContent: true,
      extra: {
        language: context.language,
        character_count: context.text.length,
        source: 'writing_alternative',
      },
    });
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(
      internal.features.writingAlternatives.saveAlternativeAudio,
      {
        alternativeId,
        language: context.language,
        voiceGender,
        spokenText: context.text,
        storageId,
        voiceName,
        provider,
      },
    );
    return null;
  },
});
