import { describe, it, expect } from 'vitest';

import {
  detectAudioContainer,
  isSttContainer,
  sttFilename,
  STT_REJECTED_CONTAINERS,
} from '../../../lib/stt/audioContainer';

const bytes = (...values: number[]) => new Uint8Array(values);
const str = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('lib/stt/audioContainer', () => {
  it('recognises every container by its signature', () => {
    expect(
      detectAudioContainer(bytes(...str('RIFF'), 0, 0, 0, 0, ...str('WAVE'))),
    ).toBe('wav');
    expect(detectAudioContainer(bytes(...str('fLaC'), 0, 0))).toBe('flac');
    expect(detectAudioContainer(bytes(...str('OggS'), 0, 2))).toBe('ogg');
    expect(detectAudioContainer(bytes(0x1a, 0x45, 0xdf, 0xa3, 0xa3))).toBe(
      'webm',
    );
    expect(
      detectAudioContainer(
        bytes(0, 0, 0, 0x18, ...str('ftyp'), ...str('M4A ')),
      ),
    ).toBe('mp4');
    expect(detectAudioContainer(bytes(...str('ID3'), 4, 0, 0))).toBe('mp3');
    expect(detectAudioContainer(bytes(0xff, 0xfb, 0x90, 0x64))).toBe('mp3');
  });

  it('returns unknown for short or unrecognised input', () => {
    expect(detectAudioContainer(bytes())).toBe('unknown');
    expect(detectAudioContainer(bytes(1, 2, 3))).toBe('unknown');
    expect(detectAudioContainer(bytes(0, 0, 0, 0, 0, 0, 0, 0))).toBe('unknown');
    // RIFF without WAVE is some other RIFF file, not audio we can send.
    expect(
      detectAudioContainer(bytes(...str('RIFF'), 0, 0, 0, 0, ...str('AVI '))),
    ).toBe('unknown');
  });

  it('rejects exactly the two MediaRecorder containers', () => {
    expect([...STT_REJECTED_CONTAINERS].sort()).toEqual(['mp4', 'webm']);
    for (const container of STT_REJECTED_CONTAINERS) {
      expect(isSttContainer(container)).toBe(false);
    }
    expect(isSttContainer('unknown')).toBe(false);
    expect(isSttContainer('wav')).toBe(true);
  });

  it('names the upload from the container, then the mime label, then MP3', () => {
    expect(sttFilename('wav', '')).toBe('audio.wav');
    expect(sttFilename('flac', 'audio/mpeg')).toBe('audio.flac');
    expect(sttFilename('unknown', 'audio/wav')).toBe('audio.wav');
    expect(sttFilename('unknown', 'audio/x-wav; rate=16000')).toBe('audio.wav');
    expect(sttFilename('unknown', 'audio/ogg')).toBe('audio.ogg');
    expect(sttFilename('unknown', 'audio/flac')).toBe('audio.flac');
    expect(sttFilename('unknown', '')).toBe('audio.mp3');
    expect(sttFilename('unknown', 'application/octet-stream')).toBe(
      'audio.mp3',
    );
  });
});
