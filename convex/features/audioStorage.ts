import { v, Infer } from 'convex/values';
import { MutationCtx } from '../_generated/server';
import { getCurrentTtsVersion } from '../../lib/languages';
import { deleteStorageBlobIfUnreferenced } from '../lib/audio';
import {
  scheduleBlobSwapDelete,
  upsertAudioAsset,
  upsertAudioPointer,
} from '../lib/audioAssets';
import {
  ttsQualityValidator,
  ttsProviderValidator,
  voiceGenderValidator,
} from '../types';

/**
 * Audio storage: the write path for freshly synthesized TTS audio. Upserts
 * the shared content-addressed `audioAssets` row and attaches the text's
 * `audioRecordings` pointer, guarding against cascade-deleted texts and
 * already-collected blobs, and scheduling the grace-window blob swaps. The
 * registered mutation (`storeAudioRecording`) stays in features/decks.ts and
 * delegates here.
 */

const vStoreAudioRecordingArgs = v.object({
  textId: v.id('texts'),
  language: v.string(),
  voiceName: v.string(),
  storageId: v.id('_storage'),
  ttsQuality: v.optional(ttsQualityValidator),
  ttsProvider: v.optional(ttsProviderValidator),
  voiceGender: voiceGenderValidator,
  speed: v.number(),
  // Word-level timestamps from Scribe, captured during validation. Omit to
  // clear any existing timings (e.g. on a voice swap where they'd be stale).
  wordTimings: v.optional(
    v.array(
      v.object({
        word: v.string(),
        start: v.number(),
        end: v.number(),
      }),
    ),
  ),
  // The RAW string this audio speaks (asset key material), `text.text` for
  // source-language audio, the translation's `translatedText` otherwise.
  spokenText: v.string(),
  // Dialect pin for mixed-language rows; part of the asset key.
  regionVariant: v.optional(v.string()),
});
export const storeAudioRecordingArgs = vStoreAudioRecordingArgs.fields;
export type StoreAudioRecordingArgs = Infer<typeof vStoreAudioRecordingArgs>;

/**
 * Handler body of `storeAudioRecording`: upserts the shared content-addressed
 * `audioAssets` row for (language, voiceGender, regionVariant, spokenText)
 * and points this text's `audioRecordings` row at it. When the asset already
 * exists, a completed synthesis replaces its audio IN PLACE. Every text
 * sharing the string gets the new audio on its next query refresh, while a
 * mid-flight attempt-0 write against completed audio only attaches the
 * pointer and drops its own blob (see `upsertAudioAsset`).
 */
export async function storeAudioRecordingHandler(
  ctx: MutationCtx,
  args: StoreAudioRecordingArgs,
): Promise<null> {
  // Guard: the text may have been cascade-deleted (deleteCardPermanently /
  // editCard cleanup) while this TTS job was in flight. Don't write an orphan
  // audio row against a deleted text; drop the freshly-stored blob (reference-
  // safe, so a shared blob is left untouched) so it isn't leaked. No-op in
  // normal flow (text always exists).
  if ((await ctx.db.get(args.textId)) === null) {
    await deleteStorageBlobIfUnreferenced(ctx, args.storageId);
    return null;
  }

  // Guard: never point an asset at a blob that no longer exists. A cleanup
  // can collect a long-running job's stored blob before this write lands;
  // writing anyway births a dead asset that looks valid ('validated', doc
  // intact) but serves a null URL. Skipping is safe: the claim releases
  // via onComplete and the next ensure sweep re-drives the language.
  if ((await ctx.db.system.get(args.storageId)) === null) {
    console.error(
      '[storeAudioRecording] blob already deleted — refusing to write a dead asset',
      {
        textId: args.textId,
        language: args.language,
        storageId: args.storageId,
      },
    );
    return null;
  }

  const result = await upsertAudioAsset(
    ctx,
    {
      language: args.language,
      voiceGender: args.voiceGender,
      regionVariant: args.regionVariant,
      spokenText: args.spokenText,
    },
    {
      storageId: args.storageId,
      voiceName: args.voiceName,
      ttsProvider: args.ttsProvider,
      ttsQuality: args.ttsQuality,
      speed: args.speed,
      wordTimings: args.wordTimings,
      // Freshly synthesized audio is always produced under the language's
      // CURRENT TTS setup, so stamp the current ttsVersion unconditionally.
      ttsVersion: getCurrentTtsVersion(args.language),
    },
  );
  await upsertAudioPointer(ctx, args.textId, args.language, result.assetId);

  if (result.outcome === 'kept') {
    // The asset already carries completed audio and this was a mid-flight
    // 'unknown' write. The incoming blob is unused BY THE ASSET — but the
    // job that stored it is still running and will reference this very
    // blob in its final (completed) write, which replaces the asset. An
    // immediate delete here killed that blob under the running job, and
    // the final write then either birthed a dead asset (pre blob-guard)
    // or was refused, looping forever. Delayed + reference-checked: if
    // the final write lands the blob into the asset it survives, if the
    // job dies or goes elsewhere it is collected.
    await scheduleBlobSwapDelete(ctx, args.storageId);
  } else if (result.replacedStorageId !== null) {
    // In-place swap: the old blob stays downloadable for a grace window so
    // clients holding a just-issued signed URL don't 404 mid-listen.
    await scheduleBlobSwapDelete(ctx, result.replacedStorageId);
  }
  return null;
}
