import { v, ConvexError } from 'convex/values';
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from '../../_generated/server';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import { getAuthUserId, requireAuthUserId } from '../../db/users';
import {
  findAudioAssetByKey,
  scheduleBlobSwapDelete,
  upsertAudioAsset,
} from '../../lib/audioAssets';
import { deleteStorageBlobIfUnreferenced } from '../../lib/audio';
import { synthesizeSpeech } from '../tts';
import {
  getCurrentTtsVersion,
  getTtsProviderForLanguage,
} from '../../../lib/languages';
import {
  getVoiceForLanguage,
  resolveAudioSpeakerGender,
} from '../../../lib/voices';
import { reserveRateLimitToken } from '../../lib/rateLimitReserve';
import { TTS_RATE_LIMIT_BY_PROVIDER } from '../../rateLimiter';
import { captureGeneration } from '../../lib/posthogAi';
import { costForCharacters } from '../../config/aiCosts';
import { ttsProviderValidator, voiceGenderValidator } from '../../types';

/**
 * On-demand audio for chat card PROPOSALS (cardApprovals) — the play icon on
 * a proposal line, mirroring the collection preview's audio-icon click.
 *
 * A proposal has no `texts` row yet, so there is nothing for the regular
 * (textId, language) TTS pipeline to attach to. Instead the click goes
 * straight to the content-addressed `audioAssets` store: play whatever asset
 * already exists for the sentence, otherwise synthesize once and upsert the
 * asset. When the card is later approved, the ensure sweep's
 * `findReusableAudioAsset` finds that same asset by content key and just
 * points at it — the proposal click pre-pays the synthesis.
 *
 * Voice gender: the eventual card's gender comes from sentence metadata
 * (LLM), which doesn't exist yet at proposal time. We pick a deterministic
 * gender from the approval id so every line of one proposal shares a single
 * speaker, and we accept that a later metadata verdict may differ (the sweep
 * then synthesizes that gender fresh — same cost as having never clicked).
 * Lookups check BOTH genders so an asset synthesized by any other path is
 * reused regardless of the coin flip.
 *
 * Like the collection preview: free (no quota) — the click is the cost
 * control — and validation-free (single-shot synthesis, stored
 * 'unvalidated'; there is no text row for the validate loop's claims).
 */

/** Deterministic per-approval speaker, preferred-first lookup order. */
function approvalGenderCandidates(
  approvalId: string,
): ['male' | 'female', 'male' | 'female'] {
  const primary = resolveAudioSpeakerGender(undefined, approvalId);
  return [primary, primary === 'male' ? 'female' : 'male'];
}

async function findAssetForLine(
  ctx: QueryCtx,
  approvalId: string,
  language: string,
  spokenText: string,
): Promise<Doc<'audioAssets'> | null> {
  for (const voiceGender of approvalGenderCandidates(approvalId)) {
    const asset = await findAudioAssetByKey(ctx, {
      language,
      voiceGender,
      // Proposal translations carry no dialect pin — matches the rows
      // `processApproval` later inserts (also variant-free), so the ensure
      // sweep looks up the exact same key.
      regionVariant: undefined,
      spokenText,
    });
    if (asset) return asset;
  }
  return null;
}

/**
 * Per-line playback URLs for one proposal. Lines without a cached asset get
 * `url: null` — the client renders those as click-to-generate. Reactive: the
 * URL lands here as soon as `synthesizeApprovalAudio`'s upsert commits.
 */
