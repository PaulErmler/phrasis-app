import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';
import {
  ROMANIZATION_LANGUAGES,
  IPA_LANGUAGES,
  isTranslationVersionStale,
  languageSupportsStt,
} from '../../lib/languages';
import { mayRegenerateTranslation } from '../../lib/translationProvenance';
import { getLlmClaim, isClaimFresh } from '../features/llmTranslationQueue';
import { appendSearchSegments } from '../../lib/wordTokenize';
import {
  audioPayloadFromRowAndAsset,
  findAudioAssetByKey,
  type ResolvedAudioPayload,
} from './audioAssets';
import {
  preferenceGender,
  textEligibleForGenderVariant,
  type SpeakerGenderPreference,
} from '../../lib/speakerGender';

type ContentCtx = QueryCtx | MutationCtx;

export interface CardTranslationContent {
  language: string;
  text: string;
  isBaseLanguage: boolean;
  isTargetLanguage: boolean;
  romanization?: string;
  /** IPA transcription (espeak-ng), same display semantics as romanization. */
  ipa?: string;
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
   * `texts.userCreated` for this row. Required so `versionStale` can apply the
   * whole `mayRegenerateTranslation` rule here instead of leaving half of it
   * to each caller.
   */
  userCreated: boolean;
  /**
   * `texts.audioSpeakerGender` for this row (pass `?? undefined`). Only read
   * when `opts.speakerGenderPreference` is 'male'/'female': the overlay
   * applies exactly to premade texts whose stored gender differs from the
   * preference (a matching stored gender means the base content already IS
   * the preferred content). Omitting it disables the overlay for the row.
   */
  audioSpeakerGender?: string;
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
    /**
     * The viewing user's speaker-gender preference (resolved through
     * `resolveSpeakerGenderPreference`). 'male'/'female' turns on the
     * read-time overlay for premade texts whose stored gender differs:
     * translations come from the gendered `translationVariants` row (only
     * for languages whose wording changes with the speaker's gender) and
     * audio from the content-addressed asset store at the preferred gender —
     * each falling back to the base row / pointer audio while the overlay
     * content generates, and never mixing one gender's wording with the
     * other's voice. Missing overlay content is folded into
     * `hasMissingContent` so the ensure self-heal generates it lazily.
     */
    speakerGenderPreference?: SpeakerGenderPreference;
  },
): Promise<Map<string, TextContentResult>> {
  const allLanguages = getCourseLanguages(baseLanguages, targetLanguages);

  // The gender the speaker-gender-preference overlay works toward for one
  // input row, or null when the row keeps its base content: preference unset
  // or 'mixed', a user-created text (its gender was resolved at creation and
  // its wording is never regenerated), a text whose gender hasn't been
  // resolved yet, or a stored gender that already matches the preference.
  const prefGender = opts?.speakerGenderPreference
    ? preferenceGender(opts.speakerGenderPreference)
    : null;
  const overlayGenderFor = (input: TextContentInput): 'male' | 'female' | null => {
    if (prefGender === null || input.userCreated) return null;
    const stored = input.audioSpeakerGender;
    if (stored !== 'male' && stored !== 'female') return null;
    return stored !== prefGender ? prefGender : null;
  };

  const translationFetches: Array<{
    key: string;
    lang: string;
    textId: Id<'texts'>;
    userCreated: boolean;
  }> = [];
  const audioFetches: Array<{ key: string; lang: string; textId: Id<'texts'> }> = [];
  // One fetch per (overlaid input × language whose wording can change with
  // the speaker's gender): the `translationVariants` row for the preferred
  // gender, if it exists.
  const variantFetches: Array<{
    key: string;
    lang: string;
    textId: Id<'texts'>;
    gender: 'male' | 'female';
  }> = [];

  for (const input of inputs) {
    const overlayGender = overlayGenderFor(input);
    for (const lang of allLanguages) {
      if (lang !== input.sourceLanguage) {
        translationFetches.push({
          key: input.key,
          lang,
          textId: input.textId,
          userCreated: input.userCreated,
        });
        if (
          overlayGender !== null &&
          textEligibleForGenderVariant(lang, input.sourceText)
        ) {
          variantFetches.push({
            key: input.key,
            lang,
            textId: input.textId,
            gender: overlayGender,
          });
        }
      }
      audioFetches.push({ key: input.key, lang, textId: input.textId });
    }
  }

  const [translationResults, audioResults, claimResults, variantResults] =
    await Promise.all([
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
      Promise.all(
        variantFetches.map((item) =>
          ctx.db
            .query('translationVariants')
            .withIndex('by_text_language_and_gender', (q) =>
              q
                .eq('textId', item.textId)
                .eq('targetLanguage', item.lang)
                .eq('speakerGender', item.gender),
            )
            .first(),
        ),
      ),
    ]);

  const translationMap = new Map<
    string,
    {
      text: string;
      romanization?: string;
      ipa?: string;
      regionVariant?: string;
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
      regionVariant: row?.regionVariant ?? undefined,
      llmClaimedAt: claim?.claimedAt ?? null,
      versionStale:
        row != null &&
        mayRegenerateTranslation({ userCreated: item.userCreated }, row) &&
        isTranslationVersionStale(item.lang, row.translationVersion),
    });
  });

  const variantMap = new Map<string, Doc<'translationVariants'> | null>();
  variantFetches.forEach((item, idx) => {
    variantMap.set(`${item.key}:${item.lang}`, variantResults[idx]);
  });

  // ── Overlay resolution ──
  // For every overlaid (input, language), what the preferred-gender content
  // would be: which wording the audio must speak (the ready variant's for
  // gender-marking languages, the base wording otherwise) and where its
  // audio asset would live. Slots whose wording isn't available yet (variant
  // still generating, base translation missing) get no lookup — the base
  // content keeps serving and the missing flag below drives generation.
  type OverlaySlot = {
    /** Language of this slot (kept here so no key parsing is needed). */
    lang: string;
    /** The wording the preferred-gender audio must speak. */
    spokenText: string;
    regionVariant: string | undefined;
    gender: 'male' | 'female';
    /** Set when this slot swaps the translation text to a ready variant. */
    variant: Doc<'translationVariants'> | null;
    /** True when a variant is required but not ready yet. */
    variantPending: boolean;
    asset: Doc<'audioAssets'> | null;
  };
  const overlayByKeyAndLang = new Map<string, OverlaySlot>();
  for (const input of inputs) {
    const overlayGender = overlayGenderFor(input);
    if (overlayGender === null) continue;
    for (const lang of allLanguages) {
      const mapKey = `${input.key}:${lang}`;
      if (lang === input.sourceLanguage) {
        overlayByKeyAndLang.set(mapKey, {
          lang,
          spokenText: input.sourceText,
          regionVariant: undefined,
          gender: overlayGender,
          variant: null,
          variantPending: false,
          asset: null,
        });
        continue;
      }
      const base = translationMap.get(mapKey);
      if (variantMap.has(mapKey)) {
        const variant = variantMap.get(mapKey) ?? null;
        if (variant?.translatedText !== undefined) {
          overlayByKeyAndLang.set(mapKey, {
            lang,
            spokenText: variant.translatedText,
            regionVariant: variant.regionVariant ?? base?.regionVariant,
            gender: overlayGender,
            variant,
            variantPending: false,
            asset: null,
          });
        } else {
          // Variant required but not ready: keep base content, flag pending.
          overlayByKeyAndLang.set(mapKey, {
            lang,
            spokenText: '',
            regionVariant: undefined,
            gender: overlayGender,
            variant: null,
            variantPending: true,
            asset: null,
          });
        }
      } else if (base && base.text.length > 0) {
        overlayByKeyAndLang.set(mapKey, {
          lang,
          spokenText: base.text,
          regionVariant: base.regionVariant,
          gender: overlayGender,
          variant: null,
          variantPending: false,
          asset: null,
        });
      }
      // Base translation missing entirely: no overlay slot; the ordinary
      // missing-translation term already drives the ensure sweep.
    }
  }

  // Resolve each audio row's payload through its shared `audioAssets` doc.
  // One deduped point-read per unique asset per batch. Decks repeat
  // sentences, so the dedup matters. The overlay's preferred-gender asset
  // lookups ride the same round.
  const assetIds = [
    ...new Set(audioResults.flatMap((row) => (row ? [row.assetId] : []))),
  ];
  const overlayLookups = [...overlayByKeyAndLang.entries()].filter(
    ([, slot]) => slot.spokenText.length > 0,
  );
  const [assetDocs, overlayAssets] = await Promise.all([
    Promise.all(assetIds.map((id) => ctx.db.get(id))),
    Promise.all(
      overlayLookups.map(([, slot]) =>
        findAudioAssetByKey(ctx, {
          language: slot.lang,
          voiceGender: slot.gender,
          regionVariant: slot.regionVariant,
          spokenText: slot.spokenText,
        }),
      ),
    ),
  ]);
  const assetById = new Map(assetIds.map((id, i) => [id, assetDocs[i]]));
  overlayLookups.forEach(([, slot], idx) => {
    slot.asset = overlayAssets[idx];
  });

  const payloadByKeyAndLang = new Map<string, ResolvedAudioPayload | null>();
  audioFetches.forEach((item, idx) => {
    const row = audioResults[idx];
    const mapKey = `${item.key}:${item.lang}`;
    // Preferred-gender overlay audio wins over the pointer when its asset
    // exists; the pointer stays the fallback while the overlay generates.
    const overlayAsset = overlayByKeyAndLang.get(mapKey)?.asset ?? null;
    payloadByKeyAndLang.set(
      mapKey,
      overlayAsset
        ? audioPayloadFromRowAndAsset(overlayAsset)
        : row
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
      // Gate stored romanization on the language's current
      // `needsRomanization` flag. Rows written while the flag was on stay
      // in the DB untouched, but their romanizedText is dropped from the
      // response so the UI doesn't render stale transliteration after the
      // language is flipped off. See ROMANIZATION_LANGUAGES in
      // lib/languages.ts. It's derived from the Language entries so this
      // check stays in sync automatically.
      const langNeedsRomanization =
        opts?.rawRomanization || ROMANIZATION_LANGUAGES.has(lang);
      // Same flag-gate for IPA (no raw escape hatch: the rawRomanization opt
      // predates IPA and exists only for the review query's historical
      // romanization behavior).
      const langNeedsIpa = IPA_LANGUAGES.has(lang);
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
          retranslating: false,
        };
      }
      const entry = translationMap.get(`${input.key}:${lang}`);
      // Speaker-gender overlay: swap in the gendered variant's wording, but
      // ONLY when its preferred-gender audio exists too — the swap is atomic
      // so the card never pairs one gender's wording with the other's voice.
      // Until both are ready the base row keeps serving.
      const slot = overlayByKeyAndLang.get(`${input.key}:${lang}`);
      const servedVariant =
        slot?.variant && slot.asset !== null ? slot.variant : null;
      const translatedText = servedVariant
        ? (servedVariant.translatedText ?? '')
        : (entry?.text ?? '');
      const claimedAt = entry?.llmClaimedAt ?? null;
      const llmClaimHeld = claimedAt !== null && isClaimFresh({ claimedAt });
      return {
        language: lang,
        text: translatedText,
        isBaseLanguage: baseLanguages.includes(lang),
        isTargetLanguage: targetLanguages.includes(lang),
        romanization: langNeedsRomanization
          ? servedVariant
            ? (servedVariant.romanizedText ?? undefined)
            : entry?.romanization
          : undefined,
        ipa: langNeedsIpa
          ? servedVariant
            ? (servedVariant.ipaText ?? undefined)
            : entry?.ipa
          : undefined,
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
          ? { romanization: input.sourceRomanization, ipa: input.sourceIpa }
          : translationMap.get(`${input.key}:${lang}`);
      return (
        (ROMANIZATION_LANGUAGES.has(lang) &&
          stored?.romanization === undefined) ||
        (IPA_LANGUAGES.has(lang) && stored?.ipa === undefined)
      );
    });
    // Legacy audio (generated before Scribe integration) has a URL but no
    // wordTimings. Flag it as missing so useEnsureContent → scheduleMissingContent
    // triggers a backfill transcription, but only where a backfill can
    // actually run. `scheduleTimingsBackfillIfNeeded` skips languages our STT
    // backend can't transcribe, so without this gate those cards would ask for
    // work that is deliberately never done. Overlay-served audio is excluded:
    // the timings backfill operates through the (textId, language) pointer,
    // which a preference-overlay asset deliberately has none of, so flagging
    // it would ask forever for work no scheduler can do.
    const hasMissingWordTimings = audioRecordings.some(
      (audio) =>
        audio.url !== null &&
        audio.wordTimings === null &&
        languageSupportsStt(audio.language) &&
        overlayByKeyAndLang.get(`${input.key}:${audio.language}`)?.asset ==
          null,
    );

    // Speaker-gender overlay gaps: a required gendered variant that hasn't
    // landed, or preferred-gender audio whose asset doesn't exist yet. Both
    // are filled lazily by the ensure sweep's overlay section
    // (`scheduleMissingContent` in decks.ts); until then the base content
    // above keeps serving.
    const hasMissingGenderContent = allLanguages.some((lang) => {
      const slot = overlayByKeyAndLang.get(`${input.key}:${lang}`);
      if (!slot) return false;
      if (slot.variantPending) return true;
      return slot.spokenText.length > 0 && slot.asset === null;
    });

    result.set(input.key, {
      translations,
      audioRecordings,
      hasMissingContent:
        hasMissingTranslation ||
        hasMissingAudio ||
        hasMissingAnnotation ||
        hasMissingGenderContent ||
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
