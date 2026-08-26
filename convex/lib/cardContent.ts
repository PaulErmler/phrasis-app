import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';
import {
  isTranslationVersionStale,
  languageSupportsStt,
} from '../../lib/languages';
import {
  ANNOTATION_KINDS,
  TEXT_ANNOTATIONS,
  type AnnotationKind,
} from './textAnnotations';
import { mayRegenerateTranslation } from '../../lib/translationProvenance';
import { getLlmClaim, isClaimFresh } from '../features/llmTranslationQueue';
import { appendSearchSegments } from '../../lib/wordTokenize';
import {
  audioPayloadFromRowAndAsset,
  type ResolvedAudioPayload,
} from './audioAssets';

type ContentCtx = QueryCtx | MutationCtx;

/** One accepted writing alternative as served on a card payload. */
export interface CardAlternativeContent {
  text: string;
  romanization?: string;
  ipa?: string;
  furigana?: string;
  audioUrl?: string | null;
}

export interface CardTranslationContent {
  language: string;
  text: string;
  isBaseLanguage: boolean;
  isTargetLanguage: boolean;
  /**
   * The user's stored AI-feedback accepted alternatives for this card +
   * language. Populated only by getCardForReview (alternatives are
   * card-scoped, so the shared content builders here never fill it); typed
   * on the shared interface so the payload's spread is checked rather than
   * silently widened. Mirrors `translationValidator.alternatives`.
   */
  alternatives?: CardAlternativeContent[];
  romanization?: string;
  /** IPA transcription (espeak-ng), same display semantics as romanization. */
  ipa?: string;
  /**
   * Bracketed furigana (lib/furigana.ts format). Unlike romanization/ipa this
   * renders AS ruby over the sentence, not as a line under it.
   */
  furigana?: string;
  /**
   * True iff an LLM retranslation is currently in flight for this language
   * AND an existing `translatedText` is on file. Keyed off the LLM claim
   * so it does NOT fire during a "regenerate audio" action (no LLM phase).
   * Drives the warning-color "Retranslating" pill in the card header.
   */
  retranslating?: boolean;
  /**
   * True iff the card-add sweep in `scheduleMissingContent` would delete +
   * regenerate this row: its `translationVersion` is below the language's
   * current config version AND `mayRegenerateTranslation` allows the rewrite.
   * Only populated when the caller opts in via `markVersionStale`. The full
   * predicate is applied here. Callers must NOT re-derive any part of it.
   */
  versionStale?: boolean;
}

