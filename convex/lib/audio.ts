import { MutationCtx, QueryCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';

/**
 * Delete an `audioRecordings` row and, only when it is the LAST row referencing
 * its storage blob, delete the blob too.
 *
 * Blobs can be shared across rows/texts: `editCard` (convex/features/scheduling.ts)
 * copies a text's audio into a new text by reusing the same `storageId` instead
 * of re-synthesizing. Deleting a blob whenever any one row goes away would
 * corrupt the other text's audio. The reverse lookup uses the `by_storageId`
 * index; because the row is deleted first, the query naturally excludes it and
 * a remaining match means the blob is still referenced.
 *
 * This is the safe audio-delete path — route `audioRecordings` deletions through
 * it (reconcile invalidation, regen, retranslation, manual regenerate, and orphan
 * cascade) so no blob is ever dropped while still in use. The one exception is a
 * row whose blob is already known to be gone (`storage.getUrl` returned null), as
 * in `scheduleMissingContent`'s stale-file cleanup: there is no blob left to
 * reference-protect, so a plain `ctx.db.delete(row._id)` is correct there.
 */
export async function deleteAudioRow(
  ctx: MutationCtx,
  row: Doc<'audioRecordings'>,
): Promise<void> {
  await ctx.db.delete(row._id);
  const stillReferenced = await ctx.db
    .query('audioRecordings')
    .withIndex('by_storageId', (q) => q.eq('storageId', row.storageId))
    .first();
  if (!stillReferenced) {
    await ctx.storage.delete(row.storageId);
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
 * Reference-aware blob delete by `storageId` for callers that no longer hold the
 * row (e.g. `storeAudioRecording` after patching a row to a NEW blob). Deletes
 * the old blob only when no `audioRecordings` row references it any more.
 */
export async function deleteStorageBlobIfUnreferenced(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  const stillReferenced = await ctx.db
    .query('audioRecordings')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();
  if (!stillReferenced) {
    await ctx.storage.delete(storageId);
  }
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
   * flight (the row is inserted at attempt 0 before validation), 'validated'
   * after STT roundtrip matched, 'unvalidated' for languages without STT
   * support or when all retries mismatched. Used by callers to decide
   * whether the audio currently behind `url` is the final one.
   */
  ttsQuality: string | null;
}

/**
 * Fetch audio recordings with resolved storage URLs for a single text
 * across the given languages.
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

  const urlEntries = await Promise.all(
    records.map((rec) =>
      rec?.storageId ? ctx.storage.getUrl(rec.storageId) : null,
    ),
  );

  return languages.map((lang, i) => ({
    language: lang,
    voiceName: records[i]?.voiceName ?? null,
    url: urlEntries[i] ?? null,
    wordTimings: records[i]?.wordTimings ?? null,
    ttsQuality: records[i]?.ttsQuality ?? null,
  }));
}
