import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';
import {
  isTranslationVersionStale,
  languageSupportsWordTimings,
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
import {
  liveTranslation,
  resolveServedFromLive,
  servedAccentRow,
  servedSourceText,
  viewOfCard,
  type ServedTranslation,
  type SourceView,
} from '../db/translationReads';

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
  /**
   * Course languages whose translation entry is empty or (with
   * `markVersionStale`) version-stale, plus the text's own language when
   * the accent row it should read has not landed. What a preview hands to
   * `requestPreviewTranslations`.
   */
  missingTranslationLanguages: string[];
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
  /**
   * The card this content is shown on (`viewOfCard(card)`): its pin picks
   * the revision each translation resolves to (convex/db/translationReads.ts),
   * audio included, so a version bump never changes an existing card; its
   * `accentLanguage` picks the accent row the source slot reads on a
   * mixed-accent course. Omit (or pass null) for readers with no card
   * (collection preview, placement), which show the live rows and the
   * accent row a new card would get.
   */
  view?: SourceView | null;
}

export function getCourseLanguages(
  baseLanguages: string[],
  targetLanguages: string[],
): string[] {
  return [...new Set([...baseLanguages, ...targetLanguages])];
}

/** Audio slot of the source wording when the card also fetches an accent row. */
function sourceAudioSlot(slot: string): string {
  return `${slot}:source`;
}

/**
 * The wording a card payload's `sourceText` field carries: what the batch
 * resolved for the text's own language (the accent row on a Mixed English
 * course, see `servedAccentRow`) when that language is on the course, else
 * the source text. Keeps the media-session title, the edit dialog and the
 * source fallback line in step with the card's entries.
 */
