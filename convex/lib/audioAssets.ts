import { MutationCtx, QueryCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import {
  getTtsProviderForLanguage,
  isTtsVersionStale,
} from '../../lib/languages';
import { shouldOverwriteProvider } from '../../lib/ttsPrecedence';
import { sha256Hex } from './sha256';
import type { TtsProvider, VoiceGender } from '../types';

/**
 * Content-addressed audio store helpers. An `audioAssets` row is keyed by
 * (language, voiceGender, regionVariant, spokenTextHash) and OWNS its storage
 * blob; `audioRecordings` rows are thin (textId, language) → assetId pointers.
 * See the schema comments for the full model.
 */

/**
 * Delay before a blob replaced by an in-place asset swap is reference-checked
 * and deleted. Clients that fetched a signed URL just before the swap can
 * still download the old audio; only after this window is the blob dropped.
 */
export const BLOB_SWAP_DELETE_DELAY_MS = 10 * 60 * 1000;

export interface AudioAssetKey {
  language: string;
  voiceGender: VoiceGender;
  /** Dialect pin for mixed languages; undefined otherwise. */
  regionVariant: string | undefined;
  /** The RAW spoken string, exactly as sent to TTS, never normalized. */
  spokenText: string;
}

export interface AudioAssetPayload {
  storageId: Id<'_storage'>;
  voiceName: string;
  ttsProvider?: TtsProvider;
  ttsQuality?: 'unknown' | 'validated' | 'unvalidated';
  speed: number;
  wordTimings?: { word: string; start: number; end: number }[];
  ttsVersion?: number;
}

/**
 * Exact-key asset lookup. Takes a handful of candidates from the hash index
 * and filters on the raw string, so a hash collision can only cause a miss.
 *
 * Deliberately queries the 4-field PREFIX of `by_key` (voiceName, the fifth
 * column, is left unconstrained): asset identity is gender-level, so any
 * voice of the right gender matches and a regeneration replaces the one
 * shared asset whatever voice it picked. A future favorite-voice feature
 * turns per-voice by adding `.eq('voiceName', …)` here and in
 * `upsertAudioAsset`. The index already supports it.
 */
export async function findAudioAssetByKey(
  ctx: QueryCtx,
  key: AudioAssetKey,
): Promise<Doc<'audioAssets'> | null> {
  const hash = sha256Hex(key.spokenText);
  const candidates = await ctx.db
    .query('audioAssets')
    .withIndex('by_key', (q) =>
      q
        .eq('language', key.language)
        .eq('voiceGender', key.voiceGender)
        .eq('regionVariant', key.regionVariant)
        .eq('spokenTextHash', hash),
    )
    .take(5);
  return candidates.find((a) => a.spokenText === key.spokenText) ?? null;
}

/**
 * Cache lookup for the enqueue paths: the asset for `key`, but only when it is
 * still servable as-is. A stale asset (ttsVersion below the language's current
 * config, provider superseded per lib/ttsPrecedence.ts, or non-current speed)
 * returns null. The caller proceeds to synthesis, whose completion patches
 * the same asset in place by key. Never deletes anything.
 */
export async function findReusableAudioAsset(
  ctx: QueryCtx,
  key: AudioAssetKey,
): Promise<Doc<'audioAssets'> | null> {
  const asset = await findAudioAssetByKey(ctx, key);
  if (!asset) return null;
  if (isTtsVersionStale(key.language, asset.ttsVersion)) return null;
  const currentProvider = getTtsProviderForLanguage(key.language);
  if (shouldOverwriteProvider(currentProvider, asset.ttsProvider ?? 'google')) {
    return null;
  }
  if (asset.speed !== 1) return null;
  return asset;
}

/**
 * Result of `upsertAudioAsset`:
 *  - 'created': no asset existed for the key; a new one owns the payload blob.
 *  - 'replaced': the existing asset was patched to the payload (in-place swap;
 *    `replacedStorageId` is its previous blob when it changed).
 *  - 'kept': the existing asset already carries completed audio and the
 *    incoming write is a mid-flight 'unknown' attempt-0: the asset is left
 *    untouched and the caller must drop the incoming blob.
 */
export interface UpsertAudioAssetResult {
  assetId: Id<'audioAssets'>;
  outcome: 'created' | 'replaced' | 'kept';
  replacedStorageId: Id<'_storage'> | null;
}

/**
 * Find-or-create/patch the asset for `key` with freshly synthesized audio.
 *
 * Replace rules: a COMPLETED synthesis ('validated' or 'unvalidated', a
 * regeneration must land even when its validation failed) always replaces the
 * asset's audio, as does any write while the asset is still mid-flight
 * ('unknown'). Only a mid-flight 'unknown' write against an asset that already
 * has completed audio is refused ('kept'), the attempt-0 early write exists
 * to give a brand-new asset visible audio, not to churn shared audio while a
 * job is still validating.
 */
export async function upsertAudioAsset(
  ctx: MutationCtx,
  key: AudioAssetKey,
  payload: AudioAssetPayload,
): Promise<UpsertAudioAssetResult> {
  const existing = await findAudioAssetByKey(ctx, key);
  if (!existing) {
    const assetId = await ctx.db.insert('audioAssets', {
      language: key.language,
      voiceGender: key.voiceGender,
      ...(key.regionVariant !== undefined
        ? { regionVariant: key.regionVariant }
        : {}),
      spokenTextHash: sha256Hex(key.spokenText),
      spokenText: key.spokenText,
      storageId: payload.storageId,
      voiceName: payload.voiceName,
      ttsProvider: payload.ttsProvider,
      ttsQuality: payload.ttsQuality,
      speed: payload.speed,
      wordTimings: payload.wordTimings,
      ttsVersion: payload.ttsVersion,
    });
    return { assetId, outcome: 'created', replacedStorageId: null };
  }

  const incomingIsFinal =
    payload.ttsQuality === 'validated' || payload.ttsQuality === 'unvalidated';
  // 'unknown' marks a mid-flight asset; undefined (legacy backfill) and the
  // final qualities are completed audio.
  const existingInFlight = existing.ttsQuality === 'unknown';
  if (!incomingIsFinal && !existingInFlight) {
    return { assetId: existing._id, outcome: 'kept', replacedStorageId: null };
  }

  const replacedStorageId =
    existing.storageId !== payload.storageId ? existing.storageId : null;
  await ctx.db.patch(existing._id, {
    storageId: payload.storageId,
    voiceName: payload.voiceName,
    ttsProvider: payload.ttsProvider,
    ttsQuality: payload.ttsQuality,
    speed: payload.speed,
    // `undefined` clears stale timings from the previous blob.
    wordTimings: payload.wordTimings,
    ttsVersion: payload.ttsVersion,
  });
  return { assetId: existing._id, outcome: 'replaced', replacedStorageId };
}

/**
 * Upsert the (textId, language) pointer row → `assetId`. When the row was
 * pointing at a DIFFERENT asset (racing jobs under different keys), the old
 * asset is cleaned up if this row was its last pointer, nothing else
 * garbage-collects a pointerless asset.
 */
export async function upsertAudioPointer(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
  assetId: Id<'audioAssets'>,
): Promise<void> {
  const existing = await ctx.db
    .query('audioRecordings')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('language', language),
    )
    .first();
  if (!existing) {
    await ctx.db.insert('audioRecordings', { textId, language, assetId });
    return;
  }
  if (existing.assetId === assetId) return;
  const previousAssetId = existing.assetId;
  await ctx.db.patch(existing._id, { assetId });
  const stillPointed = await ctx.db
    .query('audioRecordings')
    .withIndex('by_assetId', (q) => q.eq('assetId', previousAssetId))
    .first();
  if (!stillPointed) {
    const previousAsset = await ctx.db.get(previousAssetId);
    if (previousAsset) {
      await ctx.db.delete(previousAsset._id);
      await scheduleBlobSwapDelete(ctx, previousAsset.storageId);
    }
  }
}