export const getApprovalAudio = query({
  args: { approvalId: v.id('cardApprovals') },
  returns: v.array(
    v.object({
      language: v.string(),
      url: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const approval = await ctx.db.get(args.approvalId);
    if (!approval || approval.userId !== userId) return [];

    return Promise.all(
      approval.translations.map(async (entry) => {
        const asset =
          entry.text.length > 0
            ? await findAssetForLine(
                ctx,
                args.approvalId,
                entry.language,
                entry.text,
              )
            : null;
        return {
          language: entry.language,
          url: asset ? await ctx.storage.getUrl(asset.storageId) : null,
        };
      }),
    );
  },
});

/**
 * Generate audio for ONE proposal line — the play-icon click. No-ops when an
 * asset already exists for the sentence (either gender); the reactive
 * `getApprovalAudio` query delivers the URL when synthesis completes.
 */
export const requestApprovalAudio = mutation({
  args: {
    approvalId: v.id('cardApprovals'),
    language: v.string(),
  },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const approval = await ctx.db.get(args.approvalId);
    if (!approval || approval.userId !== userId) {
      throw new ConvexError('Approval not found');
    }
    const entry = approval.translations.find(
      (t) => t.language === args.language,
    );
    if (!entry) throw new ConvexError('Language not on this card proposal');
    if (entry.text.length === 0) return { scheduled: false };

    const existing = await findAssetForLine(
      ctx,
      args.approvalId,
      args.language,
      entry.text,
    );
    if (existing) return { scheduled: false };

    // In-flight dedup: between the click and the asset landing,
    // findAssetForLine still misses — a second click here would schedule a
    // second PAID synthesis (the storage race downstream only cleans up the
    // loser's blob, not its cost). Concurrent clicks serialize on this
    // mutation's transaction, so the marker is race-free.
    const inFlight = approval.audioRequests?.[args.language];
    if (
      inFlight &&
      inFlight.text === entry.text &&
      Date.now() - inFlight.requestedAt < APPROVAL_TTS_IN_FLIGHT_MS
    ) {
      return { scheduled: false };
    }
    await ctx.db.patch(args.approvalId, {
      audioRequests: {
        ...approval.audioRequests,
        [args.language]: { requestedAt: Date.now(), text: entry.text },
      },
    });

    const voiceGender = approvalGenderCandidates(args.approvalId)[0];
    await ctx.scheduler.runAfter(
      0,
      internal.features.chat.approvalAudio.synthesizeApprovalAudio,
      {
        approvalId: args.approvalId,
        language: args.language,
        spokenText: entry.text,
        voiceGender,
        voiceName: getVoiceForLanguage(args.language, voiceGender),
        provider: getTtsProviderForLanguage(args.language),
      },
    );
    return { scheduled: true };
  },
});

// Matches the TTS pipeline's per-synthesis token wait; a busy provider makes
// the click fail fast (spinner times out client-side) instead of queueing.
const APPROVAL_TTS_TOKEN_MAX_WAIT_MS = 5_000;

// How long a scheduled synthesis blocks re-requests for the same line.
// Comfortably above token wait + synthesis + upsert; short enough that a
// failed synthesis leaves the play icon retryable, not dead.
const APPROVAL_TTS_IN_FLIGHT_MS = 2 * 60 * 1000;

/**
 * Single-shot synthesis for a proposal line. Rate-limit metered and
 * cost-tracked exactly like the pipeline's synthesis step; the result lands
 * as a shared `audioAssets` row via `saveApprovalAudioAsset`.
 */
export const synthesizeApprovalAudio = internalAction({
  args: {
    approvalId: v.id('cardApprovals'),
    language: v.string(),
    spokenText: v.string(),
    voiceGender: voiceGenderValidator,
    voiceName: v.string(),
    provider: ttsProviderValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await reserveRateLimitToken(
      ctx,
      TTS_RATE_LIMIT_BY_PROVIDER[args.provider] ?? 'googleTts',
      { maxWaitMs: APPROVAL_TTS_TOKEN_MAX_WAIT_MS },
    );
    const synthStartedAt = Date.now();
    const blob = await synthesizeSpeech(
      args.spokenText,
      args.voiceName,
      1,
      args.provider,
      args.language,
    );
    await captureGeneration(ctx, {
      feature: 'tts_synthesis',
      model: args.voiceName,
      provider: args.provider,
      latencyMs: Date.now() - synthStartedAt,
      costUsd:
        args.provider === 'google'
          ? costForCharacters('googleTts', args.spokenText.length)
          : undefined,
      sharedContent: true,
      extra: {
        approval_id: args.approvalId,
        language: args.language,
        character_count: args.spokenText.length,
        source: 'chat_approval_preview',
      },
    });
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(
      internal.features.chat.approvalAudio.saveApprovalAudioAsset,
      {
        language: args.language,
        voiceGender: args.voiceGender,
        spokenText: args.spokenText,
        storageId,
        voiceName: args.voiceName,
        provider: args.provider,
      },
    );
    return null;
  },
});

/**
 * Persist a proposal synthesis as a shared asset. Defers to any completed
 * audio that landed for the key while we were synthesizing (the regular
 * pipeline's output may be validated — a preview must never clobber it);
 * otherwise find-or-create with 'unvalidated' quality. Loser blobs are
 * reference-check deleted, replaced blobs go through the standard delayed
 * swap delete.
 */
export const saveApprovalAudioAsset = internalMutation({
  args: {
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
    if (existing && existing.ttsQuality !== 'unknown') {
      // Completed audio (possibly validated) beat us to the key — keep it.
      await deleteStorageBlobIfUnreferenced(ctx, args.storageId);
      return null;
    }
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
    return null;
  },
});
