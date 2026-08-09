import { MutationCtx, QueryCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { resolveAudioPayload } from './audioAssets';

/**
 * Delete an `audioRecordings` pointer row; when it was the LAST pointer at
 * its asset, the asset is deleted too, and the asset's blob is dropped unless
 * another asset still references it. Assets shared by other texts survive
 * untouched — deleting one text's audio never affects the others.
 *
 * This is the safe audio-delete path — route `audioRecordings` deletions
 * through it (reconcile invalidation, regen, retranslation, manual regenerate,
 * and orphan cascade) so no blob is ever dropped while still in use.
 *
 * `opts.blobAlreadyGone` skips the storage delete when the blob is already
 * known to be missing (`storage.getUrl` returned null), as in
 * `scheduleMissingContent`'s stale-file cleanup — row/asset bookkeeping still
 * runs, but there is no blob left to delete.
 */
export async function deleteAudioRow(
  ctx: MutationCtx,
  row: Doc<'audioRecordings'>,
  opts?: { blobAlreadyGone?: boolean },
): Promise<void> {
  await ctx.db.delete(row._id);

  const stillPointed = await ctx.db
    .query('audioRecordings')
    .withIndex('by_assetId', (q) => q.eq('assetId', row.assetId))
    .first();
  if (stillPointed) return;
  const asset = await ctx.db.get(row.assetId);
  if (!asset) return;
  await ctx.db.delete(asset._id);
  if (!opts?.blobAlreadyGone) {
    await deleteStorageBlobIfUnreferenced(ctx, asset.storageId);
  }
}

/**
 * Delete every `audioRecordings` row for one (text, language) via the
 * reference-aware `deleteAudioRow`. The `take(10)` cap bounds the read; a
 * language has at most a couple of rows (one per voice) in practice.
 */
export async function deleteAudioRowsForTextLanguage(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
): Promise<void> {
  const rows = await ctx.db
    .query('audioRecordings')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('language', language),
    )
    .take(10);
  for (const row of rows) {
    await deleteAudioRow(ctx, row);
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
   * TTS validation state — 'unknown' while a synthesis attempt is still in
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
    languages.map((lang) =>
      ctx.db
        .query('audioRecordings')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', textId).eq('language', lang),
        )
        .first(),
    ),
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
