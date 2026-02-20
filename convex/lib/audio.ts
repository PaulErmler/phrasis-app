import { QueryCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';

export interface AudioResult {
  language: string;
  voiceName: string | null;
  url: string | null;
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
  }));
}
