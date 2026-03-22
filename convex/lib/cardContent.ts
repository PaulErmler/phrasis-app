import { Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';

type ContentCtx = QueryCtx | MutationCtx;

export interface CardTranslationContent {
  language: string;
  text: string;
  isBaseLanguage: boolean;
  isTargetLanguage: boolean;
}

export interface CardAudioContent {
  language: string;
  voiceName: string | null;
  url: string | null;
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

  const translationMap = new Map<string, string>();
  translationFetches.forEach((item, idx) => {
    const translatedText = translationResults[idx]?.translatedText ?? '';
    translationMap.set(`${item.key}:${item.lang}`, translatedText);
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
    const translations = allLanguages.map((lang) => ({
      language: lang,
      text:
        lang === input.sourceLanguage
          ? input.sourceText
          : (translationMap.get(`${input.key}:${lang}`) ?? ''),
      isBaseLanguage: baseLanguages.includes(lang),
      isTargetLanguage: targetLanguages.includes(lang),
    }));

    const audioRecordings = allLanguages.map((lang) => {
      const audio = audioByKeyAndLang.get(`${input.key}:${lang}`);
      return {
        language: lang,
        voiceName: audio?.voiceName ?? null,
        url: urlMap.get(`${input.key}:${lang}`) ?? null,
      };
    });

    const hasMissingTranslation = translations.some(
      (translation) =>
        translation.language !== input.sourceLanguage && !translation.text,
    );
    const hasMissingAudio = audioRecordings.some((audio) => !audio.url);

    result.set(input.key, {
      translations,
      audioRecordings,
      hasMissingContent: hasMissingTranslation || hasMissingAudio,
    });
  }

  return result;
}
