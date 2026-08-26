import type { SpeakInput, SpeakResult, TTSProvider } from './types';
import { requireEnv } from '../env';

interface GoogleTTSResponse {
  audioContent: string;
}

function extractLanguageCode(voiceName: string): string {
  return voiceName.split('-Chirp3-HD-')[0];
}

export const googleTts: TTSProvider = {
  id: 'google',
  async speak(input: SpeakInput): Promise<SpeakResult> {
    const apiKey = requireEnv('GOOGLE_TTS_API_KEY');

    const languageCode = extractLanguageCode(input.voiceApiCode);

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: input.text },
          voice: { languageCode, name: input.voiceApiCode },
          audioConfig: { audioEncoding: 'MP3', speakingRate: input.speed },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google TTS API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as GoogleTTSResponse;
    if (!data.audioContent)
      throw new Error('No audio content returned from Google TTS API');

    const audio = new Blob(
      [Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0))],
      { type: 'audio/mp3' },
    );
    return { audio, provider: 'google' };
  },
};