/**
 * Schedule the delayed reference-checked delete for a blob that was just
 * superseded (asset in-place swap, orphaned-asset cleanup). The job re-checks
 * `audioAssets.by_storageId` at fire time, so a blob that is still (or again)
 * referenced simply survives.
 */
export async function scheduleBlobSwapDelete(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  await ctx.scheduler.runAfter(
    BLOB_SWAP_DELETE_DELAY_MS,
    internal.features.ttsProcessing.deleteBlobIfUnreferencedJob,
    { storageId },
  );
}

/**
 * The audio a row actually plays. Its asset's payload. `null` means the row
 * carries no usable audio (a dangling pointer whose asset is gone), callers
 * should treat the row as missing audio and let the sweep heal it.
 */
export interface ResolvedAudioPayload {
  storageId: Id<'_storage'>;
  voiceName: string;
  ttsQuality: 'unknown' | 'validated' | 'unvalidated' | undefined;
  ttsProvider: TtsProvider | undefined;
  voiceGender: VoiceGender;
  speed: number;
  wordTimings: { word: string; start: number; end: number }[] | undefined;
  ttsVersion: number | undefined;
  /** The backing asset. */
  asset: Doc<'audioAssets'>;
}

/**
 * Synchronous core of `resolveAudioPayload` for batch callers that fetch the
 * assets themselves (one deduped `db.get` round per batch).
 */
export function audioPayloadFromRowAndAsset(
  asset: Doc<'audioAssets'> | null,
): ResolvedAudioPayload | null {
  if (!asset) return null;
  return {
    storageId: asset.storageId,
    voiceName: asset.voiceName,
    ttsQuality: asset.ttsQuality,
    ttsProvider: asset.ttsProvider,
    voiceGender: asset.voiceGender,
    speed: asset.speed,
    wordTimings: asset.wordTimings,
    ttsVersion: asset.ttsVersion,
    asset,
  };
}

/** Resolve one row's audio payload, fetching its asset. */
export async function resolveAudioPayload(
  ctx: QueryCtx,
  row: Doc<'audioRecordings'>,
): Promise<ResolvedAudioPayload | null> {
  return audioPayloadFromRowAndAsset(await ctx.db.get(row.assetId));
}
