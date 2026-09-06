import { encodeWavFromChannels } from './stretchCore';

/**
 * A short looping track of digital silence, used to keep the audio element
 * playing while the next card's blob is still being merged. Mobile browsers
 * hand continuous background playback to a page only while its element is
 * actually playing: an element that ends and sits idle for the seconds it
 * takes a locked-screen tab to hear back from the server and render the next
 * merge loses that grant, and the play() that follows is refused or never
 * runs. One second at 8 kHz is 16 KB and costs nothing to loop.
 */
export const SILENCE_SAMPLE_RATE = 8_000;
export const SILENCE_SECONDS = 1;

let silenceUrl: string | null = null;

/** Blob URL of the silent loop, created on first use and kept for the page. */
export function getSilenceBlobUrl(): string {
  if (silenceUrl) return silenceUrl;
  const length = SILENCE_SAMPLE_RATE * SILENCE_SECONDS;
  const wav = encodeWavFromChannels({
    channels: [new Float32Array(length)],
    length,
    sampleRate: SILENCE_SAMPLE_RATE,
  });
  silenceUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  return silenceUrl;
}
