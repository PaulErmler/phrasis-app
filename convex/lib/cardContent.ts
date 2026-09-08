import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';
import {
  isTranslationVersionStale,
  languageSupportsStt,
  languageSupportsWordTimings,
} from '../../lib/languages';
import {
  TEXT_ANNOTATIONS,
  annotationFieldsOf,
  missingAnnotationKinds,
  type AnnotationFields,
  type AnnotationKind,
} from './textAnnotations';
import { mayRegenerateTranslation } from '../../lib/translationProvenance';
import type {
  LanguageRendering,
  RenderingText,
} from '../../lib/preferenceResolution';
import { getLlmClaim, isClaimFresh } from '../features/llmTranslationQueue';
import { appendSearchSegments } from '../../lib/wordTokenize';
import {
  audioPayloadFromRowAndAsset,
  sttBackfillExhausted,
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
  audioPointer,
  renderingForView,
  sourceRenderingForView,
  cardVoiceForView,
  CANONICAL_RENDERING,
  canonicalSatisfies,
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
  /**
   * The voice this language's clip is in: one per card, the text's own
   * voice or the card's Flag-dialog correction. Drives the gender chip in
   * the card header, which every card shows. Absent only for readers that
   * pass no `renderingText`.
   */
  voiceGender?: 'male' | 'female';
  /**
   * What the served wording is on the sentence-form axes, from the row's
   * classifier stamps (docs/architecture/translation-variants.md). Present
   * only when the axis is marked in this wording; `renderedPoliteness`
   * drives the politeness chip. A pre-feature card shows what its row IS,
   * not the setting.
   */
  renderedGender?: 'masculine' | 'feminine';
  renderedPoliteness?: 'casual' | 'polite' | 'formal';
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
   * Some served row lacks an annotation kind its language supports, or
   * carries one from a retired engine (`missingAnnotationKinds`). One of the
   * terms of `hasMissingContent`, exposed on its own for readers whose
   * self-heal is keyed differently (the collection preview requests such
   * rows through `requestPreviewTranslations`).
   */
  hasMissingAnnotation: boolean;
  /**
   * A rendering variant the view resolves to has not landed (its wording
   * or its audio): the card shows canonical meanwhile. Counted into
   * `hasMissingContent` only with `opts.includeVariantGaps`, so a reader
   * that never triggers variant generation does not ask forever.
   */
  hasMissingVariant: boolean;
  /**
   * Course languages whose translation entry is empty or, with
   * `markVersionStale`, version-stale, plus the text's own language when
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
   * The text row's annotation values and engine tags, built with
   * `annotationFieldsOf(text)`. The values render on the source entry; the
   * tags feed the missing-content probe, which asks `missingAnnotationKinds`
   * (the same question the schedulers ask) so the trigger and the work it
   * triggers cannot disagree. The helper keeps the empty-string "tried,
   * failed" sentinel intact (a `||` would collapse it into "never attempted"
   * and make `hasMissingContent` ask forever for work no scheduler will do;
   * see the tri-state note on `romanizedText` in convex/schema.ts) and it
   * carries every tag, so a row produced by a retired engine cannot look
   * complete.
   */
  sourceAnnotations: AnnotationFields;
  /**
   * `texts.userCreated` for this row. Required so `versionStale` can apply the
   * whole `mayRegenerateTranslation` rule here instead of leaving half of it
   * to each caller.
   */
  userCreated: boolean;
  /**
   * The text row's rendering fields (`renderingTextOf(text)`), needed with
   * `view.settings` to resolve the sentence-form variant per language.
   * Omit for readers that never serve variants.
   */
  renderingText?: RenderingText;
  /**
   * The card this content is shown on (`viewOfCard(card)`). Its pin picks
   * the revision each translation resolves to (convex/db/translationReads.ts),
   * audio included, so a version bump never changes an existing card. Its
   * `accentLanguage` picks the accent row the source slot reads on a
   * mixed-accent course. Omit it, or pass null, for readers with no card
   * such as the collection preview and the placement test. They show the
   * live rows and the accent row a new card would get.
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
    /**
     * Count a missing rendering variant (wording or audio) as missing
     * content, so the client self-heal asks the ensure path for it. Only
     * for readers whose heal generates variants (the review query).
     */
    includeVariantGaps?: boolean;
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
    /**
     * The rendering variant the slot reads (docs/architecture/
     * translation-variants.md). A source slot (accent row or not) reads
     * `sourceRenderingForView`: the voice only. A target slot is resolved
     * once its canonical row is in hand, since a mixed code's form depends
     * on the row's dialect.
     */
    rendering: LanguageRendering;
    isSource: boolean;
  }> = [];
  const audioFetches: Array<{
    slot: string;
    rowLang: string;
    textId: Id<'texts'>;
    /** `audioVariantKey` of the slot, when the view wants a specific voice. */
    variantKey: string | undefined;
  }> = [];
  // `${key}:${lang}` -> accent code, for the source slots that read an
  // accent row. Such a slot fetches the accent row's audio under the slot
  // and the source audio under `sourceAudioSlot`, and falls back to the
  // source wording + audio while the row is missing.
  const accentSlots = new Map<string, string>();

  for (const input of inputs) {
    const pinAt = input.view?.pinAt;
    const hasRendering =
      input.renderingText !== undefined && input.view?.settings !== undefined;
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
          rendering: CANONICAL_RENDERING,
          isSource: false,
        });
        continue;
      }
      // Every language of the card is spoken in one voice, the source
      // included: its clip (and the accent row's) is read under the voice
      // key when the card's voice is not the canonical clip's.
      const sourceRendering = hasRendering
        ? sourceRenderingForView(
            input.view ?? null,
            input.renderingText!,
            input.textId,
          )
        : CANONICAL_RENDERING;
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
          rendering: sourceRendering,
          isSource: true,
        });
        audioFetches.push({
          slot,
          rowLang: accent,
          textId: input.textId,
          variantKey: sourceRendering.audioVariantKey ?? undefined,
        });
      }
      audioFetches.push({
        slot: accent !== undefined ? sourceAudioSlot(slot) : slot,
        rowLang: lang,
        textId: input.textId,
        variantKey: sourceRendering.audioVariantKey ?? undefined,
      });
    }
  }

  // The canonical rows first. A target slot's rendering is resolved from
  // its row's dialect (`regionVariant`) before the variant reads below.
  const [translationResults, claimResults] = await Promise.all([
    Promise.all(
      translationFetches.map((item) =>
        liveTranslation(ctx, item.textId, item.rowLang),
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
  const inputByKey = new Map(inputs.map((input) => [input.key, input]));
  translationFetches.forEach((item, idx) => {
    if (item.isSource) return;
    const input = inputByKey.get(item.key)!;
    if (input.renderingText !== undefined && input.view?.settings) {
      item.rendering = renderingForView(
        input.view,
        input.renderingText,
        input.textId,
        item.lang,
        translationResults[idx]?.regionVariant,
      );
    }
    audioFetches.push({
      slot: `${item.key}:${item.lang}`,
      rowLang: item.lang,
      textId: item.textId,
      variantKey: item.rendering.audioVariantKey ?? undefined,
    });
  });

  // Pin resolution: only a pinned (card, language) pair whose live row has
  // been archived since the pin does a further read; everything else
  // resolves synchronously to the live row.
  const servedCanonical: (ServedTranslation | null)[] = await Promise.all(
    translationFetches.map((item, idx) => {
      const live = translationResults[idx];
      return live
        ? resolveServedFromLive(ctx, live, item.pinAt)
        : Promise.resolve(null);
    }),
  );

  // A slot that resolves to a rendering variant fetches the variant row
  // as well: the card shows canonical until the variant has landed, and a
  // variant stamped `sameAsCanonical` defers to it too. Same for audio: the
  // canonical pointer plays until the voice variant exists. A card pinned
  // to an archived revision never reads a variant (they are rewrites of
  // the live wording; `resolveServedRendering` has the rule).
  const [variantTranslationResults, audioResults, variantAudioResults] =
    await Promise.all([
      Promise.all(
        translationFetches.map((item, idx) =>
          item.rendering.textVariantKey && !servedCanonical[idx]?.archived
            ? liveTranslation(
                ctx,
                item.textId,
                item.rowLang,
                item.rendering.textVariantKey,
              )
            : Promise.resolve(null),
        ),
      ),
      Promise.all(
        audioFetches.map((item) =>
          audioPointer(ctx, item.textId, item.rowLang),
        ),
      ),
      Promise.all(
        audioFetches.map((item) =>
          item.variantKey
            ? audioPointer(ctx, item.textId, item.rowLang, item.variantKey)
            : Promise.resolve(null),
        ),
      ),
    ]);

  const servedResults: (ServedTranslation | null)[] = await Promise.all(
    translationFetches.map((item, idx) => {
      const variant = variantTranslationResults[idx];
      return variant && !variant.sameAsCanonical
        ? resolveServedFromLive(ctx, variant, item.pinAt)
        : Promise.resolve(servedCanonical[idx]);
    }),
  );

  type TranslationEntry = {
    text: string;
    romanization?: string;
    ipa?: string;
    furigana?: string;
    /** Stored values + engine tags, for the missing-content probe. */
    annotationSources: AnnotationFields;
    llmClaimedAt: number | null;
    versionStale: boolean;
    /**
     * The card is pinned to a superseded revision. Its wording never
     * regenerates, but its annotations and audio are filled and repaired
     * by the sweep like a live row's, so its gaps count as missing content.
     */
    archived: boolean;
    /** Classifier stamps of the served row, for the chips on the card. */
    renderedGender: Doc<'translations'>['renderedGender'];
    renderedPoliteness: Doc<'translations'>['renderedPoliteness'];
    /** The view wants a text variant that has not landed. */
    textVariantMissing: boolean;
    /** The served row is a variant with its own wording. */
    servedVariant: boolean;
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
      // Carried for the missing-content probe below, not for display.
      annotationSources: row ? annotationFieldsOf(row) : {},
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
      renderedGender: row?.renderedGender,
      renderedPoliteness: row?.renderedPoliteness,
      // Canonical whose stamps already are the requested form is not a
      // gap (canonicalSatisfies), so browse and review never ask for a
      // rewrite that would come back identical.
      textVariantMissing:
        item.rendering.textVariantKey !== null &&
        variantTranslationResults[idx] === null &&
        served !== null &&
        !served.archived &&
        !canonicalSatisfies(served.live, item.rendering),
      servedVariant:
        variantTranslationResults[idx] !== null &&
        variantTranslationResults[idx]!.sameAsCanonical !== true,
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
      ...variantAudioResults.flatMap((row) => (row ? [row.assetId] : [])),
      ...archivedAudioByKeyAndLang.values(),
    ]),
  ];
  const assetDocs = await Promise.all(assetIds.map((id) => ctx.db.get(id)));
  const assetById = new Map(assetIds.map((id, i) => [id, assetDocs[i]]));

  const payloadByKeyAndLang = new Map<string, ResolvedAudioPayload | null>();
  // Slots whose voice variant has not landed (the canonical clip plays).
  const audioVariantMissing = new Set<string>();
  audioFetches.forEach((item, idx) => {
    const keyAndLang = item.slot;
    const entry = translationMap.get(keyAndLang);
    const variantRow = variantAudioResults[idx];
    // An archived revision plays its own asset whatever the voice: the pin
    // outranks the voice, so no variant clip is missing for it.
    if (item.variantKey && !variantRow && !entry?.archived) {
      audioVariantMissing.add(keyAndLang);
    }
    // A variant WORDING plays only its own clip: the canonical clip speaks
    // a wording this card does not show (same rule as archived rows). A
    // canonical wording waiting for its voice variant keeps playing the
    // canonical clip meanwhile.
    const row = variantRow ?? (entry?.servedVariant ? null : audioResults[idx]);
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

  // Per input and course language, the accent row entry the source slot is
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
  // blob. A verbatim accent row shares the source clip's asset.
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

    // One voice per card, for the gender chip on every surface. Readers
    // that pass no rendering fields (none of the card surfaces) get none.
    const voiceGender =
      input.renderingText !== undefined
        ? cardVoiceForView(
            input.view ?? null,
            input.renderingText,
            input.textId,
          )
        : undefined;
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
            ? input.sourceAnnotations.romanizedText
            : undefined,
          ipa: langNeedsIpa ? input.sourceAnnotations.ipaText : undefined,
          furigana: langNeedsFurigana
            ? input.sourceAnnotations.furiganaText
            : undefined,
          retranslating: false,
          ...(voiceGender ? { voiceGender } : {}),
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
        // The chips: the card's voice always, a stamped marked politeness
        // axis, and nothing while the variant the card is about to show has
        // not landed (the canonical stamps would describe a wording about
        // to change).
        ...(voiceGender ? { voiceGender } : {}),
        ...(entry?.renderedGender &&
        entry.renderedGender !== 'unmarked' &&
        !entry.textVariantMissing
          ? { renderedGender: entry.renderedGender }
          : {}),
        ...(entry?.renderedPoliteness &&
        entry.renderedPoliteness !== 'unmarked' &&
        !entry.textVariantMissing
          ? { renderedPoliteness: entry.renderedPoliteness }
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
    // The source slot is listed when the accent row it reads is missing or
    // version-stale. The entry carries the accent row's `versionStale`, so
    // browsing a collection regenerates a stale rewrite like any other row.
    const missingTranslationLanguages = translations
      .filter((tr) =>
        tr.language === input.sourceLanguage
          ? resolution(input, tr.language).accentRowMissing ||
            tr.versionStale === true
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
      const isPlainSourceRow =
        lang === input.sourceLanguage &&
        resolution(input, lang).accentEntry === undefined;
      const stored = isPlainSourceRow
        ? input.sourceAnnotations
        : (translationMap.get(`${input.key}:${lang}`)?.annotationSources ?? {});
      // Ask the schedulers' own question, so "the card needs work" and "there
      // is work to do" are one definition rather than two that drift.
      return missingAnnotationKinds(lang, stored).length > 0;
    });
    // Legacy audio (generated before Scribe integration) has a URL but no
    // wordTimings. Flag it as missing so useEnsureContent → scheduleMissingContent
    // triggers a backfill transcription, but only where a backfill can
    // actually run. `scheduleTimingsBackfillIfNeeded` skips languages our STT
    // backend can't transcribe, so without this gate those cards would ask for
    // work that is deliberately never done.
    // Both STT-backfill terms stop asking once the asset has used up its
    // attempts (`sttBackfillExhausted`). The sweep would schedule nothing,
    // and a clip STT keeps failing on must not keep every view of the card
    // asking for it.
    const backfillExhausted = (lang: string) => {
      const payload = payloadByKeyAndLang.get(
        resolution(input, lang).audioSlot,
      );
      return payload ? sttBackfillExhausted(payload.asset) : false;
    };
    const hasMissingWordTimings = audioRecordings.some(
      (audio) =>
        audio.url !== null &&
        audio.wordTimings === null &&
        languageSupportsWordTimings(audio.language) &&
        !backfillExhausted(audio.language),
    );
    // A clip stored without a verdict because STT failed at synthesis time.
    // The sweep re-validates it (`scheduleTimingsBackfillIfNeeded`), so it
    // is missing content wherever STT can answer, timings or not.
    const hasUncheckedAudio = audioRecordings.some(
      (audio) =>
        audio.url !== null &&
        audio.ttsQuality === 'unchecked' &&
        languageSupportsStt(audio.language) &&
        !backfillExhausted(audio.language),
    );

    // The source slot counts too: its wording never varies, but its clip
    // (the one that renders, accent row or source) follows the card's voice.
    const hasMissingVariant = allLanguages.some(
      (lang) =>
        (translationMap.get(`${input.key}:${lang}`)?.textVariantMissing ??
          false) ||
        audioVariantMissing.has(resolution(input, lang).audioSlot),
    );

    result.set(input.key, {
      translations,
      audioRecordings,
      missingTranslationLanguages,
      hasMissingAnnotation,
      hasMissingVariant,
      hasMissingContent:
        hasMissingTranslation ||
        hasMissingAudio ||
        hasMissingAnnotation ||
        hasUncheckedAudio ||
        (!opts?.ignoreMissingWordTimings && hasMissingWordTimings) ||
        (opts?.includeVariantGaps === true && hasMissingVariant),
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
 * `view` is the card's (`viewOfCard`). Its pin makes the string hold the
 * words the learner's card actually shows when the card is pinned to a
 * superseded revision, and its `accentLanguage` picks the accent row the
 * source words come from on a Mixed English course. A card being created
 * now passes just its `accentLanguage`, since it is served the live rows
 * either way.
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
  // live rows, since every card of a text that has an accent has the same
  // one, and only the pin-dependent revision choice runs per card. The served
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
