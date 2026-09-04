import { getDecodeContext } from './peakCache';
import { encodeWav } from './audioWorkerClient';

/**
 * Sample rate of the STT upload. Speech models work at 16 kHz internally, so
 * anything higher is upload weight: 16 kHz mono 16-bit is 32 KB per second,
 * about 1 MB for a 30 s dictated answer.
 */
export const STT_SAMPLE_RATE = 16_000;

/**
 * Re-encode a MediaRecorder clip as 16 kHz mono WAV for transcription.
 *
 * The STT provider (MAI-Transcribe-2 via OpenRouter) accepts WAV, MP3, FLAC
 * and OGG/Opus and rejects the two containers MediaRecorder produces, WebM
 * (Chrome, Firefox, Android) and MP4 (Safari, iOS). There is no Opus muxer
 * on the client and no ffmpeg on the server, so the clip is decoded with the
 * browser's own codecs, rendered down to one 16 kHz channel through an
 * OfflineAudioContext (a mono destination down-mixes stereo input), and
 * written out as PCM with the same WAV encoder the merged-audio player uses.
 */
export async function recordingToWav(recording: Blob): Promise<ArrayBuffer> {
  const decoded = await getDecodeContext().decodeAudioData(
    await recording.arrayBuffer(),
  );
  const frames = Math.max(1, Math.ceil(decoded.duration * STT_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, STT_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return encodeWav(rendered);
}
