// @ts-expect-error - soundtouchjs ships no types
import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';
import toWav from 'audiobuffer-to-wav';

/**
 * Pure-JS DSP shared by the main thread (fallback) and the audio worker.
 * No Web Audio APIs in here: workers have no AudioContext, so everything
 * operates on raw channel data via an AudioBuffer-shaped shim.
 */

export interface RawAudioData {
  /** 1 (mono) or 2 (stereo) channels of PCM samples (transferable backing). */
  channels: Float32Array<ArrayBuffer>[];
  /** Frames per channel. */
  length: number;
  sampleRate: number;
}

const BUFFER_SIZE = 4096;

/**
 * SoundTouchJS's internal `FilterSupport.fillOutputBuffer` bails out as soon
 * as its input buffer can't be topped up to `8192 * 2` frames. At end-of-
 * source that leaves the real tail un-processed, up to ~370 ms of audio
 * near the clip end is silently dropped. To force a flush we append trailing
 * silence to the source so the threshold stays met while the real tail is
 * consumed. We then stop extracting at the intended stretched length, so the
 * silence never ends up in the output.
 */
const SOUNDTOUCH_FILL_THRESHOLD_FRAMES = 8192 * 2;
const TAIL_PAD_FRAMES = SOUNDTOUCH_FILL_THRESHOLD_FRAMES * 2;

/**
 * Minimal AudioBuffer-shaped object: `WebAudioBufferSource` and
 * `audiobuffer-to-wav` only read these members.
 */
function audioBufferShim(data: RawAudioData) {
  return {
    sampleRate: data.sampleRate,
    length: data.length,
    duration: data.length / data.sampleRate,
    numberOfChannels: data.channels.length,
    getChannelData(channel: number): Float32Array {
      return data.channels[channel];
    },
  };
}

/**
 * Pitch-preserved WSOLA time-stretch over raw channel data.
 * Output duration ≈ input.length / rate.
 */
export function stretchChannels(
  input: RawAudioData,
  rate: number,
): RawAudioData {
  // Silence-pad the source so SoundTouch's fill threshold stays satisfied
  // while the real tail is processed (see TAIL_PAD_FRAMES).
  const paddedLength = input.length + TAIL_PAD_FRAMES;
  const padded: RawAudioData = {
    sampleRate: input.sampleRate,
    length: paddedLength,
    channels: input.channels.map((ch) => {
      const p = new Float32Array(paddedLength);
      p.set(ch, 0);
      return p;
    }),
  };

  const source = new WebAudioBufferSource(audioBufferShim(padded));
  const st = new SoundTouch();
  // SoundTouch's `Stretch` constructor hardcodes a 44100 Hz sample rate, and
  // its auto-tuning picks sequence/seek windows in MILLISECONDS before
  // converting them to samples with that rate. Our buffers arrive at the
  // AudioContext rate instead (48 kHz on most Apple hardware), so every window
  // came out 8.6% shorter than the library intended (at 0.7x: 5115 samples
  // where it wanted 5568, overlap 352 where it wanted 384). Passing the real
  // rate is a correctness fix, not a tuning knob; zeros keep the library's own
  // auto sequence/seek sizing and 8 is its DEFAULT_OVERLAP_MS.
  //
  // Note this is a no-op on a 44.1 kHz output device, which is why the
  // artifacts it addresses are hardware-dependent.
  st.stretch.setParameters(input.sampleRate, 0, 0, 8);
  st.tempo = rate;
  const filter = new SimpleFilter(source, st);

  const targetOutLen = Math.ceil(input.length / rate);
  // Head room for WSOLA boundary effects; extraction stops once we hit this
  // cap so any output generated from the silence tail is naturally discarded.
  const capacity = targetOutLen + BUFFER_SIZE * 2;
  const left = new Float32Array(capacity);
  const right = new Float32Array(capacity);

  const interleaved = new Float32Array(BUFFER_SIZE * 2);
  let written = 0;
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

  // Hard-cap at the expected stretched length: no silence leakage even if
  // WSOLA overshoots our estimate on some speeds.
  const outLen = Math.min(written, targetOutLen);
  const channelCount = input.channels.length > 1 ? 2 : 1;
  // .slice → exact-length copies, so transferring them doesn't drag the
  // oversized capacity buffers across the thread boundary.
  const channels =
    channelCount === 2
      ? [left.slice(0, outLen), right.slice(0, outLen)]
      : [left.slice(0, outLen)];

  return { channels, length: outLen, sampleRate: input.sampleRate };
}

/** WAV-encode raw channel data (the sync part of the old `toWav(rendered)`). */
export function encodeWavFromChannels(data: RawAudioData): ArrayBuffer {
  return toWav(audioBufferShim(data) as unknown as AudioBuffer);
}
