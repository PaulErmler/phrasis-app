import { Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';
import { ROMANIZATION_LANGUAGES } from '../../lib/languages';

type ContentCtx = QueryCtx | MutationCtx;

export interface CardTranslationContent {
  language: string;
  text: string;
  isBaseLanguage: boolean;
  isTargetLanguage: boolean;
  romanization?: string;
}

export interface CardAudioContent {
  language: string;
  voiceName: string | null;
  url: string | null;
  wordTimings: { word: string; start: number; end: number }[] | null;
}

export interface TextContentResult {
  translations: CardTranslationContent[];
  audioRecordings: CardAudioContent[];
  hasMissingContent: boolean;
}

interface TextContentInput {
  key: string;
  textId: Id<'texts'>;
  sourceText: string;
  sourceLanguage: string;
  sourceRomanization?: string;
}

export function getCourseLanguages(
  baseLanguages: string[],
  targetLanguages: string[],
): string[] {
  return [...new Set([...baseLanguages, ...targetLanguages])];
}

export async function buildTextContentBatchForLanguages(
  ctx: ContentCtx,
  inputs: TextContentInput[],
  baseLanguages: string[],
  targetLanguages: string[],
): Promise<Map<string, TextContentResult>> {
  const allLanguages = getCourseLanguages(baseLanguages, targetLanguages);
  const translationFetches: Array<{ key: string; lang: string; textId: Id<'texts'> }> = [];
  const audioFetches: Array<{ key: string; lang: string; textId: Id<'texts'> }> = [];

  for (const input of inputs) {
    for (const lang of allLanguages) {
      if (lang !== input.sourceLanguage) {
        translationFetches.push({ key: input.key, lang, textId: input.textId });
      }
      audioFetches.push({ key: input.key, lang, textId: input.textId });
    }
  }

  const [translationResults, audioResults] = await Promise.all([
    Promise.all(
      translationFetches.map((item) =>
        ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', item.textId).eq('targetLanguage', item.lang),
          )
          .first(),
      ),
    ),
    Promise.all(
      audioFetches.map((item) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', item.textId).eq('language', item.lang),
          )
          .first(),
      ),
    ),
  ]);

  const translationMap = new Map<string, { text: string; romanization?: string }>();
  translationFetches.forEach((item, idx) => {
    const row = translationResults[idx];
    translationMap.set(`${item.key}:${item.lang}`, {
      text: row?.translatedText ?? '',
      romanization: row?.romanizedText ?? undefined,
    });
  });

  const audioByKeyAndLang = new Map<string, (typeof audioResults)[number]>();
  audioFetches.forEach((item, idx) => {
    audioByKeyAndLang.set(`${item.key}:${item.lang}`, audioResults[idx]);
  });

  const audioWithStorage = audioFetches
    .map((item, idx) => ({
      key: `${item.key}:${item.lang}`,
      audio: audioResults[idx],
    }))
    .filter((item): item is { key: string; audio: NonNullable<(typeof audioResults)[number]> } =>
      item.audio?.storageId != null,
    );

  const storageUrls = await Promise.all(
    audioWithStorage.map((item) => ctx.storage.getUrl(item.audio.storageId)),
  );
  const urlMap = new Map<string, string | null>();
  audioWithStorage.forEach((item, idx) => {
    urlMap.set(item.key, storageUrls[idx]);
  });

  const result = new Map<string, TextContentResult>();
  for (const input of inputs) {
    const translations = allLanguages.map((lang) => {
      if (lang === input.sourceLanguage) {
        return {
          language: lang,
          text: input.sourceText,
          isBaseLanguage: baseLanguages.includes(lang),
          isTargetLanguage: targetLanguages.includes(lang),
          romanization: input.sourceRomanization,
        };
      }
      const entry = translationMap.get(`${input.key}:${lang}`);
      return {
        language: lang,
        text: entry?.text ?? '',
        isBaseLanguage: baseLanguages.includes(lang),
        isTargetLanguage: targetLanguages.includes(lang),
        romanization: entry?.romanization,
      };
    });

    const audioRecordings = allLanguages.map((lang) => {
      const audio = audioByKeyAndLang.get(`${input.key}:${lang}`);
      return {
        language: lang,
        voiceName: audio?.voiceName ?? null,
        url: urlMap.get(`${input.key}:${lang}`) ?? null,
        wordTimings: audio?.wordTimings ?? null,
      };
    });

    const hasMissingTranslation = translations.some(
      (tr) => tr.language !== input.sourceLanguage && !tr.text,
    );
    const hasMissingAudio = audioRecordings.some((audio) => !audio.url);
    const hasMissingRomanization = translations.some(
      (tr) => ROMANIZATION_LANGUAGES.has(tr.language) && !tr.romanization,
    );
    // Legacy audio (generated before Scribe integration) has a URL but no
    // wordTimings. Flag it as missing so useEnsureContent → scheduleMissingContent
    // triggers a backfill transcription.
    const hasMissingWordTimings = audioRecordings.some(
      (audio) => audio.url !== null && audio.wordTimings === null,
    );

    result.set(input.key, {
      translations,
      audioRecordings,
      hasMissingContent:
        hasMissingTranslation ||
        hasMissingAudio ||
        hasMissingRomanization ||
        hasMissingWordTimings,
    });
  }

  return result;
}

/**
 * Builds `searchableText` and `searchableTextLanguages` for a card by querying
 * the translations table for each course language individually.
 *
 * Only languages for which a translation actually exists are included in
 * `searchableTextLanguages`, so callers can later detect staleness by comparing
 * this array against the current course language list.
 */
export async function buildCardSearchableText(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  sourceText: string,
  courseLanguages: string[],
): Promise<{ searchableText: string; searchableTextLanguages: string[] }> {
  const [text, translationResults] = await Promise.all([
    ctx.db.get(textId),
    Promise.all(
      courseLanguages.map(async (lang) => {
        const translation = await ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', lang),
          )
          .unique();
        return translation
          ? { lang, text: translation.translatedText, romanization: translation.romanizedText }
          : null;
      }),
    ),
  ]);

  const foundTranslations = translationResults.filter(
    (t): t is NonNullable<typeof t> => t !== null,
  );

  const parts = [
    sourceText,
    text?.romanizedText,
    ...foundTranslations.map((t) => t.text),
    ...foundTranslations.map((t) => t.romanization),
  ];

  return {
    searchableText: parts.filter(Boolean).join(' '),
    searchableTextLanguages: foundTranslations.map((t) => t.lang),
  };
}
