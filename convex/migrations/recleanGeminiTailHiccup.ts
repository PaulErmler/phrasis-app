import { v } from 'convex/values';
import { internalQuery, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { deleteStorageBlobIfUnreferenced } from '../lib/audio';

/**
 * One-time backfill: re-clean already-stored Gemini TTS clips that carry the
 * trailing "hiccup" (a short burst after the sentence). Newly synthesized audio
 * is fixed at the source in convex/lib/tts/gemini.ts (`trimTailHiccup`); this
 * sweeps the clips that predate that fix.
 *
 * Stored audio is MP3 and there is no MP3 decoder in the default Convex runtime,
 * so the heavy lifting (decode → detect/trim → re-encode) runs in the companion
 * `"use node"` action `recleanGeminiTailHiccupNode.processBatch`. This file holds
 * the default-runtime glue it needs: the page query and the storage-swap mutation.
 *
 * Only the ~10% of clips that actually contain a hiccup are re-encoded; every
 * other clip is left byte-identical (never re-stored), so the 90% of good audio
 * is untouched. Idempotent: a re-run finds nothing left to trim.
 *
 * Kick off (dry run first — counts how many WOULD change, writes nothing):
 *   convex run migrations/recleanGeminiTailHiccup:run '{"dryRun": true}'
 *   convex run migrations/recleanGeminiTailHiccup:run '{}'
 */
const BATCH_SIZE = 50;

export const run = internalMutation({
  args: { dryRun: v.optional(v.boolean()), batchSize: v.optional(v.number()) },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.recleanGeminiTailHiccupNode.processBatch,
      {
        cursor: null,
        dryRun: args.dryRun ?? false,
        batchSize: args.batchSize ?? BATCH_SIZE,
      },
    );
    return { status: args.dryRun ? 'started (dry run)' : 'started' };
  },
});

/**
 * One page of audio rows, narrowed to Gemini in-code (there's no `ttsProvider`
 * index — full-table scan via pagination, same shape as backfillContentVersions).
 * Returns only the ids the action needs; the action reads the blob via storage.
 */
export const listGeminiAudioPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({
    rows: v.array(
      v.object({
        recordingId: v.id('audioRecordings'),
        storageId: v.id('_storage'),
      }),
    ),
    scanned: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('audioRecordings')
      .paginate({ cursor: args.cursor, numItems: args.numItems });
    const rows = page.page
      .filter((r) => r.ttsProvider === 'gemini')
      .map((r) => ({ recordingId: r._id, storageId: r.storageId }));
    return {
      rows,
      scanned: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * Point a recording at freshly-trimmed audio. Reference-aware: the old blob is
 * dropped only if no other row (e.g. an `editCard` copy on another text) still
 * points at it — reuses the same helper as the live TTS pipeline.
 */
export const swapAudioStorageId = internalMutation({
  args: {
    recordingId: v.id('audioRecordings'),
    newStorageId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rec = await ctx.db.get(args.recordingId);
    if (!rec) {
      // Row was deleted mid-backfill; don't leak the blob we just stored.
      await deleteStorageBlobIfUnreferenced(ctx, args.newStorageId);
      return null;
    }
    const previous = rec.storageId;
    if (previous === args.newStorageId) return null;
    await ctx.db.patch(args.recordingId, { storageId: args.newStorageId });
    await deleteStorageBlobIfUnreferenced(ctx, previous);
    return null;
  },
});
