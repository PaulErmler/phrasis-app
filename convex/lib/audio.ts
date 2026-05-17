import { QueryCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';

export interface AudioWordTiming {
  word: string;
  start: number;
  end: number;
}

export interface AudioResult {
  language: string;
  voiceName: string | null;
  url: string | null;
  wordTimings: AudioWordTiming[] | null;
  /**
   * TTS validation state — 'unknown' while a synthesis attempt is still in
   * flight (the row is inserted at attempt 0 before validation), 'validated'
   * after STT roundtrip matched, 'unvalidated' for languages without STT
   * support or when all retries mismatched. Used by callers to decide
   * whether the audio currently behind `url` is the final one.
   */
  ttsQuality: string | null;
}

/**
 * Fetch audio recordings with resolved storage URLs for a single text
 * across the given languages.
 */
export async function getAudioForText(
  ctx: QueryCtx,
  textId: Id<'texts'>,
  languages: string[],
): Promise<AudioResult[]> {
  const records = await Promise.all(
    languages.map((lang) =>
      ctx.db
        .query('audioRecordings')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', textId).eq('language', lang),
        )
        .first(),
    ),
  );

  const urlEntries = await Promise.all(
    records.map((rec) =>
      rec?.storageId ? ctx.storage.getUrl(rec.storageId) : null,
    ),
  );

  return languages.map((lang, i) => ({
    language: lang,
    voiceName: records[i]?.voiceName ?? null,
    url: urlEntries[i] ?? null,
    wordTimings: records[i]?.wordTimings ?? null,
    ttsQuality: records[i]?.ttsQuality ?? null,
  }));
}
