import { MutationCtx, QueryCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { isAudioAssetReferenced, resolveAudioPayload } from './audioAssets';
import {
  audioPointer,
  audioPointersForTextLanguage,
} from '../db/translationReads';

/**
 * Delete an `audioRecordings` pointer row; when it was the LAST pointer at
 * its asset, the asset is deleted too, and the asset's blob is dropped unless
 * another asset still references it. Assets shared by other texts survive
 * untouched, deleting one text's audio never affects the others.
 *
 * This is the safe audio-delete path. Route `audioRecordings` deletions
 * through it (reconcile invalidation, regen, retranslation, manual regenerate,
 * and orphan cascade) so no blob is ever dropped while still in use.
 *
 * `opts.keepAsset` detaches the pointer but PRESERVES the asset + blob even
 * when this was the last pointer. Use it whenever the audio itself is still
 * correct and only this text stops needing it: card edits, retranslations,
 * speaker-gender re-voicing, accent drift, and provider or ttsVersion
 * changes, which are a new TTS setup rather than obsolescence (every clip
 * is kept per text + gender + accent + provider + version so a setup change
 * can be rolled forward or back cheaply, see convex/lib/audioAssets.ts).
 * The content-addressed `audioAssets` cache keeps serving the string for
 * other texts and for a roll-back. Full garbage collection (the default) is
 * reserved for the manual regenerate button and the orphan cascades.
 *
 * `opts.blobAlreadyGone` skips the storage delete when the blob is already
 * known to be missing (`storage.getUrl` returned null), as in
 * `ensureTextContent`'s stale-file cleanup. Row/asset bookkeeping still
 * runs, but there is no blob left to delete.
 */
export async function deleteAudioRow(
  ctx: MutationCtx,
  row: Doc<'audioRecordings'>,
  opts?: { blobAlreadyGone?: boolean; keepAsset?: boolean },
): Promise<void> {
  await ctx.db.delete(row._id);
  if (opts?.keepAsset) return;

  // Pointer rows AND archived translation revisions count as references.
  if (await isAudioAssetReferenced(ctx, row.assetId)) return;
  const asset = await ctx.db.get(row.assetId);
  if (!asset) return;
  await ctx.db.delete(asset._id);
  if (!opts?.blobAlreadyGone) {
    await deleteStorageBlobIfUnreferenced(ctx, asset.storageId);
  }
}

/**
 * Delete the `audioRecordings` pointers of one (text, language) that speak
 * the wording of one rendering, via the reference-aware `deleteAudioRow`.
 * `variantKey` undefined is the legacy pointer; a key names that key's
 * pointer. Every OTHER key keeps its clip: each keyed row is its own
 * wording, and a wording change on one rendering says nothing about the
 * others (docs/architecture/rendering-keys.md).
 */
export async function deleteAudioRowsForTextLanguage(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
  opts?: { keepAsset?: boolean; variantKey?: string },
): Promise<void> {
  const row = await audioPointer(ctx, textId, language, opts?.variantKey);
  if (row) await deleteAudioRow(ctx, row, opts);
}

/**
 * Delete EVERY pointer of (text, language), legacy and keyed alike. For the
 * manual regenerate button and the cascades that drop a text's audio
 * wholesale.
 */
export async function deleteAllAudioRowsForTextLanguage(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
  opts?: { keepAsset?: boolean },
): Promise<void> {
  const rows = await audioPointersForTextLanguage(ctx, textId, language);
  for (const row of rows) {
    await deleteAudioRow(ctx, row, opts);
  }
}

/**
 * Reference-aware blob delete by `storageId` for callers that no longer hold
 * a referencing document. The blob is deleted only when no `audioAssets` row
 * references it any more.
 */
export async function deleteStorageBlobIfUnreferenced(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  const referencedByAsset = await ctx.db
    .query('audioAssets')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();
  if (referencedByAsset) return;
  // Tolerate already-deleted blobs: two cleanups can race to the same id
  // (each reference-checked correctly), and the loser must not crash its
  // mutation over a blob that is already in the desired state.
  if ((await ctx.db.system.get(storageId)) === null) return;
  await ctx.storage.delete(storageId);
}

export interface AudioWordTiming {
  word: string;
  start: number;
  end: number;
}

export interface AudioResult {
  language: string;
  voiceName: string | null;
  url: string | null;
  wordTimings: AudioWordTiming[] | null;
  /**
   * TTS validation state. 'unknown' while a synthesis attempt is still in
   * flight (the asset is created at attempt 0 before validation), 'validated'
   * after STT roundtrip matched, 'unvalidated' for languages without STT
   * support or when all retries mismatched. Used by callers to decide
   * whether the audio currently behind `url` is the final one.
   */
  ttsQuality: string | null;
}

/**
 * Fetch audio recordings with resolved storage URLs for a single text
 * across the given languages. Resolves each row through its shared
 * `audioAssets` payload (legacy rows fall back to their own fields).
 */
export async function getAudioForText(
  ctx: QueryCtx,
  textId: Id<'texts'>,
  languages: string[],
): Promise<AudioResult[]> {
  const records = await Promise.all(
    languages.map((lang) => audioPointer(ctx, textId, lang)),
  );

  const payloads = await Promise.all(
    records.map((rec) => (rec ? resolveAudioPayload(ctx, rec) : null)),
  );

  const urlEntries = await Promise.all(
    payloads.map((payload) =>
      payload ? ctx.storage.getUrl(payload.storageId) : null,
    ),
  );

  return languages.map((lang, i) => ({
    language: lang,
    voiceName: payloads[i]?.voiceName ?? null,
    url: urlEntries[i] ?? null,
    wordTimings: payloads[i]?.wordTimings ?? null,
    ttsQuality: payloads[i]?.ttsQuality ?? null,
  }));
}
