'use node';

import { action } from '../../_generated/server';
import { v, ConvexError } from 'convex/values';
import { requireAuthUserId } from '../../db/users';

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-m4a': 'm4a',
  'audio/mp4;codecs=mp4a.40.2': 'mp4',
  'audio/webm;codecs=opus': 'webm',
};

function extForMime(mime: string): string {
  const base = mime.split(';')[0].trim();
  return MIME_TO_EXT[mime] ?? MIME_TO_EXT[base] ?? 'webm';
}

/**
 * Transcribe audio using OpenAI Transcription API.
 * Calls the API directly to ensure the correct MIME type / file extension
 * is sent (the Vercel AI SDK's magic-byte detection fails for MP4 from iOS).
 */
export const transcribeAudio = action({
  args: {
    audio: v.bytes(),
    mimeType: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireAuthUserId(ctx);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ConvexError('OPENAI_API_KEY is not configured');

    const rawMime = args.mimeType ?? 'audio/webm';
    const baseMime = rawMime.split(';')[0].trim();
    const ext = extForMime(rawMime);

    try {
      const blob = new Blob([args.audio], { type: baseMime });
      const file = new File([blob], `audio.${ext}`, { type: baseMime });

      const formData = new FormData();
      formData.append('file', file);
      formData.append('model', 'gpt-4o-transcribe');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI transcription failed (${res.status}): ${body}`);
      }

      const data = (await res.json()) as { text: string };
      return data.text;
    } catch (error) {
      console.error('Transcription error:', error);
      throw new ConvexError(
        error instanceof Error ? error.message : 'Failed to transcribe audio',
      );
    }
  },
});
