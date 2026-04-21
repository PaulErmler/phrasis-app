// @ts-expect-error - soundtouchjs ships no types
import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';
import { getDecodeContext } from '@/lib/audio/peakCache';

const BUFFER_SIZE = 4096;

/**
 * Bounded LRU so long sessions (many cards × rates) don't grow the decoded
 * PCM cache without limit. A stretched AudioBuffer for a typical clip is in
 * the hundreds of KB; 32 entries keeps worst-case memory ~10-20 MB.
 */
const CACHE_CAPACITY = 32;

type CacheKey = string;
// Map iteration order is insertion order, so re-inserting on hit promotes to
// the most-recently-used position and the first entry is always the LRU one.
const cache = new Map<CacheKey, AudioBuffer>();

function cacheKey(url: string, rate: number): CacheKey {
  return `${url}|${rate.toFixed(3)}`;
}

function cacheGet(key: CacheKey): AudioBuffer | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: CacheKey, buf: AudioBuffer): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, buf);
  while (cache.size > CACHE_CAPACITY) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Pitch-preserved time stretching of an AudioBuffer via SoundTouchJS.
 *
 * - `rate === 1` short-circuits to the original buffer.
 * - Output duration ≈ input.duration / rate (rate > 1 compresses, < 1 expands).
 * - Pitch is preserved (SoundTouch uses WSOLA, driven by its `tempo` setter).
 *
 * Results are memoised by `(url, rate)` so the same clip/speed pair is only
 * stretched once per page lifetime.
 */
export async function timeStretchBuffer(
  buffer: AudioBuffer,
  rate: number,
  url: string,
): Promise<AudioBuffer> {
  if (!Number.isFinite(rate) || rate === 1) return buffer;

  const key = cacheKey(url, rate);
  const cached = cacheGet(key);
  if (cached) return cached;

  const source = new WebAudioBufferSource(buffer);
  const st = new SoundTouch();
  st.tempo = rate;
  const filter = new SimpleFilter(source, st);

  const estimatedOutLen = Math.ceil(buffer.length / rate);
  // Head room for WSOLA boundary effects; trimmed after extraction.
  const capacity = estimatedOutLen + BUFFER_SIZE * 2;
  const left = new Float32Array(capacity);
  const right = new Float32Array(capacity);

  const interleaved = new Float32Array(BUFFER_SIZE * 2);
  let written = 0;
  // Extract in fixed chunks until the filter is drained.
  while (true) {
    const framesExtracted = filter.extract(interleaved, BUFFER_SIZE);
    if (framesExtracted === 0) break;
    const remaining = capacity - written;
    const n = Math.min(framesExtracted, remaining);
    for (let i = 0; i < n; i++) {
      left[written + i] = interleaved[i * 2];
      right[written + i] = interleaved[i * 2 + 1];
    }
    written += n;
    if (n < framesExtracted) break;
  }

  const ctx = getDecodeContext();
  const channels = buffer.numberOfChannels > 1 ? 2 : 1;
  const out = ctx.createBuffer(channels, written, buffer.sampleRate);
  out.getChannelData(0).set(left.subarray(0, written));
  if (channels === 2) {
    out.getChannelData(1).set(right.subarray(0, written));
  }

  cacheSet(key, out);
  return out;
}
