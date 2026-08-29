import { describe, it, expect } from 'vitest';
import { stretchChannels, type RawAudioData } from '@/lib/audio/stretchCore';

/**
 * Guards the contract of `stretchChannels`: output length follows the rate,
 * pitch does NOT, and a mono source stays mono.
 *
 * Deliberately NOT a guard on the sample-rate wiring (`setParameters`). A
 * steady tone survives WSOLA at any window size, so these assertions pass with
 * that call removed. It is a correctness fix whose effect a synthetic signal
 * cannot resolve; verifying it means listening on a 48 kHz device.
 */

/** Mono sine, unit amplitude. */
function sine(freq: number, sampleRate: number, seconds: number): RawAudioData {
  const length = Math.round(sampleRate * seconds);
  const ch = new Float32Array(new ArrayBuffer(length * 4));
  for (let i = 0; i < length; i++) {
    ch[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return { channels: [ch], length, sampleRate };
}

/**
 * Goertzel power at `freq`, normalised by the signal's total energy. A pure
 * tone that survived the stretch intact scores near 0.5 (a real sine splits
 * its energy between +f and -f); a warbled or pitch-shifted one scores far
 * lower because its energy has smeared into neighbouring bins.
 */
function tonePurity(
  ch: Float32Array,
  freq: number,
  sampleRate: number,
): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  let energy = 0;
  for (let i = 0; i < ch.length; i++) {
    const s0 = ch[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
    energy += ch[i] * ch[i];
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  if (energy <= 0) return 0;
  return power / (energy * ch.length);
}

describe('stretchChannels', () => {
  for (const sampleRate of [44100, 48000]) {
    describe(`at ${sampleRate} Hz`, () => {
      for (const rate of [0.7, 1.4]) {
        it(`stretches to input.length / rate at ${rate}x`, () => {
          const input = sine(440, sampleRate, 1);
          const out = stretchChannels(input, rate);
          const expected = Math.ceil(input.length / rate);
          expect(out.length).toBe(expected);
          expect(out.channels[0].length).toBe(expected);
          expect(out.sampleRate).toBe(sampleRate);
        });

        it(`preserves pitch at ${rate}x`, () => {
          const input = sine(440, sampleRate, 1);
          const out = stretchChannels(input, rate);
          // Skip the WSOLA ramp-in at the head, where overlap-add has not yet
          // settled and every rate looks noisy.
          const body = out.channels[0].subarray(4096);
          expect(tonePurity(body, 440, sampleRate)).toBeGreaterThan(0.45);
          // The pitch must not have moved with the tempo: at 0.7x a naive
          // resample would put the tone at 308 Hz, at 1.4x at 616 Hz.
          expect(tonePurity(body, 440 * rate, sampleRate)).toBeLessThan(0.05);
        });
      }
    });
  }

  it('stays mono for a mono source', () => {
    const out = stretchChannels(sine(440, 48000, 0.5), 0.8);
    expect(out.channels).toHaveLength(1);
  });
});