export function sourceTextFromContent(
  content: Pick<TextContentResult, 'translations'>,
  text: Pick<Doc<'texts'>, 'text' | 'language'>,
): string {
  return (
    content.translations.find((tr) => tr.language === text.language)?.text ||
    text.text
  );
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
  // `lang` is the course language the entry is reported under; `rowLang` is
  // the language the rows are read from. They differ only for a mixed-accent
  // source slot, which reads its accent row (`servedAccentRow`).
  const translationFetches: Array<{
    key: string;
    lang: string;
    rowLang: string;
    textId: Id<'texts'>;
    userCreated: boolean;
    pinAt: number | undefined;
  }> = [];
  const audioFetches: Array<{
    slot: string;
    rowLang: string;
    textId: Id<'texts'>;
  }> = [];
  // `${key}:${lang}` -> accent code, for the source slots that read an
  // accent row. Such a slot fetches the accent row's audio under the slot
  // and the source audio under `sourceAudioSlot`, and falls back to the
  // source wording + audio while the row is missing.
  const accentSlots = new Map<string, string>();

  for (const input of inputs) {
    const pinAt = input.view?.pinAt;
    for (const lang of allLanguages) {
      const slot = `${input.key}:${lang}`;
      if (lang !== input.sourceLanguage) {
        translationFetches.push({
          key: input.key,
          lang,
          rowLang: lang,
          textId: input.textId,
          userCreated: input.userCreated,
          pinAt,
        });
        audioFetches.push({ slot, rowLang: lang, textId: input.textId });
        continue;
      }
      const accent = servedAccentRow(
        {
          _id: input.textId,
          language: input.sourceLanguage,
          userCreated: input.userCreated,
        },
        input.view ?? null,
      );
      if (accent !== undefined) {
        accentSlots.set(slot, accent);
        translationFetches.push({
          key: input.key,
          lang,
          rowLang: accent,
          textId: input.textId,
          userCreated: input.userCreated,
          pinAt,
        });
        audioFetches.push({ slot, rowLang: accent, textId: input.textId });
      }
      audioFetches.push({
        slot: accent !== undefined ? sourceAudioSlot(slot) : slot,
        rowLang: lang,
        textId: input.textId,
      });
    }
  }

  const [translationResults, audioResults, claimResults] = await Promise.all([
    Promise.all(
      translationFetches.map((item) =>
        liveTranslation(ctx, item.textId, item.rowLang),
      ),
    ),
    Promise.all(
      audioFetches.map((item) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', item.textId).eq('language', item.rowLang),
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
        getLlmClaim(ctx, item.textId, item.rowLang),
      ),
    ),
  ]);

  // Pin resolution: only a pinned (card, language) pair whose live row has
  // been archived since the pin does a further read; everything else
  // resolves synchronously to the live row.
  const servedResults: (ServedTranslation | null)[] = await Promise.all(
    translationFetches.map((item, idx) => {
      const live = translationResults[idx];
      return live
        ? resolveServedFromLive(ctx, live, item.pinAt)
        : Promise.resolve(null);
    }),
  );

  type TranslationEntry = {
    text: string;
    romanization?: string;
    ipa?: string;
    furigana?: string;
    llmClaimedAt: number | null;
    versionStale: boolean;
    /**
     * The card is pinned to a superseded revision. Its wording never
     * regenerates, but its annotations and audio are filled and repaired
     * by the sweep like a live row's, so its gaps count as missing content.
     */
    archived: boolean;
  };
  const translationMap = new Map<string, TranslationEntry>();
  // Audio for an archived revision comes from the asset the archive row
  // recorded, not from the live pointer (which now speaks the new wording).
  const archivedAudioByKeyAndLang = new Map<string, Id<'audioAssets'>>();
  translationFetches.forEach((item, idx) => {
    const served = servedResults[idx];
    const row = served?.row;
    const claim = claimResults[idx];
    const archived = served?.archived ?? false;
    const liveRegenerable =
      served != null &&
      mayRegenerateTranslation({ userCreated: item.userCreated }, served.live);
    const versionStale =
      liveRegenerable &&
      isTranslationVersionStale(item.rowLang, served!.live.translationVersion);
    translationMap.set(`${item.key}:${item.lang}`, {
      text: row?.translatedText ?? '',
      romanization: row?.romanizedText ?? undefined,
      ipa: row?.ipaText ?? undefined,
      furigana: row?.furiganaText ?? undefined,
      // The "Retranslating" pill. Off for a pinned card (the in-flight job
      // replaces the LIVE row, which this card does not show) and off while
      // the row is version-stale: the job holding the claim is then the
      // silent version-bump regeneration, which must not announce itself on
      // every existing card right after a bump. A flag retranslation on a
      // still-stale row loses the pill too; the flagger sees the client-side
      // "Flagged" pill instead.
      llmClaimedAt:
        archived || versionStale ? null : (claim?.claimedAt ?? null),
      versionStale: !archived && versionStale,
      archived,
    });
    if (served?.archived && served.audioAssetId) {
      archivedAudioByKeyAndLang.set(
        `${item.key}:${item.lang}`,
        served.audioAssetId,
      );
    }
  });

  // Resolve each audio row's payload through its shared `audioAssets` doc.
  // One deduped point-read per unique asset per batch. Decks repeat
  // sentences, so the dedup matters.
  const assetIds = [
    ...new Set([
      ...audioResults.flatMap((row) => (row ? [row.assetId] : [])),
      ...archivedAudioByKeyAndLang.values(),
    ]),
  ];
  const assetDocs = await Promise.all(assetIds.map((id) => ctx.db.get(id)));
  const assetById = new Map(assetIds.map((id, i) => [id, assetDocs[i]]));

  const payloadByKeyAndLang = new Map<string, ResolvedAudioPayload | null>();
  audioFetches.forEach((item, idx) => {
    const keyAndLang = item.slot;
    const entry = translationMap.get(keyAndLang);
    const row = audioResults[idx];
    // An archived revision plays its own asset, or nothing: the live
    // pointer's audio speaks a wording this card does not show.
    const assetId = entry?.archived
      ? archivedAudioByKeyAndLang.get(keyAndLang)
      : row?.assetId;
    payloadByKeyAndLang.set(
      keyAndLang,
      assetId
        ? audioPayloadFromRowAndAsset(assetById.get(assetId) ?? null)
        : null,
    );
  });

  // Per (input, course language): the accent row entry the source slot is
  // served, when the slot reads one and the row has landed, and the audio
  // slot that renders. While the accent row is missing the slot shows the
  // source wording and plays the source audio. Resolved once here so the
  // entries, the audio, the URL step and the missing-content terms below
  // all read the same answer.
  type SlotResolution = {
    accentEntry: TranslationEntry | undefined;
    accentRowMissing: boolean;
    audioSlot: string;
  };
  const slotResolutions = new Map<string, SlotResolution>();
  for (const input of inputs) {
    for (const lang of allLanguages) {
      const slot = `${input.key}:${lang}`;
      const readsAccentRow = accentSlots.has(slot);
      const entry = readsAccentRow ? translationMap.get(slot) : undefined;
      const accentEntry = entry?.text ? entry : undefined;
      const accentRowMissing = readsAccentRow && accentEntry === undefined;
      slotResolutions.set(slot, {
        accentEntry,
        accentRowMissing,
        audioSlot: accentRowMissing ? sourceAudioSlot(slot) : slot,
      });
    }
  }
  const resolution = (input: TextContentInput, lang: string) =>
    slotResolutions.get(`${input.key}:${lang}`)!;

  // Storage URLs only for the slots that render, one `getUrl` per distinct
  // blob (a verbatim accent row shares the source clip's asset).
  const renderedSlots = new Set(
    [...slotResolutions.values()].map((r) => r.audioSlot),
  );
  const audioWithStorage = audioFetches
    .map((item) => ({
      key: item.slot,
      payload: payloadByKeyAndLang.get(item.slot) ?? null,
    }))
    .filter(
      (item): item is { key: string; payload: ResolvedAudioPayload } =>
        item.payload !== null && renderedSlots.has(item.key),
    );
  const storageIds = [
    ...new Set(audioWithStorage.map((item) => item.payload.storageId)),
  ];
  const storageUrls = await Promise.all(
    storageIds.map((storageId) => ctx.storage.getUrl(storageId)),
  );
  const urlByStorageId = new Map<Id<'_storage'>, string | null>();
  storageIds.forEach((storageId, idx) => {
    urlByStorageId.set(storageId, storageUrls[idx]);
  });
  const urlMap = new Map<string, string | null>();
  for (const item of audioWithStorage) {
    urlMap.set(item.key, urlByStorageId.get(item.payload.storageId) ?? null);
  }

  const result = new Map<string, TextContentResult>();
  for (const input of inputs) {
    const audioRecordings = allLanguages.map((lang) => {
      const { audioSlot } = resolution(input, lang);
      const payload = payloadByKeyAndLang.get(audioSlot) ?? null;
      return {
        language: lang,
        voiceName: payload?.voiceName ?? null,
        url: urlMap.get(audioSlot) ?? null,
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
      const { accentEntry } = resolution(input, lang);
      if (lang === input.sourceLanguage && accentEntry === undefined) {
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
      const entry = accentEntry ?? translationMap.get(`${input.key}:${lang}`);
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

    // A pinned card's superseded revision counts its gaps exactly like the
    // live row: `scheduleMissingContent` fills a superseded row's annotations,
    // backfills its timings and repairs its audio (contentScheduling.ts,
    // `supersededMap`), so the client self-heal has real work to ask for.
    const hasMissingTranslation =
      translations.some(
        (tr) => tr.language !== input.sourceLanguage && !tr.text,
      ) ||
      // A mixed-accent source slot whose accent row has not landed yet:
      // the card shows the source wording meanwhile, but the row is
      // required content and the sweep must be asked for it.
      allLanguages.some((lang) => resolution(input, lang).accentRowMissing);
    const missingTranslationLanguages = translations
      .filter((tr) =>
        tr.language === input.sourceLanguage
          ? resolution(input, tr.language).accentRowMissing
          : !tr.text || tr.versionStale === true,
      )
      .map((tr) => tr.language);
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
        lang === input.sourceLanguage &&
        resolution(input, lang).accentEntry === undefined
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
        languageSupportsWordTimings(audio.language),
    );

    result.set(input.key, {
      translations,
      audioRecordings,
      missingTranslationLanguages,
      hasMissingContent:
        hasMissingTranslation ||
        hasMissingAudio ||
        hasMissingAnnotation ||
        (!opts?.ignoreMissingWordTimings && hasMissingWordTimings),
    });
  }

  return result;
}

/** The live translation rows for a text, in course-language order. */
async function loadLiveTranslationRows(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  courseLanguages: string[],
): Promise<(Doc<'translations'> | null)[]> {
  return Promise.all(
    courseLanguages.map((lang) => liveTranslation(ctx, textId, lang)),
  );
}

type SearchableEntry = { lang: string; text: string; romanization?: string };

/**
 * Resolve the rows a card pinned at `pinAt` is served, as search entries,
 * plus a key identifying that exact set of revisions (for memoizing the
 * built string across cards of the same text).
 */
async function servedSearchableEntries(
  ctx: ContentCtx,
  courseLanguages: string[],
  liveRows: (Doc<'translations'> | null)[],
  pinAt: number | undefined,
): Promise<{ entries: SearchableEntry[]; revisionKey: string }> {
  const served = await Promise.all(
    liveRows.map((live) =>
      live ? resolveServedFromLive(ctx, live, pinAt) : Promise.resolve(null),
    ),
  );
  const entries: SearchableEntry[] = [];
  const keyParts: string[] = [];
  courseLanguages.forEach((lang, i) => {
    const s = served[i];
    if (!s) {
      keyParts.push('-');
      return;
    }
    entries.push({
      lang,
      text: s.row.translatedText,
      romanization: s.row.romanizedText,
    });
    keyParts.push(s.revisionId);
  });
  return { entries, revisionKey: keyParts.join(',') };
}

function composeSearchableText(
  resolvedText: Doc<'texts'> | null,
  sourceText: string,
  entries: SearchableEntry[],
): { searchableText: string; searchableTextLanguages: string[] } {
  // CJK/Thai parts get their Intl.Segmenter word tokens appended so Convex's
  // whitespace/punctuation tokenizer can match mid-sentence words (it has no
  // CJK segmentation of its own). Romanizations are Latin and stay as-is.
  const parts = [
    resolvedText?.language
      ? appendSearchSegments(sourceText, resolvedText.language)
      : sourceText,
    resolvedText?.romanizedText,
    ...entries.map((t) => appendSearchSegments(t.text, t.lang)),
    ...entries.map((t) => t.romanization),
  ];

  return {
    searchableText: parts.filter(Boolean).join(' '),
    searchableTextLanguages: entries.map((t) => t.lang),
  };
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
 *
 * `view` is the card's (`viewOfCard`): its pin makes the string hold the
 * words the learner's card actually shows when the card is pinned to a
 * superseded revision, and its `accentLanguage` picks the accent row the
 * source words come from on a Mixed English course. A card being created
 * now passes just its `accentLanguage` (it is served the live rows either
 * way).
 */
export async function buildCardSearchableText(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  courseLanguages: string[],
  opts: { text?: Doc<'texts'> | null; view: SourceView | null },
): Promise<{ searchableText: string; searchableTextLanguages: string[] }> {
  const [resolvedText, liveRows] = await Promise.all([
    opts.text !== undefined ? Promise.resolve(opts.text) : ctx.db.get(textId),
    loadLiveTranslationRows(ctx, textId, courseLanguages),
  ]);
  // The source-language words a Mixed English card shows are its accent
  // row's (`servedSourceText`), so those are the ones searched.
  const [source, { entries }] = await Promise.all([
    resolvedText && courseLanguages.includes(resolvedText.language)
      ? servedSourceText(ctx, resolvedText, opts.view)
      : Promise.resolve(null),
    servedSearchableEntries(ctx, courseLanguages, liveRows, opts.view?.pinAt),
  ]);
  return composeSearchableText(
    resolvedText,
    source?.text ?? resolvedText?.text ?? '',
    entries,
  );
}

/** Caches for `buildSearchableTextPatchForCard`, scoped by the caller. */
export interface SearchableTextRebuildCaches {
  /** deck → course languages (null when the deck/course no longer resolves). */
  deckLanguages: Map<Id<'decks'>, string[] | null>;
  /**
   * Optional memo of the live translation rows keyed by (textId, languages).
   * Every card of a text shares them; only the pin-dependent revision choice
   * differs per card, and that costs nothing for un-archived rows.
   */
  liveRows?: Map<string, (Doc<'translations'> | null)[]>;
  /**
   * Optional memo of built results keyed by (textId, languages, served
   * revisions), valid across cards because the build depends only on those
   * inputs.
   */
  built?: Map<
    string,
    { searchableText: string; searchableTextLanguages: string[] }
  >;
}

/**
 * Per-card core of the `searchableText` rebuild, shared by the live fan-out
 * (`rebuildSearchableTextForText` in features/decks.ts) and the migration
 * (`rebuildCardSearchableText` in migrations.ts): resolve the card's deck →
 * course languages (memoized in the caller-provided cache), build the search
 * string for the revisions this card is served, and return it as a patch, or
 * `undefined` when the deck/course no longer resolves or the stored fields
 * are already current.
 */
export async function buildSearchableTextPatchForCard(
  ctx: ContentCtx,
  card: Pick<
    Doc<'cards'>,
    | '_creationTime'
    | 'deckId'
    | 'textId'
    | 'searchableText'
    | 'searchableTextLanguages'
    | 'translationsAcceptedAt'
    | 'accentLanguage'
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

  const liveKey = `${card.textId}|${languages.join('|')}`;
  let liveRows = caches.liveRows?.get(liveKey);
  if (!liveRows) {
    liveRows = await loadLiveTranslationRows(ctx, card.textId, languages);
    caches.liveRows?.set(liveKey, liveRows);
  }
  const view = viewOfCard(card);
  const { entries, revisionKey } = await servedSearchableEntries(
    ctx,
    languages,
    liveRows,
    view.pinAt,
  );
  // Same rule as `buildCardSearchableText`: a Mixed English card searches
  // its accent row's words. The accent live row is memoized like the other
  // live rows (every card of a text that has an accent has the same one),
  // and only the pin-dependent revision choice runs per card. The served
  // accent revision joins the memo key like the other revisions do.
  const accent = languages.includes(text.language)
    ? servedAccentRow(text, view)
    : undefined;
  let sourceServed: ServedTranslation | null = null;
  if (accent !== undefined) {
    const accentKey = `${card.textId}|${accent}`;
    let accentRows = caches.liveRows?.get(accentKey);
    if (!accentRows) {
      accentRows = [await liveTranslation(ctx, card.textId, accent)];
      caches.liveRows?.set(accentKey, accentRows);
    }
    const live = accentRows[0];
    sourceServed = live
      ? await resolveServedFromLive(ctx, live, view.pinAt)
      : null;
  }
  const builtKey = `${liveKey}|${revisionKey}|${sourceServed?.revisionId ?? '-'}`;
  let built = caches.built?.get(builtKey);
  if (!built) {
    built = composeSearchableText(
      text,
      sourceServed?.row.translatedText ?? text.text,
      entries,
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
