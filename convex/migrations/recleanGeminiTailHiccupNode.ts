'use node';
import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { MPEGDecoder } from 'mpg123-decoder';
import { Mp3Encoder } from '@breezystack/lamejs';
import { trimTailHiccup } from '../lib/tts/tailTrim';

// Matches the in-app encode (convex/lib/tts/gemini.ts): 48 kbps mono MP3.
const MP3_KBPS = 48;

/** Decoded Float32 [-1,1] PCM → 16-bit little-endian PCM bytes (what
 * `trimTailHiccup` consumes). */
function floatToPcm(f32: Float32Array): Uint8Array {
  const out = new Uint8Array(f32.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    dv.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return out;
}

/** 16-bit mono PCM bytes → MP3, same 1152-block + flush path as the in-app
 * provider's `pcmToMp3`. Returns an `ArrayBuffer`-backed view so it's a valid
 * `BlobPart`. */
function pcmToMp3(pcm: Uint8Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const samples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.byteLength / 2),
  );
  const encoder = new Mp3Encoder(1, sampleRate, MP3_KBPS);
  const chunks: Uint8Array[] = [];
  const BLOCK = 1152;
  for (let i = 0; i < samples.length; i += BLOCK) {
    const enc = encoder.encodeBuffer(samples.subarray(i, i + BLOCK));
    if (enc.length > 0) chunks.push(enc);
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(tail);
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Process one page of stored Gemini clips: decode each MP3 to PCM, run the same
 * energy detector as production, and (unless dry-run) re-encode + swap in the
 * clips that actually had a hiccup. Self-continues to the next page. Runs in the
 * Node runtime for the WASM MP3 decoder; `ctx.storage` + `ctx.runQuery/Mutation`
 * work here, `ctx.db` does not (we go through the companion default-runtime file).
 */
export const processBatch = internalAction({
  args: {
    cursor: v.union(v.string(), v.null()),
    dryRun: v.boolean(),
    batchSize: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.runQuery(
      internal.migrations.recleanGeminiTailHiccup.listGeminiAudioPage,
      { cursor: args.cursor, numItems: args.batchSize },
    );

    const decoder = new MPEGDecoder({ enableGapless: true });
    await decoder.ready;
    let trimmed = 0;
    let failed = 0;
    try {
      for (const row of page.rows) {
        try {
          const blob = await ctx.storage.get(row.storageId);
          if (!blob) continue;
          const mp3 = new Uint8Array(await blob.arrayBuffer());
          // Fresh decode per clip — reset clears the previous file's state.
          await decoder.reset();
          const { channelData, sampleRate } = decoder.decode(mp3);
          const f32 = channelData[0] ?? new Float32Array(0);
          if (f32.length === 0) continue;
          const sr = sampleRate || 24000;
          const { pcm: cleaned, trimmed: didTrim } = trimTailHiccup(
            floatToPcm(f32),
            sr,
          );
          if (!didTrim) continue;
          trimmed++;
          if (args.dryRun) continue;
          const newStorageId = await ctx.storage.store(
            new Blob([pcmToMp3(cleaned, sr)], { type: 'audio/mp3' }),
          );
          await ctx.runMutation(
            internal.migrations.recleanGeminiTailHiccup.swapAudioStorageId,
            { recordingId: row.recordingId, newStorageId },
          );
        } catch (err) {
          failed++;
          console.error('[reclean] clip failed', {
            recordingId: row.recordingId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      decoder.free();
    }

    console.log(
      `[reclean] scanned ${page.scanned} (gemini ${page.rows.length}); ` +
        `${trimmed} ${args.dryRun ? 'would trim' : 'trimmed'}; ${failed} failed; ` +
        `isDone=${page.isDone}`,
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.recleanGeminiTailHiccupNode.processBatch,
        {
          cursor: page.continueCursor,
          dryRun: args.dryRun,
          batchSize: args.batchSize,
        },
      );
    }
    return null;
  },
});
