/**
 * Energy / VAD-lite tail-hiccup trimmer for Gemini TTS PCM.
 *
 * Gemini (via OpenRouter) intermittently appends a short, loud burst AFTER the
 * sentence, separated from it by a silence gap (~10% of clips). This removes it
 * using only the waveform's energy envelope — no STT, no word timings, pure
 * arithmetic that runs in the default Convex runtime, synchronously inside
 * `geminiTts.speak()` before the PCM→MP3 transcode.
 *
 * How: frame the PCM into 15 ms RMS windows → group loud frames into voiced
 * segments (low absolute silence floor so a quiet word-final consonant still
 * counts as speech; bridge brief intra-word dips) → if the LAST segment is short
 * and sits after a CLEAR silence gap, it's the hiccup. Cut in the MIDDLE of that
 * gap (+ a short fade-out): the cut lands in known silence, so it can neither
 * clip the word (it ended before the gap) nor keep the burst (it starts after).
 * No gap detected → the PCM is returned unchanged (the ~90% of clean clips are
 * byte-identical to before).
 *
 * Validated against 100 short German clips: clean clips had a post-speech peak
 * ≈ 0.001, hiccup clips ≈ 0.43–0.75, and this flagged 10/100 — see the
 * scripts/tts-hiccup-* harness, whose `energyCut` this mirrors.
 */

/** RMS window length. */
export const FRAME_MS = 15;
/** Absolute RMS floor (≈ -40 dBFS, normalized 0..1). Below this is silence. */
export const SILENCE_RMS = 0.01;
/** Bridge dips up to this many frames inside one voiced segment (~105 ms) so a
 * low-energy syllable inside a word doesn't split it in two. */
export const MERGE_GAP_FRAMES = 7;
/** A trailing burst must be preceded by at least this much silence (~150 ms). */
export const MIN_TRAIL_GAP_FRAMES = 10;
/** A trailing hiccup is at most this long (~180 ms); longer = real speech. */
export const MAX_BLIP_FRAMES = 12;
/** Linear fade-out applied at the cut so it doesn't click. */
export const FADE_MS = 25;

// Gemini PCM is little-endian, matching the Convex V8 runtime, so the Int16
// view is a no-op reinterpret there; we detect and byte-swap on a (theoretical)
// big-endian host rather than mis-reading sample magnitudes. Mirrors the same
// guard in convex/lib/tts/gemini.ts.
const HOST_IS_LITTLE_ENDIAN =
  new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Copy raw little-endian PCM bytes into a fresh, mutable Int16Array. */
function toInt16(pcm: Uint8Array): Int16Array {
  const bytes = new Uint8Array(pcm); // copy → buffer offset 0, safe to alias
  if (!HOST_IS_LITTLE_ENDIAN) {
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const lo = bytes[i];
      bytes[i] = bytes[i + 1];
      bytes[i + 1] = lo;
    }
  }
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
}

/** Serialize Int16 samples back to little-endian PCM bytes (independent copy). */
function toBytes(samples: Int16Array): Uint8Array {
  const view = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  const out = new Uint8Array(view); // detached copy
  if (!HOST_IS_LITTLE_ENDIAN) {
    for (let i = 0; i + 1 < out.length; i += 2) {
      const lo = out[i];
      out[i] = out[i + 1];
      out[i + 1] = lo;
    }
  }
  return out;
}

/** Per-frame RMS energy (normalized 0..1). */
function frameRms(samples: Int16Array, frameLen: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples.length; i += frameLen) {
    let sum = 0;
    const end = Math.min(i + frameLen, samples.length);
    for (let j = i; j < end; j++) {
      const v = samples[j] / 32768;
      sum += v * v;
    }
    out.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  return out;
}

/** Voiced segments above SILENCE_RMS; `e` is the inclusive last voiced frame.
 * Dips up to MERGE_GAP_FRAMES are bridged so one word stays one segment. */
function segmentVoiced(rms: number[]): Array<{ s: number; e: number }> {
  const segs: Array<{ s: number; e: number }> = [];
  let i = 0;
  while (i < rms.length) {
    if (rms[i] <= SILENCE_RMS) {
      i++;
      continue;
    }
    let e = i;
    let j = i + 1;
    let gap = 0;
    while (j < rms.length) {
      if (rms[j] > SILENCE_RMS) {
        e = j;
        gap = 0;
      } else if (++gap > MERGE_GAP_FRAMES) {
        break;
      }
      j++;
    }
    segs.push({ s: i, e });
    i = e + 1;
  }
  return segs;
}

/** Linear fade-out over the last `fadeLen` samples (mutates in place). */
function fadeOut(samples: Int16Array, fadeLen: number): void {
  const n = Math.min(fadeLen, samples.length);
  for (let i = 0; i < n; i++) {
    const idx = samples.length - n + i;
    samples[idx] = Math.round(samples[idx] * (1 - (i + 1) / n));
  }
}

/**
 * Decide whether the tail holds a hiccup and, if so, where to cut (the middle
 * of the silence gap before the burst). Operates on Int16 samples so it's
 * trivial to unit-test without byte plumbing. `cutSample === samples.length`
 * means "no hiccup, leave it alone".
 */
export function analyzeTail(
  samples: Int16Array,
  sampleRate: number,
): { hiccup: boolean; cutSample: number } {
  const frameLen = Math.max(1, Math.round((FRAME_MS / 1000) * sampleRate));
  const segs = segmentVoiced(frameRms(samples, frameLen));
  if (segs.length >= 2) {
    const last = segs[segs.length - 1];
    const prev = segs[segs.length - 2];
    const gapFrames = last.s - (prev.e + 1);
    const blipFrames = last.e - last.s + 1;
    if (gapFrames >= MIN_TRAIL_GAP_FRAMES && blipFrames <= MAX_BLIP_FRAMES) {
      // Cut in the middle of the silence gap between the speech body and burst.
      const gapMidFrame = (prev.e + 1 + last.s) / 2;
      const cutSample = Math.min(
        samples.length,
        Math.max(1, Math.round(gapMidFrame * frameLen)),
      );
      if (cutSample < samples.length) return { hiccup: true, cutSample };
    }
  }
  return { hiccup: false, cutSample: samples.length };
}

/**
 * Trim a trailing hiccup from raw 16-bit mono PCM. Returns the (possibly
 * shorter) PCM and whether anything was removed. When no hiccup is found, the
 * SAME `pcm` reference is returned so callers stay byte-identical to before.
 */
export function trimTailHiccup(
  pcm: Uint8Array,
  sampleRate: number,
): { pcm: Uint8Array; trimmed: boolean } {
  // Need at least a couple of samples to analyze.
  if (pcm.byteLength < 4) return { pcm, trimmed: false };
  const samples = toInt16(pcm);
  const { hiccup, cutSample } = analyzeTail(samples, sampleRate);
  if (!hiccup) return { pcm, trimmed: false };
  const out = samples.slice(0, cutSample);
  fadeOut(out, Math.round((FADE_MS / 1000) * sampleRate));
  return { pcm: toBytes(out), trimmed: true };
}
