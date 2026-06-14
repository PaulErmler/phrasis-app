/**
 * Per-clip peak loudness cache used to normalize TTS audio to a
 * consistent level across merged playback and single-clip playback.
 *
 * Peak is the max absolute sample value of a decoded audio buffer (channel 0).
 * We target TARGET_PEAK so every clip — merged or standalone — lands at the
 * same output level.
 */

export const TARGET_PEAK = 0.7;

const MIN_GAIN = 0.25;
const MAX_GAIN = 4.0;

const peakCache = new Map<string, number>();
const inflight = new Map<string, Promise<number>>();

let sharedCtx: AudioContext | null = null;

export function getDecodeContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext();
  }
  return sharedCtx;
}

export function computePeakFromBuffer(buffer: AudioBuffer, url?: string): number {
  if (url) {
    const cached = peakCache.get(url);
    if (cached !== undefined) return cached;
  }
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    const abs = v < 0 ? -v : v;
    if (abs > peak) peak = abs;
  }
  if (peak === 0) peak = 1;
  if (url) peakCache.set(url, peak);
  return peak;
}

export async function getPeak(url: string): Promise<number> {
  const cached = peakCache.get(url);
  if (cached !== undefined) return cached;

  const pending = inflight.get(url);
  if (pending) return pending;

  const task = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status} ${res.statusText} for ${url}`);
    const arrayBuf = await res.arrayBuffer();
    const ctx = getDecodeContext();
    const buffer = await ctx.decodeAudioData(arrayBuf);
    return computePeakFromBuffer(buffer, url);
  })();
  inflight.set(url, task);
  try {
    return await task;
  } finally {
    inflight.delete(url);
  }
}

export function computeGain(peak: number): number {
  const gain = TARGET_PEAK / peak;
  if (gain < MIN_GAIN) return MIN_GAIN;
  if (gain > MAX_GAIN) return MAX_GAIN;
  return gain;
}

export function computeAttenuation(peak: number): number {
  return Math.min(1, TARGET_PEAK / peak);
}