export interface CardAudioContent {
  language: string;
  voiceName: string | null;
  url: string | null;
  wordTimings: { word: string; start: number; end: number }[] | null;
  /**
   * TTS validation state. See AudioResult in convex/lib/audio.ts. Surfaced
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
  /**
   * `texts.romanizedText` for this row. Pass it as `text.romanizedText ??
   * undefined`, never `|| undefined`, which collapses the empty-string
   * "tried, failed" sentinel into "never attempted" and makes
   * `hasMissingContent` ask forever for work no scheduler will do. See the
   * tri-state note on `romanizedText` in convex/schema.ts.
   */
  sourceRomanization?: string;
  /**
   * `texts.ipaText` for this row. Same tri-state and same `?? undefined`
   * (never `|| undefined`) rule as `sourceRomanization` above.
   */
  sourceIpa?: string;
  /**
   * `texts.furiganaText` for this row. Same tri-state and same `?? undefined`
   * rule as its siblings above.
   */
  sourceFurigana?: string;
  /**
   * `texts.userCreated` for this row. Required so `versionStale` can apply the
   * whole `mayRegenerateTranslation` rule here instead of leaving half of it
   * to each caller.
   */
  userCreated: boolean;
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
  opts?: {
    /** Stamp `versionStale` on translation entries (see CardTranslationContent). */
    markVersionStale?: boolean;
    /**
     * Return stored romanization for every language instead of only for
     * `ROMANIZATION_LANGUAGES` members. The review query has always surfaced
     * whatever is stored; the gate exists for the browse/library paths.
     */
    rawRomanization?: boolean;
    /**
     * Leave `hasMissingWordTimings` out of `hasMissingContent`. The review
     * query does not treat legacy timing-less audio as a content gap.
     */
    ignoreMissingWordTimings?: boolean;
  },
): Promise<Map<string, TextContentResult>> {
  const allLanguages = getCourseLanguages(baseLanguages, targetLanguages);
  const translationFetches: Array<{
    key: string;
    lang: string;
    textId: Id<'texts'>;
    userCreated: boolean;
  }> = [];
  const audioFetches: Array<{ key: string; lang: string; textId: Id<'texts'> }> = [];

  for (const input of inputs) {
    for (const lang of allLanguages) {
      if (lang !== input.sourceLanguage) {
        translationFetches.push({
          key: input.key,
          lang,
          textId: input.textId,
          userCreated: input.userCreated,
        });
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
      translationFetches.map((item) => getLlmClaim(ctx, item.textId, item.lang)),
    ),
  ]);

  const translationMap = new Map<
    string,
    {
      text: string;
      romanization?: string;
      ipa?: string;
      furigana?: string;
      llmClaimedAt: number | null;
      versionStale: boolean;
    }
  >();
  translationFetches.forEach((item, idx) => {
    const row = translationResults[idx];
    const claim = claimResults[idx];
    translationMap.set(`${item.key}:${item.lang}`, {
      text: row?.translatedText ?? '',
      romanization: row?.romanizedText ?? undefined,
      ipa: row?.ipaText ?? undefined,
      furigana: row?.furiganaText ?? undefined,
      llmClaimedAt: claim?.claimedAt ?? null,
      versionStale:
        row != null &&
        mayRegenerateTranslation({ userCreated: item.userCreated }, row) &&
        isTranslationVersionStale(item.lang, row.translationVersion),
    });
  });

  // Resolve each audio row's payload through its shared `audioAssets` doc.
  // One deduped point-read per unique asset per batch. Decks repeat
  // sentences, so the dedup matters.
  const assetIds = [
    ...new Set(audioResults.flatMap((row) => (row ? [row.assetId] : []))),
  ];
  const assetDocs = await Promise.all(assetIds.map((id) => ctx.db.get(id)));
  const assetById = new Map(assetIds.map((id, i) => [id, assetDocs[i]]));

  const payloadByKeyAndLang = new Map<string, ResolvedAudioPayload | null>();
  audioFetches.forEach((item, idx) => {
    const row = audioResults[idx];
    payloadByKeyAndLang.set(
      `${item.key}:${item.lang}`,
      row
        ? audioPayloadFromRowAndAsset(assetById.get(row.assetId) ?? null)
        : null,
    );
  });

  const audioWithStorage = audioFetches
    .map((item, idx) => ({
      key: `${item.key}:${item.lang}`,
      payload: payloadByKeyAndLang.get(`${item.key}:${item.lang}`) ?? null,
      idx,
    }))
    .filter(
      (item): item is { key: string; payload: ResolvedAudioPayload; idx: number } =>
        item.payload !== null,
    );

  const storageUrls = await Promise.all(
    audioWithStorage.map((item) => ctx.storage.getUrl(item.payload.storageId)),
  );
  const urlMap = new Map<string, string | null>();
  audioWithStorage.forEach((item, idx) => {
    urlMap.set(item.key, storageUrls[idx]);
  });

  const result = new Map<string, TextContentResult>();
  for (const input of inputs) {
    const audioRecordings = allLanguages.map((lang) => {
      const payload = payloadByKeyAndLang.get(`${input.key}:${lang}`) ?? null;
      return {
        language: lang,
        voiceName: payload?.voiceName ?? null,
        url: urlMap.get(`${input.key}:${lang}`) ?? null,
        wordTimings: payload?.wordTimings ?? null,
        ttsQuality: payload?.ttsQuality ?? null,
      };
    });

    const translations = allLanguages.map((lang) => {
      // Gate each stored annotation on its kind's CURRENT language set
      // (spec.supports, derived from the Language entries so the check stays
      // in sync automatically). Rows written while a language was in the set
      // stay in the DB untouched, but their value is dropped from the
      // response so the UI doesn't render stale annotations after the
      // language is flipped off.
      const supports = (kind: AnnotationKind) =>
        TEXT_ANNOTATIONS[kind].supports(lang);
      // rawRomanization is the review query's historical escape hatch; it
      // predates IPA/furigana, which have no raw variant.
      const langNeedsRomanization =
        opts?.rawRomanization || supports('romanization');
      const langNeedsIpa = supports('ipa');
      const langNeedsFurigana = supports('furigana');
      if (lang === input.sourceLanguage) {
        return {
          language: lang,
          text: input.sourceText,
          isBaseLanguage: baseLanguages.includes(lang),
          isTargetLanguage: targetLanguages.includes(lang),
          romanization: langNeedsRomanization
            ? input.sourceRomanization
            : undefined,
          ipa: langNeedsIpa ? input.sourceIpa : undefined,
          furigana: langNeedsFurigana ? input.sourceFurigana : undefined,
          retranslating: false,
        };
      }
      const entry = translationMap.get(`${input.key}:${lang}`);
      const translatedText = entry?.text ?? '';
      const claimedAt = entry?.llmClaimedAt ?? null;
      const llmClaimHeld = claimedAt !== null && isClaimFresh({ claimedAt });
      return {
        language: lang,
        text: translatedText,
        isBaseLanguage: baseLanguages.includes(lang),
        isTargetLanguage: targetLanguages.includes(lang),
        romanization: langNeedsRomanization ? entry?.romanization : undefined,
        ipa: langNeedsIpa ? entry?.ipa : undefined,
        furigana: langNeedsFurigana ? entry?.furigana : undefined,
        // Show the pill only when an LLM retranslation is in flight AND a
        // prior translatedText exists (i.e. this is a *re*translation, not
        // the first-time translation of a new card).
        retranslating: llmClaimHeld && translatedText.length > 0,
        ...(opts?.markVersionStale
          ? { versionStale: entry?.versionStale ?? false }
          : {}),
      };
    });

    const hasMissingTranslation = translations.some(
      (tr) => tr.language !== input.sourceLanguage && !tr.text,
    );
    const hasMissingAudio = audioRecordings.some((audio) => !audio.url);
    // Read the STORED annotations, not the projected ones: those are display
    // values, already blanked for languages the caller didn't ask about.
    // `=== undefined` (not `!stored`) mirrors the schedulers in decks.ts,
    // which honour the empty-string "tried, failed, leave empty" sentinel
    // and never re-enqueue those rows. A truthiness test here would report
    // the card as missing content forever while nothing is willing to fill
    // it. See `romanizedText` in convex/schema.ts for the tri-state. This
    // term is what wires both kinds into the client self-heal
    // (useEnsureContent → ensureCardContent → scheduleMissingContent).
    const hasMissingAnnotation = allLanguages.some((lang) => {
      const stored =
        lang === input.sourceLanguage
          ? {
              romanization: input.sourceRomanization,
              ipa: input.sourceIpa,
              furigana: input.sourceFurigana,
            }
          : translationMap.get(`${input.key}:${lang}`);
      return ANNOTATION_KINDS.some(
        (kind) =>
          TEXT_ANNOTATIONS[kind].supports(lang) &&
          stored?.[TEXT_ANNOTATIONS[kind].projectedField] === undefined,
      );
    });
    // Legacy audio (generated before Scribe integration) has a URL but no
    // wordTimings. Flag it as missing so useEnsureContent → scheduleMissingContent
    // triggers a backfill transcription, but only where a backfill can
    // actually run. `scheduleTimingsBackfillIfNeeded` skips languages our STT
    // backend can't transcribe, so without this gate those cards would ask for
    // work that is deliberately never done.
    const hasMissingWordTimings = audioRecordings.some(
      (audio) =>
        audio.url !== null &&
        audio.wordTimings === null &&
        languageSupportsStt(audio.language),
    );

    result.set(input.key, {
      translations,
      audioRecordings,
      hasMissingContent:
        hasMissingTranslation ||
        hasMissingAudio ||
        hasMissingAnnotation ||
        (!opts?.ignoreMissingWordTimings && hasMissingWordTimings),
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
 * Pass `text` when the caller already has the doc. Avoids a redundant
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

  // CJK/Thai parts get their Intl.Segmenter word tokens appended so Convex's
  // whitespace/punctuation tokenizer can match mid-sentence words (it has no
  // CJK segmentation of its own). Romanizations are Latin and stay as-is.
  const parts = [
    resolvedText?.language
      ? appendSearchSegments(sourceText, resolvedText.language)
      : sourceText,
    resolvedText?.romanizedText,
    ...foundTranslations.map((t) => appendSearchSegments(t.text, t.lang)),
    ...foundTranslations.map((t) => t.romanization),
  ];

  return {
    searchableText: parts.filter(Boolean).join(' '),
    searchableTextLanguages: foundTranslations.map((t) => t.lang),
  };
}

/** Caches for `buildSearchableTextPatchForCard`, scoped by the caller. */
export interface SearchableTextRebuildCaches {
  /** deck → course languages (null when the deck/course no longer resolves). */
  deckLanguages: Map<Id<'decks'>, string[] | null>;
  /**
   * Optional memo of built results keyed by (textId, languages), valid
   * across cards because the build depends only on those two inputs.
   */
  built?: Map<string, { searchableText: string; searchableTextLanguages: string[] }>;
}

/**
 * Per-card core of the `searchableText` rebuild, shared by the live fan-out
 * (`rebuildSearchableTextForText` in features/decks.ts) and the migration
 * (`rebuildCardSearchableText` in migrations.ts): resolve the card's deck →
 * course languages (memoized in the caller-provided cache), build the search
 * string, and return it as a patch, or `undefined` when the deck/course no
 * longer resolves or the stored fields are already current.
 */
export async function buildSearchableTextPatchForCard(
  ctx: ContentCtx,
  card: Pick<
    Doc<'cards'>,
    'deckId' | 'textId' | 'searchableText' | 'searchableTextLanguages'
  >,
  text: Doc<'texts'>,
  caches: SearchableTextRebuildCaches,
): Promise<
  { searchableText: string; searchableTextLanguages: string[] } | undefined
> {
  let languages = caches.deckLanguages.get(card.deckId);
  if (languages === undefined) {
    const deck = await ctx.db.get(card.deckId);
    const course = deck ? await ctx.db.get(deck.courseId) : null;
    languages = course
      ? [...course.baseLanguages, ...course.targetLanguages]
      : null;
    caches.deckLanguages.set(card.deckId, languages);
  }
  if (!languages) return undefined;

  const builtKey = `${card.textId}|${languages.join('|')}`;
  let built = caches.built?.get(builtKey);
  if (!built) {
    built = await buildCardSearchableText(
      ctx,
      card.textId,
      text.text,
      languages,
      text,
    );
    caches.built?.set(builtKey, built);
  }
  return isSearchableTextCurrent(card, built) ? undefined : built;
}

/**
 * Whether a card's stored search fields already match a freshly built
 * result, so rebuild passes (live fan-out and migration) can skip the write.
 * A card with `searchableTextLanguages` unset is never current. The rebuild
 * stamps the field.
 */
export function isSearchableTextCurrent(
  card: Pick<Doc<'cards'>, 'searchableText' | 'searchableTextLanguages'>,
  built: { searchableText: string; searchableTextLanguages: string[] },
): boolean {
  return (
    card.searchableText === built.searchableText &&
    card.searchableTextLanguages !== undefined &&
    card.searchableTextLanguages.length ===
      built.searchableTextLanguages.length &&
    card.searchableTextLanguages.every(
      (l, i) => l === built.searchableTextLanguages[i],
    )
  );
}
