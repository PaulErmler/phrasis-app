/**
 * Container sniffing for STT uploads. OpenRouter's transcription endpoint
 * accepts WAV, MP3, FLAC and OGG/Opus for MAI-Transcribe-2 and returns a
 * bare 400 for WebM and MP4, the two containers browsers' MediaRecorder
 * produces. The client transcodes to WAV before upload
 * (lib/audio/recordingToWav.ts); this module lets the server reject a stale
 * bundle's WebM before it spends a quota unit, and names the multipart file
 * by what the bytes actually are rather than by a mime label that is
 * sometimes missing (storage blobs) or wrong.
 */

export type AudioContainer =
  | 'wav'
  | 'mp3'
  | 'flac'
  | 'ogg'
  | 'webm'
  | 'mp4'
  | 'unknown';

/** Containers the STT provider refuses. */
export const STT_REJECTED_CONTAINERS: ReadonlySet<AudioContainer> = new Set([
  'webm',
  'mp4',
]);

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.byteLength < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** Bytes needed to tell the containers apart; every signature sits inside. */
const SNIFF_BYTES = 16;

/** Identify the container from the first bytes (16 are enough). */
export function detectAudioContainer(bytes: Uint8Array): AudioContainer {
  if (bytes.byteLength < 4) return 'unknown';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'wav';
  if (ascii(bytes, 0, 'fLaC')) return 'flac';
  if (ascii(bytes, 0, 'OggS')) return 'ogg';
  // EBML header, shared by WebM and Matroska.
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'webm';
  }
  if (ascii(bytes, 4, 'ftyp')) return 'mp4';
  // ID3 tag or an MPEG frame sync.
  const id3 = ascii(bytes, 0, 'ID3');
  const frameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (id3 || frameSync) return 'mp3';
  return 'unknown';
}

/** `detectAudioContainer` over the head of an action's `v.bytes()` argument. */
export function containerOfBuffer(audio: ArrayBuffer): AudioContainer {
  return detectAudioContainer(
    new Uint8Array(audio, 0, Math.min(SNIFF_BYTES, audio.byteLength)),
  );
}

/** `detectAudioContainer` over the head of a Blob (storage or upload). */
export async function containerOfBlob(blob: Blob): Promise<AudioContainer> {
  return detectAudioContainer(
    new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer()),
  );
}

const FILENAME_BY_CONTAINER: Record<
  Exclude<AudioContainer, 'unknown'>,
  string
> = {
  wav: 'audio.wav',
  mp3: 'audio.mp3',
  flac: 'audio.flac',
  ogg: 'audio.ogg',
  webm: 'audio.webm',
  mp4: 'audio.m4a',
};

/**
 * Multipart filename for the upload. When the bytes don't identify
 * themselves, fall back to the blob's mime label, then to MP3: every clip the
 * pipeline synthesizes is MP3, and storage blobs sometimes come back untyped.
 */
export function sttFilename(
  container: AudioContainer,
  mimeType: string,
): string {
  if (container !== 'unknown') return FILENAME_BY_CONTAINER[container];
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base === 'audio/wav' || base === 'audio/x-wav' || base === 'audio/wave') {
    return 'audio.wav';
  }
  if (base === 'audio/flac') return 'audio.flac';
  if (base === 'audio/ogg') return 'audio.ogg';
  return 'audio.mp3';
}
