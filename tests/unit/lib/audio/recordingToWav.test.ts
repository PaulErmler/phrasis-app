import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const decodeMock = vi.hoisted(() => vi.fn());
const encodeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/audio/peakCache', () => ({
  getDecodeContext: () => ({ decodeAudioData: decodeMock }),
}));
vi.mock('@/lib/audio/audioWorkerClient', () => ({
  encodeWav: encodeMock,
}));

import { recordingToWav, STT_SAMPLE_RATE } from '@/lib/audio/recordingToWav';

const RENDERED = { numberOfChannels: 1, sampleRate: STT_SAMPLE_RATE };

class FakeOfflineAudioContext {
  static instances: FakeOfflineAudioContext[] = [];
  destination = { kind: 'destination' };
  source = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() };
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {
    FakeOfflineAudioContext.instances.push(this);
  }
  createBufferSource() {
    return this.source;
  }
  startRendering() {
    return Promise.resolve(RENDERED);
  }
}

describe('recordingToWav', () => {
  beforeEach(() => {
    FakeOfflineAudioContext.instances = [];
    decodeMock.mockReset();
    encodeMock.mockReset();
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes, renders to one 16 kHz channel and WAV-encodes the result', async () => {
    const decoded = { duration: 2.3, numberOfChannels: 2, sampleRate: 48_000 };
    decodeMock.mockResolvedValue(decoded);
    const wav = new ArrayBuffer(4);
    encodeMock.mockResolvedValue(wav);
    const recording = new Blob([new Uint8Array([1, 2, 3])], {
      type: 'audio/webm',
    });

    const out = await recordingToWav(recording);

    expect(out).toBe(wav);
    expect(decodeMock).toHaveBeenCalledTimes(1);
    expect(FakeOfflineAudioContext.instances).toHaveLength(1);
    const offline = FakeOfflineAudioContext.instances[0];
    expect(offline.channels).toBe(1);
    expect(offline.sampleRate).toBe(STT_SAMPLE_RATE);
    expect(offline.length).toBe(Math.ceil(2.3 * STT_SAMPLE_RATE));
    expect(offline.source.buffer).toBe(decoded);
    expect(offline.source.connect).toHaveBeenCalledWith(offline.destination);
    expect(offline.source.start).toHaveBeenCalledWith(0);
    expect(encodeMock).toHaveBeenCalledWith(RENDERED);
  });

  it('renders at least one frame for an empty clip', async () => {
    decodeMock.mockResolvedValue({ duration: 0 });
    encodeMock.mockResolvedValue(new ArrayBuffer(0));

    await recordingToWav(new Blob([]));

    expect(FakeOfflineAudioContext.instances[0].length).toBe(1);
  });

  it('propagates a decode failure', async () => {
    decodeMock.mockRejectedValue(new Error('EncodingError'));

    await expect(recordingToWav(new Blob([]))).rejects.toThrow('EncodingError');
    expect(encodeMock).not.toHaveBeenCalled();
  });
});
