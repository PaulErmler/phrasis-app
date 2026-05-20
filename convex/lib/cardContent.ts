import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';
import { ROMANIZATION_LANGUAGES } from '../../lib/languages';
import { CLAIM_STALE_MS as LLM_CLAIM_STALE_MS } from '../features/llmTranslationQueue';

type ContentCtx = QueryCtx | MutationCtx;

export interface CardTranslationContent {
  language: string;
  text: string;
  isBaseLanguage: boolean;
  isTargetLanguage: boolean;
  romanization?: string;
  /**
   * True iff an LLM retranslation is currently in flight for this language
   * AND an existing `translatedText` is on file. Keyed off the LLM claim
   * so it does NOT fire during a "regenerate audio" action (no LLM phase).
   * Drives the warning-color "Retranslating" pill in the card header.
   */
  retranslating?: boolean;
}

export interface CardAudioContent {
  language: string;
  voiceName: string | null;
  url: string | null;
  wordTimings: { word: string; start: number; end: number }[] | null;
  /**
   * TTS validation state — see AudioResult in convex/lib/audio.ts. Surfaced
   * here so the retranslating-pill computation can distinguish "audio row
   * exists and points at the final blob" (validated/unvalidated) from "audio
   * row exists but the blob behind it may still be replaced by the
   * synthesize-and-validate loop" (`unknown`).
   */
  ttsQuality: string | null;
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

  const [translationResults, audioResults, claimResults] = await Promise.all([
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
    // LLM claim per non-source-language translation slot. A non-stale claim
    // means a `flagTranslation`-driven LLM retranslation is in flight; the
    // "Retranslating" pill keys off this so it doesn't fire when the user
    // clicks "regenerate audio" (no LLM phase, no claim).
    Promise.all(
      translationFetches.map((item) =>
        ctx.db
          .query('llmTranslationClaims')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', item.textId).eq('targetLanguage', item.lang),
          )
          .first(),
      ),
    ),
  ]);

  const translationMap = new Map<
    string,
    { text: string; romanization?: string; llmClaimedAt: number | null }
  >();
  translationFetches.forEach((item, idx) => {
    const row = translationResults[idx];
    const claim = claimResults[idx];
    translationMap.set(`${item.key}:${item.lang}`, {
      text: row?.translatedText ?? '',
      romanization: row?.romanizedText ?? undefined,
      llmClaimedAt: claim?.claimedAt ?? null,
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
    const audioRecordings = allLanguages.map((lang) => {
      const audio = audioByKeyAndLang.get(`${input.key}:${lang}`);
      return {
        language: lang,
        voiceName: audio?.voiceName ?? null,
        url: urlMap.get(`${input.key}:${lang}`) ?? null,
        wordTimings: audio?.wordTimings ?? null,
        ttsQuality: audio?.ttsQuality ?? null,
      };
    });

    const translations = allLanguages.map((lang) => {
      // Gate stored romanization on the language's current
      // `needsRomanization` flag. Rows written while the flag was on stay
      // in the DB untouched, but their romanizedText is dropped from the
      // response so the UI doesn't render stale transliteration after the
      // language is flipped off. See ROMANIZATION_LANGUAGES in
      // lib/languages.ts — it's derived from the Language entries so this
      // check stays in sync automatically.
      const langNeedsRomanization = ROMANIZATION_LANGUAGES.has(lang);
      if (lang === input.sourceLanguage) {
        return {
          language: lang,
          text: input.sourceText,
          isBaseLanguage: baseLanguages.includes(lang),
          isTargetLanguage: targetLanguages.includes(lang),
          romanization: langNeedsRomanization
            ? input.sourceRomanization
            : undefined,
          retranslating: false,
        };
      }
      const entry = translationMap.get(`${input.key}:${lang}`);
      const translatedText = entry?.text ?? '';
      const claimedAt = entry?.llmClaimedAt ?? null;
      const llmClaimHeld =
        claimedAt !== null && Date.now() - claimedAt < LLM_CLAIM_STALE_MS;
      return {
        language: lang,
        text: translatedText,
        isBaseLanguage: baseLanguages.includes(lang),
        isTargetLanguage: targetLanguages.includes(lang),
        romanization: langNeedsRomanization ? entry?.romanization : undefined,
        // Show the pill only when an LLM retranslation is in flight AND a
        // prior translatedText exists (i.e. this is a *re*translation, not
        // the first-time translation of a new card).
        retranslating: llmClaimHeld && translatedText.length > 0,
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
 *
 * Pass `text` when the caller already has the doc — avoids a redundant
 * `ctx.db.get` on the review hot path.
 */
export async function buildCardSearchableText(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  sourceText: string,
  courseLanguages: string[],
  text?: Doc<'texts'> | null,
): Promise<{ searchableText: string; searchableTextLanguages: string[] }> {
  const [resolvedText, translationResults] = await Promise.all([
    text !== undefined ? Promise.resolve(text) : ctx.db.get(textId),
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
    resolvedText?.romanizedText,
    ...foundTranslations.map((t) => t.text),
    ...foundTranslations.map((t) => t.romanization),
  ];

  return {
    searchableText: parts.filter(Boolean).join(' '),
    searchableTextLanguages: foundTranslations.map((t) => t.lang),
  };
}
