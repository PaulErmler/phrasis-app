import {
  encodeWavFromChannels,
  stretchChannels,
  type RawAudioData,
} from './stretchCore';
import type {
  StretchWorkerRequest,
  StretchWorkerResponse,
} from './stretch.worker';

import { reportError } from '@/lib/report-error';

/**
 * Lazy singleton client for the audio DSP worker, with a synchronous
 * main-thread fallback (same stretchCore code) when workers are unavailable
 * or construction fails. Playback must keep working either way.
 */

let worker: Worker | null = null;
let workerFailed = false;
let nextRequestId = 1;

type Pending =
  | { kind: 'stretch'; resolve: (out: RawAudioData) => void; reject: (err: Error) => void }
  | { kind: 'encodeWav'; resolve: (wav: ArrayBuffer) => void; reject: (err: Error) => void };

const pending = new Map<number, Pending>();

function failAllPending(reason: string) {
  for (const [, entry] of pending) {
    entry.reject(new Error(reason));
  }
  pending.clear();
}

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null;
  }
  if (worker) return worker;

  try {
    worker = new Worker(new URL('./stretch.worker.ts', import.meta.url));
  } catch (err) {
    reportError(err, { op: 'audioWorkerConstruct' });
    workerFailed = true;
    worker = null;
    return null;
  }

  worker.onmessage = (event: MessageEvent<StretchWorkerResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);

    if (msg.kind === 'error') {
      entry.reject(new Error(msg.error));
      return;
    }
    if (msg.kind === 'stretch' && entry.kind === 'stretch') {
      entry.resolve({
        channels: msg.channels,
        length: msg.length,
        sampleRate: msg.sampleRate,
      });
      return;
    }
    if (msg.kind === 'encodeWav' && entry.kind === 'encodeWav') {
      entry.resolve(msg.wav);
      return;
    }
    entry.reject(new Error('Audio worker response kind mismatch'));
  };

  worker.onerror = (event) => {
    reportError(event.error ?? new Error(event.message || 'Audio worker crashed'), { op: 'audioWorkerCrash' });
    workerFailed = true;
    failAllPending('Audio worker crashed');
    worker?.terminate();
    worker = null;
  };

  return worker;
}

function post(
  request: StretchWorkerRequest,
  entry: Pending,
  transfer: Transferable[],
): boolean {
  const w = getWorker();
  if (!w) return false;
  pending.set(request.id, entry);
  try {
    w.postMessage(request, transfer);
    return true;
  } catch (err) {
    pending.delete(request.id);
    reportError(err, { op: 'audioWorkerPostMessage' });
    workerFailed = true;
    return false;
  }
}

/** Copy an AudioBuffer's channel data into transferable arrays (max 2ch). */
export function extractChannels(buffer: AudioBuffer): RawAudioData {
  const channelCount = buffer.numberOfChannels > 1 ? 2 : 1;
  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let ch = 0; ch < channelCount; ch++) {
    const data = new Float32Array(buffer.length);
    // copyFromChannel is missing on some older WebKit AudioBuffers (and on
    // test doubles), fall back to copying the live channel array.
    if (typeof buffer.copyFromChannel === 'function') {
      buffer.copyFromChannel(data, ch);
    } else {
      data.set(buffer.getChannelData(ch));
    }
    channels.push(data);
  }
  return { channels, length: buffer.length, sampleRate: buffer.sampleRate };
}

/**
 * Time-stretch raw channel data, on the worker when possible. The input
 * arrays are TRANSFERRED (detached) on the worker path. Callers must pass
 * copies they don't reuse; on failure, re-extract from the source
 * AudioBuffer and run the sync fallback.
 */
export async function stretchRaw(
  input: RawAudioData,
  rate: number,
  refetchInput: () => RawAudioData,
): Promise<RawAudioData> {
  const id = nextRequestId++;
  const attempted = new Promise<RawAudioData>((resolve, reject) => {
    const ok = post(
      {
        id,
        kind: 'stretch',
        channels: input.channels,
        length: input.length,
        sampleRate: input.sampleRate,
        rate,
      },
      { kind: 'stretch', resolve, reject },
      input.channels.map((c) => c.buffer),
    );
    if (!ok) reject(new Error('worker unavailable'));
  });

  try {
    return await attempted;
  } catch {
    // Input arrays may be detached after a transfer, always re-extract.
    return stretchChannels(refetchInput(), rate);
  }
}

/** WAV-encode an AudioBuffer, on the worker when possible. */
export async function encodeWav(buffer: AudioBuffer): Promise<ArrayBuffer> {
  const input = extractChannels(buffer);
  const id = nextRequestId++;
  const attempted = new Promise<ArrayBuffer>((resolve, reject) => {
    const ok = post(
      {
        id,
        kind: 'encodeWav',
        channels: input.channels,
        length: input.length,
        sampleRate: input.sampleRate,
      },
      { kind: 'encodeWav', resolve, reject },
      input.channels.map((c) => c.buffer),
    );
    if (!ok) reject(new Error('worker unavailable'));
  });

  try {
    return await attempted;
  } catch {
    return encodeWavFromChannels(extractChannels(buffer));
  }
}
