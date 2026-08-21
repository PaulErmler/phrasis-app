import { getDecodeContext } from '@/lib/audio/peakCache';
import { extractChannels, stretchRaw } from '@/lib/audio/audioWorkerClient';

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
 * The WSOLA loop runs in the audio worker (lib/audio/stretch.worker.ts) with
 * a synchronous main-thread fallback. The same stretchCore code either way.
 * Channel data crosses the boundary as transferred ArrayBuffers.
 *
 * Results are memoised by `(url, rate)` so the same clip/speed pair is only
 * stretched once per page lifetime. The LRU stays on the MAIN thread holding
 * ready AudioBuffers: a cache hit returns an OfflineAudioContext-usable
 * buffer with zero postMessage round-trip and zero re-decode.
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

  // The worker path transfers (detaches) the arrays, so the fallback inside
  // stretchRaw re-extracts from `buffer`, which the main thread still owns.
  const out = await stretchRaw(extractChannels(buffer), rate, () =>
    extractChannels(buffer),
  );

  const ctx = getDecodeContext();
  const outBuf = ctx.createBuffer(out.channels.length, out.length, out.sampleRate);
  out.channels.forEach((data, ch) => outBuf.copyToChannel(data, ch));

  cacheSet(key, outBuf);
  return outBuf;
}
