/// <reference lib="webworker" />

import {
  encodeWavFromChannels,
  stretchChannels,
  type RawAudioData,
} from './stretchCore';

/**
 * Audio DSP worker: SoundTouch WSOLA time-stretch and WAV encoding — the two
 * synchronous CPU-heavy stages of the merge pipeline. Channel data crosses
 * the boundary as transferred ArrayBuffers (zero copy); decode and
 * OfflineAudioContext rendering stay on the main thread (Window-only APIs).
 */

declare const self: DedicatedWorkerGlobalScope;

export type StretchWorkerRequest =
  | {
      id: number;
      kind: 'stretch';
      channels: Float32Array<ArrayBuffer>[];
      length: number;
      sampleRate: number;
      rate: number;
    }
  | {
      id: number;
      kind: 'encodeWav';
      channels: Float32Array<ArrayBuffer>[];
      length: number;
      sampleRate: number;
    };

export type StretchWorkerResponse =
  | {
      id: number;
      kind: 'stretch';
      channels: Float32Array<ArrayBuffer>[];
      length: number;
      sampleRate: number;
    }
  | { id: number; kind: 'encodeWav'; wav: ArrayBuffer }
  | { id: number; kind: 'error'; error: string };

self.onmessage = (event: MessageEvent<StretchWorkerRequest>) => {
  const msg = event.data;
  try {
    const input: RawAudioData = {
      channels: msg.channels,
      length: msg.length,
      sampleRate: msg.sampleRate,
    };

    if (msg.kind === 'stretch') {
      const out = stretchChannels(input, msg.rate);
      const response: StretchWorkerResponse = {
        id: msg.id,
        kind: 'stretch',
        channels: out.channels,
        length: out.length,
        sampleRate: out.sampleRate,
      };
      self.postMessage(
        response,
        out.channels.map((c) => c.buffer),
      );
      return;
    }

    const wav = encodeWavFromChannels(input);
    const response: StretchWorkerResponse = {
      id: msg.id,
      kind: 'encodeWav',
      wav,
    };
    self.postMessage(response, [wav]);
  } catch (err) {
    const response: StretchWorkerResponse = {
      id: msg.id,
      kind: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
