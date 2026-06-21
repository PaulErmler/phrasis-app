import { describe, it, expect } from 'vitest';
import {
  analyzeTail,
  trimTailHiccup,
  MAX_BLIP_FRAMES,
} from '../../../lib/tts/tailTrim';

const SR = 24000; // Gemini PCM sample rate

/** A run of `ms` audio. amp 0 = silence; otherwise alternating ±amp so every
 * frame's RMS is exactly amp/32768 (deterministic, no DC). */
function seg(ms: number, amp: number): Int16Array {
  const n = Math.round((ms / 1000) * SR);
  const a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = i % 2 === 0 ? amp : -amp;
  return a;
}

function concat(...parts: Int16Array[]): Int16Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Int16Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function toPcm(samples: Int16Array): Uint8Array {
  const u8 = new Uint8Array(samples.length * 2);
  const dv = new DataView(u8.buffer);
  for (let i = 0; i < samples.length; i++) dv.setInt16(i * 2, samples[i], true);
  return u8;
}

const LOUD = 8000; // RMS ≈ 0.24
const ms = (n: number) => Math.round((n / 1000) * SR); // ms → sample index

describe('analyzeTail — detection', () => {
  it('flags a loud burst after a clear silence gap and cuts inside the gap', () => {
    const s = concat(seg(800, LOUD), seg(250, 0), seg(100, LOUD));
    const { hiccup, cutSample } = analyzeTail(s, SR);
    expect(hiccup).toBe(true);
    // Cut lands in the silence gap: after the speech (800ms), before the burst (1050ms).
    expect(cutSample).toBeGreaterThan(ms(800));
    expect(cutSample).toBeLessThan(ms(1050));
  });

  it('leaves a clip that is just speech + trailing silence alone', () => {
    const s = concat(seg(800, LOUD), seg(300, 0));
    expect(analyzeTail(s, SR).hiccup).toBe(false);
  });

  it('does NOT clip a quiet (low-energy) word ending — no false gap', () => {
    // A quiet final consonant (just above the silence floor) is bridged into the
    // word, not mistaken for silence + a trailing burst.
    const s = concat(seg(700, LOUD), seg(150, 400));
    expect(analyzeTail(s, SR).hiccup).toBe(false);
  });

  it('leaves a burst that hugs the word (gap below the minimum) alone', () => {
    // ~120 ms gap: too small to be a confident trailing hiccup → conservative no-op.
    const s = concat(seg(800, LOUD), seg(120, 0), seg(100, LOUD));
    expect(analyzeTail(s, SR).hiccup).toBe(false);
  });

  it('does not treat a long trailing segment (real speech) as a hiccup', () => {
    const longMs = (MAX_BLIP_FRAMES + 8) * 15; // well over the blip ceiling
    const s = concat(seg(500, LOUD), seg(250, 0), seg(longMs, LOUD));
    expect(analyzeTail(s, SR).hiccup).toBe(false);
  });
});

describe('trimTailHiccup — PCM bytes', () => {
  it('trims the hiccup and returns shorter, even-length PCM', () => {
    const full = concat(seg(800, LOUD), seg(250, 0), seg(100, LOUD));
    const pcm = toPcm(full);
    const { pcm: out, trimmed } = trimTailHiccup(pcm, SR);
    expect(trimmed).toBe(true);
    expect(out.byteLength % 2).toBe(0);
    expect(out.byteLength).toBeLessThan(pcm.byteLength);
    // Keeps the whole sentence, drops the burst.
    expect(out.byteLength / 2).toBeGreaterThan(ms(800));
    expect(out.byteLength / 2).toBeLessThan(ms(1050));
  });

  it('returns the same bytes (no-op) for a clean clip', () => {
    const pcm = toPcm(concat(seg(800, LOUD), seg(300, 0)));
    const { pcm: out, trimmed } = trimTailHiccup(pcm, SR);
    expect(trimmed).toBe(false);
    expect(out).toBe(pcm); // same reference → byte-identical downstream
  });

  it('handles empty / too-short input without throwing', () => {
    expect(trimTailHiccup(new Uint8Array(0), SR).trimmed).toBe(false);
    expect(trimTailHiccup(new Uint8Array(3), SR).trimmed).toBe(false);
  });
});
