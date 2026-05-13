import type { SpeakInput, SpeakResult, TTSProvider } from './types';

const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

/**
 * Extract the BCP-47 locale from an Azure voice short name.
 *   "sv-SE-SofieNeural" -> "sv-SE"
 *   "en-US-AndrewMultilingualNeural" -> "en-US"
 */
function extractLocale(voiceShortName: string): string {
  const parts = voiceShortName.split('-');
  if (parts.length < 3) {
    throw new Error(`Invalid Azure voice short name: "${voiceShortName}"`);
  }
  return `${parts[0]}-${parts[1]}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function speedToProsodyRate(speed: number): string {
  if (speed === 1) return '0%';
  const pct = Math.round((speed - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

export const azureTts: TTSProvider = {
  id: 'azure',
  async speak(input: SpeakInput): Promise<SpeakResult> {
    const apiKey = process.env.AZURE_SPEECH_API_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!apiKey) throw new Error('AZURE_SPEECH_API_KEY is not configured');
    if (!region) throw new Error('AZURE_SPEECH_REGION is not configured');

    const locale = extractLocale(input.voiceApiCode);
    const rate = speedToProsodyRate(input.speed);
    const ssml =
      `<speak version="1.0" xml:lang="${locale}">` +
      `<voice name="${input.voiceApiCode}">` +
      `<prosody rate="${rate}">${escapeXml(input.text)}</prosody>` +
      `</voice></speak>`;

    const response = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
          'User-Agent': 'phrasis-app',
        },
        body: ssml,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Azure TTS API error: ${response.status} - ${errorText}`,
      );
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) {
      throw new Error('No audio content returned from Azure TTS API');
    }
    return { audio: new Blob([bytes], { type: 'audio/mp3' }), provider: 'azure' };
  },
};
