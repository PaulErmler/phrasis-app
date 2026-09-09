import { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import {
  getMixedAccentTextLanguage,
  getVoiceForText,
  getVoiceGenderByApiCode,
  resolveCardSpeakerGenders,
  getTtsProviderForLanguage,
  getTranslationConfigForLanguage,
  isMixedLanguage,
  isTtsVersionStale,
  isTranslationVersionStale,
  languageSupportsStt,
  languageSupportsWordTimings,
  pickAccentForText,
  usesSourceTextVerbatim,
} from '../../lib/languages';
import { mayRegenerateTranslation } from '../../lib/translationProvenance';
import {
  definitiveSpeakerGender,
  hasCurrentSentenceMetadata,
} from '../../lib/sentenceMetadataSource';
import { shouldOverwriteProvider } from '../../lib/ttsPrecedence';
import {
  annotationRequestInFlight,
  annotationsDue,
  missingAnnotationKinds,
  scheduleTranslationAnnotations,
  TEXT_ANNOTATIONS,
} from './textAnnotations';
import { deleteAudioRow } from './audio';
import {
  findReusableAudioAssetForVoice,
  resolveAudioPayload,
  sttBackfillExhausted,
  upsertAudioPointer,
} from './audioAssets';
import {
  storeTranslationAndScheduleTTSHandler,
  verbatimTranslationArgs,
} from '../features/translationPipeline';
import { llmPool, llmWarmPool } from './workpools';
import {
  type TtsPriority,
  type LlmPriority,
  type TranslationReason,
} from '../types';
import {
  claimTtsIfAvailable,
  hasActiveTtsClaim,
  hasBlockingTtsClaim,
} from '../features/ttsProcessing';
import {
  claimLlmTranslationIfAvailable,
  getLlmClaim,
  hasBlockingLlmClaim,
  isClaimFresh,
} from '../features/llmTranslationQueue';
import {
  splitRevisions,
  translationRevisions,
  audioPointer,
  liveTranslation,
  previewView,
  renderingForView,
  renderingTextOf,
  canonicalSatisfies,
  servedAccentRow,
  resolveServedFromLive,
  sourceRenderingForView,
  type SourceView,
  type SweepCard,
} from '../db/translationReads';
import {
  AUTO,
  axisOf,
  hasRenderingOverride,
  parseVariantKey,
  type LanguageRendering,
  type RenderingSettings,
} from '../../lib/preferenceResolution';
import {
  classificationLanguageForRow,
  renderingAxesFor,
} from './renderingClassifier';
import { MAX_ROWS_PER_CALL } from '../features/renderingClassification';

/**
 * Content-scheduling helpers: the shared "fill whatever this text is missing"
 * slice of the pipeline — claim + enqueue translations (LLM queue or legacy
 * Google path), claim + enqueue TTS (with audioAssets cache reuse), and the
 * authoritative per-text sweep (`scheduleMissingContent`) that validates
 * stored content and schedules everything absent or stale. Lifted out of
 * features/decks.ts so features/collections.ts can share it without importing
 * decks (which formed the backend's only import cycle). The registered
 * functions that expose these helpers (prepareCardContent, ensureCardContent,
 * …) stay in features/decks.ts.
 */

/**
 * Thrown by the schedulers below in probe mode (`opts.probe`) at the FIRST
 * point where a real run would write. Probe mode turns the authoritative
 * content sweep into a pure read: `scheduleContentForUpcomingCards` probes
 * each upcoming card and dispatches a per-card `prepareCardContent` mutation
 * ONLY for cards that need work. A probe pass that finds nothing performs
 * zero writes, and a zero-write mutation cannot lose an OCC race, so the
 * steady-state ensure sweep can no longer be killed by concurrently
 * completing TTS jobs (the 2026-08-20 "audioRecordings changed on every
 * retry" failure) — while staying a single billed mutation.
 */
export class ProbeNeedsWork extends Error {
  constructor() {
    super('probe: content work needed');
  }
}

/**
 * Claim + enqueue a translation job for (text, targetLanguage), the routing
 * slice shared by `scheduleMissingContent` and the collection-preview
 * generation path (`requestPreviewTranslations`). OpenRouter languages go
 * through the LLM queue under a claim; the rest take the legacy Google path
 * (still pool-bounded, claimless). Returns true iff a job was enqueued.
 */
export async function scheduleTranslationForLanguage(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  targetLanguage: string,
  opts: {
    audioSpeakerGender?: string;
    preferredRegionVariant?: string;
    /** Translation-only mode. The landing translation won't enqueue TTS. */
    skipTts?: boolean;
    /**
     * Priority the downstream TTS enqueue (in
     * `storeTranslationAndScheduleTTS`) runs at once the translation lands.
     * Distinct from `llmPriority` below: this is about the audio, that is
     * about the translation. A collection preview wants an interactive
     * translation whose audio, if any, rides the warm pool.
     */
    priority?: TtsPriority;
    /**
     * Tier the translation itself runs at: 'background' routes it to
     * `llmWarmPool` so a warm sweep can't queue ahead of user-facing work.
     * Absent means interactive.
     */
    llmPriority?: LlmPriority;
    /** Read-only probe: throw ProbeNeedsWork instead of writing. */
    probe?: boolean;
    /**
     * User whose deliberate action caused this request; the job's cost
     * events bill to them (see the llm queue validator). Absent for
     * background/self-heal sweeps.
     */
    requestedByUserId?: string;
    /**
     * Overwrite semantics for the landing write (see the `replaceExisting`
     * arg of `storeTranslationAndScheduleTTS`). Set together with
     * `translationReason: 'version_bump'` by `enqueueVersionBumpRegen`;
     * absent on every ordinary fill of a missing language.
     */
    replaceExisting?: boolean;
    /** Why the translation is requested; see translationReasonValidator. */
    translationReason?: TranslationReason;
  },
): Promise<boolean> {
  // Accent-only variant of the text's own language with no rewrite of its
  // own (an `en` sentence on an `en_us` course, a British custom sentence
  // on a Mixed English base): the wording is the source text itself, so
  // store it verbatim. The write choke point does the rest (version stamp,
  // archive-on-bump, annotations, TTS against the variant's own voice
  // pool). No LLM claim is involved. Variants that declare an
  // `accentRewrite` (`en_gb`, `en_au`) fall through to the OpenRouter path
  // below like any translation; the worker swaps in the rewrite prompt.
  if (usesSourceTextVerbatim(targetLanguage, text.language)) {
    if (opts.probe) throw new ProbeNeedsWork();
    await storeTranslationAndScheduleTTSHandler(
      ctx,
      verbatimTranslationArgs(text, targetLanguage, opts),
    );
    return true;
  }

  const tCfg = getTranslationConfigForLanguage(targetLanguage);
  if (opts.probe) {
    // A fresh LLM claim means a job already owns this translation: the real
    // call would no-op, so it is not "work needed". Priority-aware on purpose:
    // a fresh 'background' claim probed at interactive priority IS needy,
    // because the real run would take it over (cancel the warm job, re-enqueue
    // on llmPool) — a write. Google-path languages are claimless and always
    // enqueue, hence always needy here.
    if (tCfg.provider === 'openrouter') {
      if (
        await hasBlockingLlmClaim(
          ctx,
          text._id,
          targetLanguage,
          opts.llmPriority,
        )
      ) {
        return false;
      }
    }
    throw new ProbeNeedsWork();
  }
  if (tCfg.provider === 'openrouter') {
    const claimId = await claimLlmTranslationIfAvailable(
      ctx,
      text._id,
      targetLanguage,
      opts.llmPriority,
    );
    if (!claimId) return false;
    await ctx.runMutation(
      internal.features.llmTranslationQueue.enqueueLlmTranslation,
      {
        args: {
          textId: text._id,
          sourceLanguage: text.language,
          targetLanguage,
          text: text.text,
          audioSpeakerGender: opts.audioSpeakerGender,
          preferredRegionVariant: opts.preferredRegionVariant,
          skipTts: opts.skipTts,
          priority: opts.priority,
          llmPriority: opts.llmPriority,
          requestedByUserId: opts.requestedByUserId,
          replaceExisting: opts.replaceExisting,
          translationReason: opts.translationReason,
        },
      },
    );
    return true;
  }
  // Legacy Google Translate path. Runs through the LLM pools too (for
  // retries + slot bounding); holds no LLM claim, so its onComplete's
  // claim lookup no-ops.
  const pool = opts.llmPriority === 'background' ? llmWarmPool : llmPool;
  await pool.enqueueAction(
    ctx,
    internal.features.decks.processTranslationForCard,
    {
      textId: text._id,
      sourceLanguage: text.language,
      targetLanguage,
      text: text.text,
      audioSpeakerGender: opts.audioSpeakerGender,
      preferredRegionVariant: opts.preferredRegionVariant,
      skipTts: opts.skipTts,
      priority: opts.priority,
      requestedByUserId: opts.requestedByUserId,
      replaceExisting: opts.replaceExisting,
      translationReason: opts.translationReason,
    },
    {
      onComplete:
        internal.features.llmTranslationQueue.onGoogleFallbackComplete,
      context: { textId: text._id, targetLanguage },
    },
  );
  return true;
}

/**
 * Regenerate a version-stale translation IN PLACE. The row keeps serving its
 * current wording and audio until the new wording lands; the write choke
 * point (`storeTranslationAndScheduleTTS`, reason `'version_bump'`) then
 * restamps an identical result, or archives the old wording for the cards
 * that reference the text before replacing it (see `supersededAt` in
 * schema.ts). Nothing is deleted up front, so a learner never sees a gap and
 * never sees their card's wording change. Shared by the card sweep and the
 * collection preview / warmup path so the two cannot drift. Returns true iff
 * a job was enqueued; in probe mode throws ProbeNeedsWork iff it would.
 */
export async function enqueueVersionBumpRegen(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  translation: Doc<'translations'>,
  opts: {
    audioSpeakerGender?: string;
    skipTts?: boolean;
    priority?: TtsPriority;
    llmPriority?: LlmPriority;
    probe?: boolean;
    requestedByUserId?: string;
    /**
     * Why the row is regenerated. Both reasons take the same keep-row,
     * archive-the-old-wording write; the audit and the logs must still say
     * which trigger it was. Default 'version_bump'.
     */
    reason?: 'version_bump' | 'metadata_correction';
  },
): Promise<boolean> {
  const { reason, ...rest } = opts;
  return scheduleTranslationForLanguage(ctx, text, translation.targetLanguage, {
    ...rest,
    // The row survives, so its dialect pin is still on it; forwarding it
    // keeps the Google path and a swept-then-refilled race on the same
    // variant either way.
    preferredRegionVariant: translation.regionVariant,
    replaceExisting: true,
    translationReason: reason ?? 'version_bump',
  });
}

/**
 * Resolve the curated gender for `voiceName` and enqueue the TTS job. The
 * shared tail of `scheduleAudioForLanguage` and
 * `storeTranslationAndScheduleTTS`. Claim acquisition deliberately stays at
 * the call sites so write ordering is unchanged.
 */
export async function enqueueTtsForVoice(
  ctx: MutationCtx,
  {
    textId,
    text,
    language,
    voiceName,
    regionVariant,
    forceRegen,
    priority,
    requestedByUserId,
    supersededTranslationId,
    variantKey,
  }: {
    textId: Id<'texts'>;
    text: string;
    language: string;
    voiceName: string;
    regionVariant: string | undefined;
    forceRegen?: boolean;
    priority?: TtsPriority;
    /** Requester attribution for the synthesis cost event. */
    requestedByUserId?: string;
    /** Audio for a superseded revision; see ttsJobArgsValidator. */
    supersededTranslationId?: Id<'translations'>;
    /** Rendering variant the clip belongs to; see ttsJobArgsValidator. */
    variantKey?: string;
  },
): Promise<void> {
  const voiceGender = getVoiceGenderByApiCode(voiceName);
  if (voiceGender === undefined) {
    throw new Error(
      `Cannot enqueue TTS: voice "${voiceName}" for language "${language}" is not in the curated voice list.`,
    );
  }
  await ctx.runMutation(internal.features.ttsProcessing.enqueueTtsJob, {
    provider: getTtsProviderForLanguage(language),
    args: {
      textId,
      text,
      language,
      voiceName,
      voiceGender,
      speed: 1,
      regionVariant,
      forceRegen,
      priority,
      requestedByUserId,
      supersededTranslationId,
      variantKey,
    },
  });
}

/**
 * Fill audio for (text, language), the slice shared by
 * `scheduleMissingContent`, `storeTranslationAndScheduleTTS`'s siblings,
 * and the preview audio-icon click (`requestPreviewAudio`). For the text's
 * own language the source text is synthesized; for any other language the
 * caller must pass the stored translation row (synthesis text + variant
 * pin).
 *
 * Checks the content-addressed `audioAssets` store first: when a fresh asset
 * already exists for this exact (language, gender, dialect, string), the
 * text's pointer row is attached to it and NO job is enqueued, no claim, no
 * synthesis cost, audio is available immediately. On a miss (or with
 * `opts.forceRegen`, the regenerate-audio path, which must synthesize anew)
 * the claim + enqueue flow runs; the job's completion upserts the asset by
 * the same key.
 *
 * Returns true iff audio was filled or a job was enqueued (false when a
 * fresh TTS claim already owns the slot, or the translation is missing).
 */
export async function scheduleAudioForLanguage(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  language: string,
  audioSpeakerGender: string | undefined,
  translation: Doc<'translations'> | null,
  opts?: {
    forceRegen?: boolean;
    priority?: TtsPriority;
    /** Read-only probe: throw ProbeNeedsWork instead of writing. */
    probe?: boolean;
    /** Requester attribution for the synthesis cost event. */
    requestedByUserId?: string;
  },
): Promise<boolean> {
  const isSource = language === text.language;
  if (!isSource && !translation) return false;
  if (opts?.probe) {
    // A fresh TTS claim the real run would respect means a job is already
    // filling this slot — not needy. Priority-aware on purpose: a fresh
    // 'background' claim probed at interactive priority IS needy, because
    // the real run would take it over (cancel the warm job, re-enqueue on
    // the interactive pool) — a write. Anything else (cache attach or
    // claim + enqueue) would write too.
    if (await hasBlockingTtsClaim(ctx, text._id, language, opts?.priority)) {
      return false;
    }
    throw new ProbeNeedsWork();
  }
  // For mixed-dialect rows, prefer a voice in the same locale that was
  // picked at translation time and forward the variant to TTS so the
  // validation roundtrip uses the matching STT locale. Mixed-ACCENT pools
  // (`en`) get the text's deterministic accent inside `getVoiceForText`.
  const regionVariant = isSource ? undefined : translation!.regionVariant;
  const voiceName = getVoiceForText(
    language,
    text._id,
    regionVariant,
    audioSpeakerGender,
  );
  const spokenText = isSource ? text.text : translation!.translatedText;

  if (!opts?.forceRegen) {
    const asset = await findReusableAudioAssetForVoice(ctx, {
      language,
      voiceName,
      regionVariant,
      spokenText,
    });
    if (asset) {
      await upsertAudioPointer(ctx, text._id, language, asset._id);
      return true;
    }
  }

  const claimed = await claimTtsIfAvailable(
    ctx,
    text._id,
    language,
    opts?.priority,
  );
  if (!claimed) return false;
  await enqueueTtsForVoice(ctx, {
    textId: text._id,
    text: spokenText,
    language,
    voiceName,
    regionVariant,
    forceRegen: opts?.forceRegen,
    priority: opts?.priority,
    requestedByUserId: opts?.requestedByUserId,
  });
  return true;
}

/**
 * Voice or repair the audio of a SUPERSEDED translation revision (see
 * `supersededAt` in schema.ts): the wording a pinned card still shows.
 * Shared by the ensure sweep's repair (`scheduleSupersededRevisionContent`)
 * and the regenerate-audio button. The job never touches the live
 * (text, language) pointer, which speaks the live wording; it upserts the
 * asset by key and re-points the revision's `audioAssetId`
 * (`supersededTranslationId`, see ttsProcessing.ts and audioStorage.ts).
 *
 * Without `forceRegen` a fresh content-addressed asset for the same string
 * is attached to the revision with no synthesis at all (a lost asset doc).
 * With it, the existing asset is replaced in place, attempt-0 early write
 * skipped, so it keeps playing until the final write swaps its blob (dead
 * blob, stale ttsVersion or provider, the regenerate button). Returns true
 * iff audio was attached or a job was enqueued.
 */
export async function regenerateSupersededRevisionAudio(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  revision: Doc<'translations'>,
  opts: {
    audioSpeakerGender: string | undefined;
    forceRegen?: boolean;
    priority?: TtsPriority;
    requestedByUserId?: string;
  },
): Promise<boolean> {
  const language = revision.targetLanguage;
  // The wording was generated for the revision's own gender; only a legacy
  // row without a stamp falls back to the card's current gender.
  const gender = revision.speakerGender ?? opts.audioSpeakerGender;
  const voiceName = getVoiceForText(
    language,
    text._id,
    revision.regionVariant,
    gender,
  );
  if (!opts.forceRegen) {
    const asset = await findReusableAudioAssetForVoice(ctx, {
      language,
      voiceName,
      regionVariant: revision.regionVariant,
      spokenText: revision.translatedText,
    });
    if (asset) {
      if (asset._id !== revision.audioAssetId) {
        await ctx.db.patch(revision._id, { audioAssetId: asset._id });
      }
      return true;
    }
  }
  const claimed = await claimTtsIfAvailable(
    ctx,
    text._id,
    language,
    opts.priority,
  );
  if (!claimed) return false;
  await enqueueTtsForVoice(ctx, {
    textId: text._id,
    text: revision.translatedText,
    language,
    voiceName,
    regionVariant: revision.regionVariant,
    forceRegen: opts.forceRegen,
    priority: opts.priority,
    requestedByUserId: opts.requestedByUserId,
    supersededTranslationId: revision._id,
  });
  return true;
}

/**
 * Whether an asset is obsolete AS AUDIO for `lang`, independent of the
 * text it speaks. Provider: only the (current, existing) matchups listed in
 * lib/ttsPrecedence.ts force a re-synth (e.g. google overwrote azure to
 * migrate the Arabic dialects); unlisted pairs keep the audio. Assets from
 * before the provider field are legacy Google. Version: the language's
 * `ttsVersion` was bumped above the asset's stamp (a new voice pool, Gemini
 * prompt or provider), on the cache language or on the accent variant whose
 * locale the asset carries (`getCurrentTtsVersion`); `isTtsVersionStale`
 * treats an unstamped asset as current so un-backfilled rows never storm.
 * Shared by the live pointer's validity sweep and the superseded-revision
 * repair.
 */
function audioAssetMismatch(
  lang: string,
  asset: Pick<
    Doc<'audioAssets'>,
    'ttsProvider' | 'ttsVersion' | 'regionVariant'
  >,
): { providerMismatch: boolean; versionMismatch: boolean } {
  return {
    providerMismatch: shouldOverwriteProvider(
      getTtsProviderForLanguage(lang),
      asset.ttsProvider ?? 'google',
    ),
    versionMismatch: isTtsVersionStale(
      lang,
      asset.ttsVersion,
      asset.regionVariant,
    ),
  };
}

/**
 * Whether the clip a text points at speaks a different accent than the text
 * is assigned (`pickAccentForText`, the per-text hash for mixed-accent pools
 * such as `en`). This is what turns the existing English catalogue mixed
 * over time: the pointer is dropped and re-filled in the text's accent on
 * next view, while the old clip stays in the cache (`keepAsset`) for the
 * pinned-accent course and the texts that hash to its accent.
 *
 * Silent in three cases so it can never storm: a language whose pool has
 * no locales (`de`, no target accent); an asset without a stamped accent
 * (written before the accent was part of the key and not yet backfilled by
 * `backfillAudioAssetAccent`, accent unknown); and mixed-DIALECT languages
 * (`es_mixed`), whose accent is pinned on the translation row rather than
 * hashed, so the hash would be the wrong reference.
 */
function audioAccentDrifted(
  lang: string,
  textId: Id<'texts'>,
  asset: Pick<Doc<'audioAssets'>, 'regionVariant'>,
): boolean {
  if (isMixedLanguage(lang)) return false;
  if (asset.regionVariant === undefined) return false;
  const target = pickAccentForText(lang, textId);
  return target !== undefined && target !== asset.regionVariant;
}

/** Options threaded through the whole `scheduleMissingContent` sweep. */
type ContentSweepOpts = {
  /**
   * Translation-only pass (collection previews): rendering variants get
   * their wording but no audio. See `skipTts` on the LLM job args.
   */
  skipTts?: boolean;
  /**
   * Where the sweep drops the translation rows that still lack their
   * rendering stamps (`renderedGender` / `renderedPoliteness`). A caller
   * sweeping many texts passes one collector and calls
   * `flushRenderingStamps` once, so the classifier sees 25 rows per call
   * instead of one; without it the sweep flushes its own text at the end.
   * Probe passes collect too (the flush is the caller's write).
   */
  stamps?: RenderingStampCollector;
  /**
   * How many sentence-metadata classifier calls this pass may still make
   * (`requestSentenceMetadataIfNeeded`). A many-text loop passes one budget
   * so a collection warm cannot fan out into a call per text; a single-text
   * sweep runs without one. Probes spend it too: a needy probe dispatches a
   * real sweep that will make the call.
   */
  metadataCalls?: MetadataCallBudget;
  /**
   * The card the sweep runs for, when the caller has one. Read only by
   * `scheduleMissingRenderings`, so a per-card correction
   * (`cards.renderingGenderOverride` / `renderingPolitenessOverride`)
   * renders and the source clip voiced is the one the card plays (its
   * accent row); the card-less callers (collection warm) get the rendering
   * a new card would.
   */
  card?: SweepCard | null;
  /**
   * Forced regeneration (regenerateCardAudio): audio enqueues bypass the
   * `audioAssets` cache (a hit would make the regenerate button a no-op)
   * and the synthesis job replaces the shared asset in place on completion.
   */
  forceAudioRegen?: boolean;
  /**
   * TTS priority for every audio enqueue this sweep triggers, directly or
   * via a landing translation. Absent = 'interactive'; warm callers
   * (collection warms, deferred placement batches, admin warmups, bulk
   * custom-card import) pass 'background'. See ttsPriorityValidator.
   */
  priority?: TtsPriority;
  /**
   * LLM priority for every translation enqueue this sweep triggers. Absent =
   * 'interactive'; only the warmups that nobody is waiting on pass
   * 'background'. Separate from `priority` above because most warm callers
   * want background AUDIO for a translation the user may be about to read.
   * See llmPriorityValidator.
   */
  llmPriority?: LlmPriority;
  /**
   * Read-only probe: run the sweep's full decision logic but THROW
   * ProbeNeedsWork at the first point a real run would write, and write
   * nothing. In-flight work (fresh TTS/LLM claims) counts as handled, not
   * needy. Completing without the throw means the text needs nothing.
   */
  probe?: boolean;
  /**
   * User whose deliberate action caused this sweep (custom card, card edit,
   * audio regen, chat approval). Every translation/TTS job the sweep
   * enqueues bills its cost events to them. Absent for background ensure /
   * self-heal sweeps, whose spend stays in the system bucket.
   */
  requestedByUserId?: string;
};

type ResolvedAudioPayload = NonNullable<
  Awaited<ReturnType<typeof resolveAudioPayload>>
>;

/**
 * The sweep's per-language view of what is stored for the text. The maps are
 * built once by `loadContentState` and mutated in place by the two
 * invalidation sweeps (a deleted row becomes `null` so the enqueue loop
 * refills the language).
 */
type ContentSweepState = {
  /** The LIVE translation row per language (null when none exists). */
  translationMap: Map<string, Doc<'translations'> | null>;
  /**
   * The superseded revisions per language (`supersededAt` set, see
   * schema.ts), oldest first. Pinned cards are still served these, so the
   * sweep fills their annotations and repairs their audio exactly like the
   * live row's; it never regenerates their wording.
   */
  supersededMap: Map<string, Doc<'translations'>[]>;
  audioMap: Map<string, Doc<'audioRecordings'> | null>;
  llmClaimMap: Map<string, Doc<'llmTranslationClaims'> | null>;
  /** Resolved payloads for the audio rows that SURVIVED the validity sweep. */
  audioPayloadMap: Map<string, ResolvedAudioPayload>;
};

/**
 * Batch load existing translations, audio, AND LLM claims for the needed
 * languages. All three sets in one Promise.all so the read round-trips run
 * in parallel rather than serially inside the sweep loops. The claim lookup
 * gates whether `scheduleMissingContent` should defer a TTS enqueue while an
 * LLM retranslation is in flight; doing it per-language inline turned a fast
 * O(languages) read into a serial chain that pushed the mutation past
 * Convex's 1s budget when called from a batched caller like
 * `ensureContentForCollection`.
 */
async function loadContentState(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  allRequiredLanguages: string[],
  langsNeedingTranslation: string[],
): Promise<ContentSweepState> {
  const [revisions, existingAudio, existingLlmClaims] = await Promise.all([
    Promise.all(
      langsNeedingTranslation.map((lang) =>
        translationRevisions(ctx, textId, lang),
      ),
    ),
    Promise.all(
      allRequiredLanguages.map((lang) => audioPointer(ctx, textId, lang)),
    ),
    Promise.all(
      langsNeedingTranslation.map((lang) => getLlmClaim(ctx, textId, lang)),
    ),
  ]);

  // One index range per language returns the live row and its superseded
  // revisions together; rows never bumped have no revisions, so this costs
  // exactly what the live-row read used to.
  const split = revisions.map(splitRevisions);
  return {
    translationMap: new Map(
      langsNeedingTranslation.map((lang, i) => [lang, split[i].live]),
    ),
    supersededMap: new Map(
      langsNeedingTranslation.map((lang, i) => [lang, split[i].superseded]),
    ),
    audioMap: new Map(
      allRequiredLanguages.map((lang, i) => [lang, existingAudio[i]]),
    ),
    llmClaimMap: new Map(
      langsNeedingTranslation.map((lang, i) => [lang, existingLlmClaims[i]]),
    ),
    audioPayloadMap: new Map(),
  };
}

/**
 * Validate audio rows. Delete stale ones (missing blob, gender drift,
 * superseded provider, bumped ttsVersion). All checks read the row's
 * RESOLVED payload (the shared `audioAssets` row). Deleting a pointer row
 * leaves a still-shared asset untouched; the re-synthesis a stale asset
 * triggers patches that asset in place, healing every other text sharing
 * the string at once.
 * Do not delete while TTS is in flight: `processTTSForCard` may have
 * attached a row whose URL is not yet resolvable, or concurrent cleanup
 * would remove the row while later validation updates expect it to exist
 * (silent no-op).
 *
 * Mutates `state.audioMap` (deleted rows become null) and fills
 * `state.audioPayloadMap` for the surviving rows.
 */
async function sweepInvalidAudio(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Pick<Doc<'texts'>, 'userCreated' | 'speakerGender' | 'metadataSource'>,
  audioSpeakerGender: string | undefined,
  state: ContentSweepState,
  opts: ContentSweepOpts | undefined,
  // Languages whose wording is being replaced in this same pass. Their clip
  // is left exactly as it is, whatever mismatch it has: the incoming
  // replace archives it against the LIVE pointer and then invalidates it
  // itself. See the note where `correctedLanguages` is filled.
  correctedLanguages: ReadonlySet<string>,
  // Languages where a verdict has landed but the row's rendering stamp has
  // not: only the GENDER re-voice waits for it (the stamp may prove the
  // wording itself needs correcting); provider, version and accent drift
  // are detached as usual. See the note where `genderHoldLanguages` is
  // filled.
  genderHoldLanguages: ReadonlySet<string>,
): Promise<void> {
  for (const [lang, audio] of state.audioMap) {
    if (!audio) continue;
    const payload = await resolveAudioPayload(ctx, audio);
    if (!payload) {
      // Dangling pointer (asset gone), no usable audio behind this row.
      // Remove it so the enqueue loop below refills the language.
      if (await hasActiveTtsClaim(ctx, textId, lang)) continue;
      if (opts?.probe) throw new ProbeNeedsWork();
      await deleteAudioRow(ctx, audio, { blobAlreadyGone: true });
      state.audioMap.set(lang, null);
      continue;
    }
    // `db.system.get` (metadata point-read), not `storage.getUrl`: presence
    // is the signal, and the metadata read is far cheaper than minting a
    // signed URL — this loop runs per (card × language) on the ensure path.
    const blobExists = (await ctx.db.system.get(payload.storageId)) !== null;
    if (!blobExists) {
      if (await hasActiveTtsClaim(ctx, textId, lang)) {
        continue;
      }
      if (opts?.probe) throw new ProbeNeedsWork();
      // The blob is gone, nothing left to reference-protect; row (and, for
      // a last-pointer row, its dead asset) bookkeeping still runs.
      await deleteAudioRow(ctx, audio, { blobAlreadyGone: true });
      state.audioMap.set(lang, null);
    } else {
      // A wording correction is coming for this language (or the stamp that
      // decides one). Detaching the clip for ANY reason here, gender,
      // provider, version or accent, makes `replaceForVersionBump` find no
      // live pointer when the new wording lands, skip the archive, and move
      // every pinned card onto the new wording. The replace invalidates the
      // clip itself once the archive has captured it; a byte-identical
      // restamp leaves the mismatch to the next sweep, which no longer sees
      // the language as corrected.
      if (correctedLanguages.has(lang)) continue;
      // For a CURRICULUM text a voice in the other gender is no longer
      // drift: renderings are cached per voice (docs/architecture/
      // translation-variants.md) and a card that wants the other voice
      // reads an audio variant, while the canonical clip keeps the voice it
      // was made in. Two exceptions, both "the text's OWN voice changed":
      // a user-written text has no variants, so when the classifier lands
      // a definitive gender after the coin flip its single clip is
      // re-voiced; and a curriculum text whose sentence fixes the speaker's
      // gender (a current classifier verdict, lib/sentenceMetadataSource.ts)
      // is served canonical in that voice by every card, so a canonical
      // clip in the other voice is simply wrong and no variant would ever
      // replace it.
      const genderMismatch =
        !genderHoldLanguages.has(lang) &&
        (text.userCreated || definitiveSpeakerGender(text) !== null) &&
        (audioSpeakerGender === 'male' || audioSpeakerGender === 'female') &&
        payload.voiceGender !== audioSpeakerGender;
      const { providerMismatch, versionMismatch } = audioAssetMismatch(
        lang,
        payload,
      );
      // A user-created text keeps the accent it was voiced in. Its clip was
      // made for its own hash, or carried over from the shared text the
      // learner heard when it is a card-edit copy, so a drift here would
      // only be the copy's new id re-rolling the accent the learner already
      // knows.
      const accentMismatch =
        !text.userCreated && audioAccentDrifted(lang, textId, payload.asset);
      if (
        genderMismatch ||
        providerMismatch ||
        versionMismatch ||
        accentMismatch
      ) {
        if (opts?.probe) throw new ProbeNeedsWork();
        // Detach only: the asset and its blob stay even as the last pointer.
        // That audio is still CORRECT for its string+voice+accent+setup and
        // stays in the content-addressed cache: flipping the gender back, a
        // pinned-accent course, or another text with the same sentence
        // reuses it for free, and a provider or prompt-version change is a
        // NEW setup, not obsolescence. The next synthesis creates a sibling
        // asset under the new setup (`upsertAudioAsset`) and rolling the
        // setup back finds this clip again. Full garbage collection is left
        // to the manual regenerate button and the orphan cascades.
        await deleteAudioRow(ctx, audio, { keepAsset: true });
        state.audioMap.set(lang, null);
      } else {
        state.audioPayloadMap.set(lang, payload);
      }
    }
  }
}

/**
 * Invalidate translations whose recorded gender no longer matches the card's
 * current `audioSpeakerGender`. Two cases trigger deletion:
 *
 *  1. Post-PR drift: `translation.speakerGender` is stamped and disagrees
 *     with `audioSpeakerGender`. The card flipped gender (custom-chat path
 *     when the metadata LLM lands a definitive gender that overrides the
 *     initial coin-flip; or any future code path that updates the field)
 *     after the translation was written.
 *
 *  2. Legacy drift: `translation.speakerGender` is undefined (row written
 *     before the field existed) AND the matching audio was just flagged as
 *     gender-drifted by the validity loop above. Audio drift is the
 *     retrospective signal that the translation alongside it was almost
 *     certainly generated under a gender that's now wrong. Without this,
 *     the audio loop heals the voice but the translation text: produced
 *     with the wrong grammar: survives and gets stamped as if correct by
 *     the "fill if missing" path, so the user ends up hearing the right
 *     voice reading wrong-grammar text.
 *
 * A third trigger is a version-stale row: the language's `translationVersion`
 * config was bumped above the row's stamp (a new model/prompt). That one is
 * NOT a delete: the wording is still correct, so it keeps serving while a
 * replacement is generated in place (`enqueueVersionBumpRegen`), and the
 * write choke point archives it for existing cards before overwriting.
 *
 * Legacy rows without an audio drift signal are left alone. We have no
 * evidence they're wrong, and a blanket invalidation would cause a regen
 * storm across the database.
 *
 * Content we may not touch is skipped unconditionally. See
 * `mayRegenerateTranslation` (lib/translationProvenance.ts) for the rule:
 * user-created cards in full, plus human-authored rows on premade texts.
 * Note this gates the TEXT only; the audio validity loop above still runs
 * for those cards, so a user-created card whose speaker gender changed gets
 * a matching voice while keeping the wording the user chose.
 *
 * Skip when TTS is in flight: deleting now would race the pending write
 * and leave an audio row pointing at no translation. Defer to the next
 * `scheduleMissingContent` pass.
 *
 * Mutates `state.translationMap` / `state.audioMap`. Returns the
 * regionVariant of each swept row, captured BEFORE the delete (the row is
 * gone by the time the regen enqueue below runs) so mixed-dialect cards
 * keep their dialect across regeneration instead of re-rolling it, plus the
 * number of in-place version-bump regenerations it enqueued (which the fill
 * loop never sees, the rows still exist).
 */

/**
 * How many extra regenerations a row gets when its wording keeps
 * contradicting a definitive speaker gender it was already generated under.
 * The audit (`features/renderingAudit.ts`) found every live mismatch to be
 * exactly that: the model ignoring `<speaker_gender>`, not a stale row. One
 * retry buys a second sample at the cost of one call per affected row;
 * counted on the row, so a sentence the model will not render in the
 * requested gender stops asking instead of regenerating on every sweep.
 */
const MAX_GENDER_CORRECTION_RETRIES = 1;

async function sweepStaleTranslations(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  audioSpeakerGender: string | undefined,
  state: ContentSweepState,
  opts: ContentSweepOpts | undefined,
): Promise<{
  sweptRegionVariants: Map<string, string>;
  regenScheduled: number;
  correctedLanguages: Set<string>;
  genderHoldLanguages: Set<string>;
}> {
  const sweptRegionVariants = new Map<string, string>();
  const correctedLanguages = new Set<string>();
  const genderHoldLanguages = new Set<string>();
  let regenScheduled = 0;
  for (const [lang, translation] of state.translationMap) {
    if (!translation) continue;
    // The one provenance gate for all three triggers below. Covers
    // user-created (custom/chat) cards and human-authored rows alike. Every
    // regeneration site shares this predicate so none of them can drift out of
    // agreement with the others.
    if (!mayRegenerateTranslation(text, translation)) continue;

    // Gender drift by preference is gone: a canonical row keeps the gender
    // it was generated under, and a course that wants the other gender
    // reads a rendering variant (docs/architecture/translation-variants.md).
    // Two triggers are left, both in-place regenerations.
    // Version-stale translation: the language's `translationVersion` config was
    // bumped above this row's stamp (a new model/prompt). Regenerate.
    // `isTranslationVersionStale` encodes the "undefined === current" rule.
    const isVersionStale = isTranslationVersionStale(
      lang,
      translation.translationVersion,
    );
    // Contradicted by the sentence: the classifier fixed the speaker's
    // gender on this curriculum text and the row's rendering stamp proves
    // the wording was written in the other one ("somos hermanas" under a
    // coin-flipped female speaker). Only a proven row: `unmarked` expresses
    // no gender, and an unstamped row waits for `flushRenderingStamps`.
    const definitive = definitiveSpeakerGender(text);
    const marksGender = renderingAxesFor(
      classificationLanguageForRow(translation),
    ).gender;
    // A verdict on a row the classifier has not stamped yet: whether the
    // wording needs correcting is decided by the stamp, which the fill loop
    // below asks for (`collectRenderingStamp`). Until it lands, the audio
    // sweep must not re-voice the canonical clip on the verdict alone, or a
    // male clip of "estoy cansada" is synthesized and served for a pass,
    // then replaced by the correction's second clip. Only the gender
    // re-voice waits (other drift is detached as usual), and only while a
    // stamp can still come; a row the classifier gave up on is re-voiced as
    // the best that can be done for it.
    if (
      definitive !== null &&
      marksGender &&
      translation.renderedGender === undefined &&
      (translation.renderingStampAttempts ?? 0) < MAX_RENDERING_STAMP_ATTEMPTS
    ) {
      genderHoldLanguages.add(lang);
    }
    const stampContradictsVerdict =
      definitive !== null &&
      marksGender &&
      translation.renderedGender !== undefined &&
      translation.renderedGender !== 'unmarked' &&
      translation.renderedGender !== axisOf(definitive);
    // The row was written under the OTHER gender: the verdict landed after
    // it, so regenerating is the whole point and costs no budget.
    const firstGenderCorrection =
      stampContradictsVerdict && translation.speakerGender !== definitive;
    // The row was already written under the verdict and STILL renders the
    // other gender, so the model ignored `<speaker_gender>` rather than
    // the row being stale. `translations.speakerGender` used to end the
    // matter here; it now buys `MAX_GENDER_CORRECTION_RETRIES` more
    // attempts, counted on the row so a model that keeps refusing cannot
    // put the sweep in a loop.
    const retryGenderCorrection =
      stampContradictsVerdict &&
      translation.speakerGender === definitive &&
      (translation.genderCorrectionAttempts ?? 0) <
        MAX_GENDER_CORRECTION_RETRIES;
    const isGenderContradicted = firstGenderCorrection || retryGenderCorrection;

    if (!isVersionStale && !isGenderContradicted) continue;
    if (await hasActiveTtsClaim(ctx, textId, lang)) continue;
    // Defer while an LLM retranslation is in flight. It will overwrite the row
    // anyway, so deleting now just races the pending write.
    const llmClaim = state.llmClaimMap.get(lang) ?? null;
    if (llmClaim && isClaimFresh(llmClaim)) continue;

    // Keep the row and its audio serving, and regenerate in place. The
    // helper throws ProbeNeedsWork in probe mode iff it would enqueue,
    // matching the fill path's probe semantics.
    const enqueued = await enqueueVersionBumpRegen(ctx, text, translation, {
      audioSpeakerGender,
      priority: opts?.priority,
      llmPriority: opts?.llmPriority,
      probe: opts?.probe,
      requestedByUserId: opts?.requestedByUserId,
      reason: isVersionStale ? 'version_bump' : 'metadata_correction',
    });
    if (enqueued) {
      regenScheduled++;
      // A wording replacement is now in flight for this language, version
      // bump or correction alike. The audio sweep below must leave the clip
      // alone: `replaceForVersionBump` archives the old wording against the
      // LIVE pointer, so detaching it here would make that lookup return
      // null minutes later and the archive would be skipped, moving every
      // pinned card onto the new wording. The replace invalidates the clip
      // itself (`invalidateAudioIfAudiblyChanged`) once the archive has
      // captured it.
      correctedLanguages.add(lang);
      // Spend one retry. Only the retry path is counted: the first
      // correction is a stale row meeting a new verdict, which must always
      // be free to run. The replace patch keeps the row's id, so the count
      // survives the regeneration it pays for.
      if (retryGenderCorrection) {
        await ctx.db.patch(translation._id, {
          genderCorrectionAttempts:
            (translation.genderCorrectionAttempts ?? 0) + 1,
        });
      }
      // The fresh claim makes `scheduleLanguageContent` defer this pass's
      // TTS for the language, so no audio is synthesized for the wording
      // about to be replaced.
      state.llmClaimMap.set(lang, await getLlmClaim(ctx, textId, lang));
    }
  }
  return {
    sweptRegionVariants,
    regenScheduled,
    correctedLanguages,
    genderHoldLanguages,
  };
}

/**
 * Schedule an STT backfill for an existing audio row that lacks timings, or
 * that was stored 'unchecked' because STT failed at synthesis time, in
 * which case the backfill delivers the verdict too. A no-op unless the row
 * survived the validity sweep, so its payload is in `state.audioPayloadMap`,
 * the language's STT can produce what is missing, and the asset has
 * backfill attempts left (`sttBackfillExhausted`). A clip STT keeps failing
 * on is left alone rather than retried on every view.
 */
async function scheduleTimingsBackfillIfNeeded(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  lang: string,
  state: ContentSweepState,
  opts: ContentSweepOpts | undefined,
): Promise<void> {
  const audio = state.audioMap.get(lang);
  // Payload was resolved (and the row survived) in the validity loop above;
  // shared-asset timings serve every pointing text, so an asset that already
  // has them needs no backfill.
  const payload = state.audioPayloadMap.get(lang);
  if (!audio || !payload) return;
  if (sttBackfillExhausted(payload.asset)) return;
  // Languages whose STT backend yields no word timings (none, or the
  // text-only Gemini fallback) will never get them, so don't waste a claim
  // on a backfill that's guaranteed to no-op. A text-only backend still
  // gives an unchecked clip its verdict.
  const needsTimings =
    !payload.wordTimings && languageSupportsWordTimings(lang);
  const needsVerdict =
    payload.ttsQuality === 'unchecked' && languageSupportsStt(lang);
  if (!needsTimings && !needsVerdict) return;
  if (opts?.probe) {
    // Claim-held = a job (synthesis or backfill) already owns the slot —
    // unless it's a background claim the real (priority-less, hence
    // interactive) claim below would take over, which is a write.
    if (await hasBlockingTtsClaim(ctx, textId, lang, undefined)) return;
    throw new ProbeNeedsWork();
  }
  const claimed = await claimTtsIfAvailable(ctx, textId, lang);
  if (!claimed) return;
  await ctx.scheduler.runAfter(
    0,
    internal.features.ttsProcessing.backfillWordTimings,
    {
      textId,
      language: lang,
      storageId: payload.storageId,
      requestedByUserId: opts?.requestedByUserId,
    },
  );
}

/**
 * The superseded revisions of (text, language) are content in their own
 * right: a pinned card still shows their wording, so their annotations are
 * filled, their timings backfilled and their audio repaired exactly like the
 * live row's. Their WORDING is never regenerated. Runs after the live row's
 * own work so that, under the shared (text, language) TTS claim, live audio
 * wins a contested pass; the next sweep picks up the rest. Same probe
 * semantics as the live-row steps.
 */
async function scheduleSupersededRevisionContent(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  lang: string,
  audioSpeakerGender: string | undefined,
  state: ContentSweepState,
  opts: ContentSweepOpts | undefined,
): Promise<void> {
  for (const revision of state.supersededMap.get(lang) ?? []) {
    if (opts?.probe && annotationsDue(lang, revision)) {
      throw new ProbeNeedsWork();
    }
    await scheduleTranslationAnnotations(ctx, revision, revision._id);
    // A pinned card shows this revision, so its chips need the stamps too.
    collectRenderingStamp(revision, opts?.stamps);
    // A revision that was never voiced is never served (the reader falls
    // through to the live row), so there is no audio to keep alive.
    if (revision.audioAssetId === undefined) continue;
    const asset = await ctx.db.get(revision.audioAssetId);
    const blobExists =
      asset !== null && (await ctx.db.system.get(asset.storageId)) !== null;
    const mismatch = asset === null ? null : audioAssetMismatch(lang, asset);
    const stale =
      mismatch !== null &&
      (mismatch.providerMismatch || mismatch.versionMismatch);
    if (asset === null || !blobExists || stale) {
      if (opts?.probe) {
        if (await hasBlockingTtsClaim(ctx, textId, lang, opts?.priority)) {
          continue;
        }
        throw new ProbeNeedsWork();
      }
      await regenerateSupersededRevisionAudio(ctx, text, revision, {
        audioSpeakerGender,
        // An existing asset (dead blob, stale version or provider) is
        // replaced in place; a lost one may be re-attached from the cache.
        forceRegen: asset !== null,
        priority: opts?.priority,
        requestedByUserId: opts?.requestedByUserId,
      });
      continue;
    }
    if (
      !sttBackfillExhausted(asset) &&
      ((asset.wordTimings === undefined && languageSupportsWordTimings(lang)) ||
        (asset.ttsQuality === 'unchecked' && languageSupportsStt(lang)))
    ) {
      if (opts?.probe) {
        if (await hasBlockingTtsClaim(ctx, textId, lang, undefined)) continue;
        throw new ProbeNeedsWork();
      }
      const claimed = await claimTtsIfAvailable(ctx, textId, lang);
      if (!claimed) continue;
      await ctx.scheduler.runAfter(
        0,
        internal.features.ttsProcessing.backfillWordTimings,
        { textId, language: lang, storageId: asset.storageId },
      );
    }
  }
}

/**
 * Schedule missing annotations (romanization, IPA) for the source text.
 * `missingAnnotationKinds` tests `=== undefined` per kind (not `!x`) so the
 * empty-string sentinel the process actions write after a failed attempt is
 * honored; without that distinction every ensureContent call would burn
 * another attempt against the same failing input.
 */
async function scheduleMissingSourceAnnotations(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  opts: ContentSweepOpts | undefined,
): Promise<void> {
  const kinds = missingAnnotationKinds(text.language, text);
  // A request inside the cooldown is still in flight; see
  // `annotationRequestInFlight`.
  if (kinds.length === 0 || annotationRequestInFlight(text)) return;
  if (opts?.probe) throw new ProbeNeedsWork();
  await ctx.db.patch(textId, { annotationRequestedAt: Date.now() });
  for (const kind of kinds) {
    await ctx.scheduler.runAfter(0, TEXT_ANNOTATIONS[kind].sourceTextAction, {
      textId,
      text: text.text,
      language: text.language,
    });
  }
}

/**
 * Fill one language's remaining gaps after the sweeps: enqueue the missing
 * translation (non-source languages), backfill missing translation
 * annotations, enqueue missing audio (deferred while an LLM retranslation is
 * in flight), or the timings backfill for audio that already exists.
 */
async function scheduleLanguageContent(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  lang: string,
  audioSpeakerGender: string | undefined,
  state: ContentSweepState,
  sweptRegionVariants: Map<string, string>,
  opts: ContentSweepOpts | undefined,
): Promise<{ translationScheduled: boolean; audioScheduled: boolean }> {
  const scheduled = { translationScheduled: false, audioScheduled: false };
  const hasAudio = state.audioMap.get(lang) != null;

  if (lang === text.language) {
    // Source language, no translation needed, maybe TTS
    if (!hasAudio) {
      scheduled.audioScheduled = await scheduleAudioForLanguage(
        ctx,
        text,
        lang,
        audioSpeakerGender,
        null,
        {
          forceRegen: opts?.forceAudioRegen,
          priority: opts?.priority,
          probe: opts?.probe,
          requestedByUserId: opts?.requestedByUserId,
        },
      );
    } else {
      await scheduleTimingsBackfillIfNeeded(ctx, textId, lang, state, opts);
    }
    return scheduled;
  }

  // Different language. Need translation
  const translation = state.translationMap.get(lang);
  if (!translation) {
    // Route to either the LLM queue or the legacy Google path based on
    // the per-language config in lib/languages.ts. Both paths terminate
    // by writing the `translations` row via storeTranslationAndScheduleTTS,
    // so downstream (romanization, TTS) doesn't care which provider ran.
    scheduled.translationScheduled = await scheduleTranslationForLanguage(
      ctx,
      text,
      lang,
      {
        audioSpeakerGender,
        preferredRegionVariant: sweptRegionVariants.get(lang),
        priority: opts?.priority,
        llmPriority: opts?.llmPriority,
        probe: opts?.probe,
        requestedByUserId: opts?.requestedByUserId,
      },
    );
    return scheduled;
  }

  // Translation exists. Backfill missing annotations (romanization,
  // IPA). Same `=== undefined` sentinel semantics as the source-text
  // loop above.
  if (opts?.probe && annotationsDue(lang, translation)) {
    throw new ProbeNeedsWork();
  }
  await scheduleTranslationAnnotations(ctx, translation, undefined);
  collectRenderingStamp(translation, opts?.stamps);
  if (!hasAudio) {
    // Defer TTS while an LLM retranslation is in flight for this
    // (textId, lang). Without this guard, `flagTranslation` (which
    // deletes audio + enqueues an LLM retranslation) races with a
    // concurrent `scheduleMissingContent` that would otherwise see
    // "translation exists, audio missing" and enqueue TTS against
    // the OLD `translation.translatedText`, producing stale audio
    // just before the new translation lands. The LLM worker's
    // `storeTranslationAndScheduleTTS` will enqueue TTS for the new
    // text once the LLM completes. The claim was pre-fetched in
    // the batched load; no per-iteration DB read here.
    const existingLlmClaim = state.llmClaimMap.get(lang) ?? null;
    const llmRetranslationInFlight =
      existingLlmClaim !== null && isClaimFresh(existingLlmClaim);
    if (llmRetranslationInFlight) {
      // Skip. The LLM worker owns the next TTS enqueue for this row.
    } else {
      scheduled.audioScheduled = await scheduleAudioForLanguage(
        ctx,
        text,
        lang,
        audioSpeakerGender,
        translation,
        {
          forceRegen: opts?.forceAudioRegen,
          priority: opts?.priority,
          probe: opts?.probe,
          requestedByUserId: opts?.requestedByUserId,
        },
      );
    }
  } else {
    await scheduleTimingsBackfillIfNeeded(ctx, textId, lang, state, opts);
  }
  await scheduleSupersededRevisionContent(
    ctx,
    textId,
    text,
    lang,
    audioSpeakerGender,
    state,
    opts,
  );
  return scheduled;
}

/**
 * Schedule missing translations and audio for a text: resolve the speaker
 * gender, load the stored content state, sweep invalid audio and stale
 * translations, then fill each required language's gaps (translations,
 * annotations, audio, timings backfills) via the named steps above.
 *
 * Used by both `prepareCardContent` (for new cards) and
 * `ensureCardContent` (for on-demand regeneration).
 */
export async function scheduleMissingContent(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
  opts?: ContentSweepOpts,
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  // Rendering-stamp requests this sweep finds go to the caller's collector
  // when it passes one (a many-text loop flushes once, 25 rows per
  // classifier call), else to this text's own, flushed at the end. A probe
  // only collects: the flush is a write, and the caller's to make.
  const ownStampCollector = opts?.stamps === undefined;
  opts = { ...opts, stamps: opts?.stamps ?? newRenderingStampCollector() };
  const sourceLanguage = text.language;

  // Resolve gender for both the voice (audioSpeakerGender) and the translation
  // prompt's <speaker_gender> tag so they agree (otherwise we hit the
  // user-facing "voice is the opposite gender" bug). The full case logic
  // (definitive vs custom-neutral vs premade-neutral) lives in
  // `resolveCardSpeakerGenders` (lib/voices.ts), seeded by textId for a
  // deterministic, retry-stable coin-flip.
  const { audioSpeakerGender, genderPatch } = resolveCardSpeakerGenders(
    text,
    textId,
  );

  if (Object.keys(genderPatch).length > 0) {
    if (opts?.probe) throw new ProbeNeedsWork();
    await ctx.db.patch(textId, genderPatch);
  }

  // A curriculum text the current classifier has not judged yet gets its
  // metadata now, from the source sentence alone; the verdict lands later
  // and re-runs this sweep (`applyTextMetadata`). Nothing here waits for
  // it: the coin flip keeps serving until then.
  await requestSentenceMetadataIfNeeded(
    ctx,
    text,
    baseLanguages,
    targetLanguages,
    opts,
  );

  // Always include the text's own language (`sourceLanguage`) so the
  // source-language branch of `scheduleLanguageContent` queues audio for it
  // regardless of what the caller passed in `baseLanguages`. Without this, a
  // user whose course uses an English VARIANT (`en_gb` / `en_us` / `en_au`)
  // would never get audio for `en` curriculum + placement-test texts.
  // `allRequiredLanguages` wouldn't contain `'en'`, so the
  // `lang === sourceLanguage` branch never fires. Same shape applies to
  // any other text where the user's variant differs from the text's
  // actual language code (`es` vs `es_latam`, etc.). The Set dedupes
  // when `baseLanguages`/`targetLanguages` already contain the source.
  //
  // A mixed-accent course (`en`) shows a British- or Australian-voiced
  // curriculum text the `en_gb` / `en_au` rewrite instead of the source
  // wording (`getMixedAccentTextLanguage`, read by cardContent.ts), so that
  // row is required content on such a course as well. Never for a
  // user-created text: its wording is the user's.
  const courseLanguages = [...baseLanguages, ...targetLanguages];
  const mixedAccentLanguage =
    !text.userCreated && courseLanguages.includes(sourceLanguage)
      ? getMixedAccentTextLanguage(sourceLanguage, textId)
      : undefined;
  const allRequiredLanguages = [
    ...new Set([
      sourceLanguage,
      ...courseLanguages,
      ...(mixedAccentLanguage ? [mixedAccentLanguage] : []),
    ]),
  ];

  // Languages that need translation (all except source). `sourceLanguage`
  // is in `allRequiredLanguages` by construction above; filtering it out
  // here ensures we don't enqueue a self-translation for it.
  const langsNeedingTranslation = allRequiredLanguages.filter(
    (l) => l !== sourceLanguage,
  );

  const state = await loadContentState(
    ctx,
    textId,
    allRequiredLanguages,
    langsNeedingTranslation,
  );

  // Translations first, audio second. The wording sweep decides whether a
  // `metadata_correction` is coming, and the audio sweep needs that answer
  // before it detaches a clip the incoming replace still has to archive.
  // `sweepStaleTranslations` reads only `translationMap` and `llmClaimMap`,
  // so it does not care that the audio sweep has not run yet.
  const {
    sweptRegionVariants,
    regenScheduled,
    correctedLanguages,
    genderHoldLanguages,
  } = await sweepStaleTranslations(
    ctx,
    textId,
    text,
    audioSpeakerGender,
    state,
    opts,
  );

  await sweepInvalidAudio(
    ctx,
    textId,
    text,
    audioSpeakerGender,
    state,
    opts,
    correctedLanguages,
    genderHoldLanguages,
  );

  await scheduleMissingSourceAnnotations(ctx, textId, text, opts);

  let translationsScheduled = regenScheduled;
  let audioScheduled = 0;
  for (const lang of allRequiredLanguages) {
    const scheduled = await scheduleLanguageContent(
      ctx,
      textId,
      text,
      lang,
      audioSpeakerGender,
      state,
      sweptRegionVariants,
      opts,
    );
    if (scheduled.translationScheduled) translationsScheduled++;
    if (scheduled.audioScheduled) audioScheduled++;
  }

  if (ownStampCollector && !opts.probe) {
    await flushRenderingStamps(ctx, opts.stamps!, opts.requestedByUserId);
  }

  return { translationsScheduled, audioScheduled };
}

// ────────────────────────────────────────────────────────────────────────────
// Sentence metadata for curriculum texts (lib/sentenceMetadataSource.ts)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Classifier calls one many-text pass may make. Five per pass keeps a
 * collection warm or an upcoming-cards sweep from turning into a call per
 * text; the rest are picked up by the next pass.
 */
export const MAX_METADATA_CALLS_PER_PASS = 5;

/** How long a metadata request is honoured before a sweep asks again. */
const METADATA_REQUEST_COOLDOWN_MS = 15 * 60 * 1000;

export type MetadataCallBudget = { remaining: number };

export function newMetadataCallBudget(): MetadataCallBudget {
  return { remaining: MAX_METADATA_CALLS_PER_PASS };
}

/**
 * Does this text need the sentence-metadata classifier? Only a curriculum
 * text (a user-written one is classified at creation and never again), only
 * when its stored metadata is not the current classifier's verdict, and not
 * while a recent request is in flight.
 */
export function needsSentenceMetadata(
  text: Pick<
    Doc<'texts'>,
    'userCreated' | 'metadataSource' | 'metadataRequestedAt'
  >,
): boolean {
  if (text.userCreated) return false;
  if (hasCurrentSentenceMetadata(text)) return false;
  if (
    text.metadataRequestedAt !== undefined &&
    Date.now() - text.metadataRequestedAt < METADATA_REQUEST_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

/**
 * Claim the text and schedule the classifier on its SOURCE sentence alone.
 * The custom-card path sends every rendering, because a gendered form in
 * any translation fixes the sentence's gender; on a curriculum text the
 * translations were generated from the coin flip and are the very thing
 * under suspicion, so they get no vote. The verdict lands through
 * `applyTextMetadata`, which stamps `metadataSource` and re-runs the sweep.
 * Returns whether a call was scheduled; in probe mode throws ProbeNeedsWork
 * iff it would.
 */
export async function requestSentenceMetadataIfNeeded(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
  opts: ContentSweepOpts | undefined,
): Promise<boolean> {
  if (!needsSentenceMetadata(text)) return false;
  const budget = opts?.metadataCalls;
  if (budget) {
    if (budget.remaining <= 0) return false;
    budget.remaining--;
  }
  if (opts?.probe) throw new ProbeNeedsWork();
  await ctx.db.patch(text._id, { metadataRequestedAt: Date.now() });
  await ctx.scheduler.runAfter(
    0,
    internal.features.sentenceMetadata.fetchSentenceMetadata,
    {
      textId: text._id,
      translations: [{ language: text.language, text: text.text }],
      schedulePrepareCard: true,
      baseLanguages,
      targetLanguages,
      userId: opts?.requestedByUserId,
      priority: opts?.priority,
      llmPriority: opts?.llmPriority,
    },
  );
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Rendering stamps (docs/architecture/translation-variants.md)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Translation rows a sweep found without their rendering stamps, grouped by
 * the language the classifier prompt is built for. Rows from before the
 * sentence-form settings are stamped this way, lazily, by the sweep of
 * whichever learner meets them first, instead of by a one-off backfill over
 * the whole table.
 */
export type RenderingStampCollector = Map<string, Id<'translations'>[]>;

export function newRenderingStampCollector(): RenderingStampCollector {
  return new Map();
}

/**
 * How many classifier calls one row may cost before the sweep gives up on
 * it. Three, matching the shape of the other variant-side caps: the model
 * either reports a form for a wording or it never will, and each retry is a
 * fresh call.
 */
const MAX_RENDERING_STAMP_ATTEMPTS = 3;

/**
 * How long a stamp request is honoured before a sweep asks again. Covers
 * the classifier's latency many times over, so the repeated sweeps of one
 * card (probe, dispatch, the next review) do not double the call, and
 * still retries a row the classifier answered badly (left unstamped).
 */
const STAMP_REQUEST_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Does this row need a classifier call? Only canonical rows of a language
 * that marks an axis (a variant is stamped by its own store path), only
 * when a stamp is missing, and not while a recent request is in flight.
 */
export function needsRenderingStamp(row: Doc<'translations'>): boolean {
  if (row.variantKey !== undefined) return false;
  if (
    row.renderedGender !== undefined &&
    row.renderedPoliteness !== undefined
  ) {
    return false;
  }
  // A row the classifier keeps leaving blank stops being asked. The request
  // claim below is only a cooldown, so without this the same unusable row
  // was re-bought every 15 minutes for good.
  if ((row.renderingStampAttempts ?? 0) >= MAX_RENDERING_STAMP_ATTEMPTS) {
    return false;
  }
  if (
    row.renderingStampRequestedAt !== undefined &&
    Date.now() - row.renderingStampRequestedAt < STAMP_REQUEST_COOLDOWN_MS
  ) {
    return false;
  }
  const axes = renderingAxesFor(classificationLanguageForRow(row));
  return axes.gender || axes.politeness;
}

/**
 * Add one row to a collector when it still needs a classifier call, keyed by
 * the classifier's prompt language. Exported for the preview-translation
 * sweep (convex/features/collections.ts), which walks the same rows outside
 * this file's sweep and must stamp them the same way.
 */
export function collectRenderingStamp(
  row: Doc<'translations'>,
  stamps: RenderingStampCollector | undefined,
): void {
  if (!stamps || !needsRenderingStamp(row)) return;
  const language = classificationLanguageForRow(row);
  const list = stamps.get(language) ?? [];
  if (list.includes(row._id)) return;
  list.push(row._id);
  stamps.set(language, list);
}

/**
 * Schedule one classifier call per language per MAX_ROWS_PER_CALL rows of
 * the collector, claiming each row with `renderingStampRequestedAt` in the
 * same transaction so a sweep that runs before the call lands finds the
 * claim. Empties the collector; returns the rows scheduled.
 */
export async function flushRenderingStamps(
  ctx: MutationCtx,
  stamps: RenderingStampCollector,
  requestedByUserId?: string,
): Promise<number> {
  const now = Date.now();
  let scheduled = 0;
  for (const ids of stamps.values()) {
    for (let i = 0; i < ids.length; i += MAX_ROWS_PER_CALL) {
      const chunk = ids.slice(i, i + MAX_ROWS_PER_CALL);
      for (const id of chunk) {
        const row = await ctx.db.get(id);
        await ctx.db.patch(id, {
          renderingStampRequestedAt: now,
          renderingStampAttempts: (row?.renderingStampAttempts ?? 0) + 1,
        });
      }
      await ctx.scheduler.runAfter(
        0,
        internal.features.renderingClassification.classifyAndStampTranslations,
        { translationIds: chunk, skipStamped: true, userId: requestedByUserId },
      );
      scheduled += chunk.length;
    }
  }
  stamps.clear();
  return scheduled;
}

/**
 * The canonical row cannot be judged against the request yet: an axis the
 * text key asks for is unstamped on a language that marks it. The canonical
 * sweep that runs before the rendering sweep has asked for the stamp; the
 * next pass decides between "canonical already is this form" and a rewrite.
 * Asking for the rewrite now would often come back identical (billed, then
 * stored as `sameAsCanonical`).
 */
function renderingStampPending(
  canonical: Doc<'translations'>,
  rendering: LanguageRendering,
): boolean {
  if (rendering.textVariantKey === null) return false;
  // A row the classifier has given up on (`needsRenderingStamp`'s attempt
  // cap) is not pending: nothing will ever stamp it. The sweep then buys the
  // rewrite, the right fallback once three answers came back unusable.
  // Without this the stamp was "pending" for good, the card sat on
  // "updating", and every session re-ran the ensure pass for nothing.
  if (
    (canonical.renderingStampAttempts ?? 0) >= MAX_RENDERING_STAMP_ATTEMPTS
  ) {
    return false;
  }
  const { gender, formId } = parseVariantKey(rendering.textVariantKey);
  const axes = renderingAxesFor(classificationLanguageForRow(canonical));
  return (
    (gender !== AUTO &&
      axes.gender &&
      canonical.renderedGender === undefined) ||
    (formId !== AUTO &&
      axes.politeness &&
      canonical.renderedPoliteness === undefined)
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Rendering variants (docs/architecture/translation-variants.md)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fill the rendering VARIANTS a course's sentence-form settings resolve to
 * for one text: per language, the variant translation row (a rewrite of
 * the canonical wording, so it waits for the canonical row to land), its
 * annotations, and the audio in the card's voice. The text's own language
 * is voiced too: its wording never varies, but the card hears every
 * language in one voice, so the source clip (or the accent row's, on a
 * Mixed English card) gets an audio-only variant like an unmarked target.
 * Separate from `scheduleMissingContent`, which stays the canonical sweep
 * for every caller: this returns after zero reads when the settings
 * resolve to canonical on every language, which is every course from
 * before the feature.
 *
 * Probe semantics match the canonical sweep (`opts.probe` throws
 * ProbeNeedsWork iff a write would happen), so the probe-then-dispatch
 * ensure paths keep their zero-write steady state. Never writes `texts` or
 * a canonical row; never deletes a rendering. A rewrite whose attempts
 * were exhausted holds its claim with `variantFailedAt` for a day
 * (`hasBlockingLlmClaim`), so a sentence the model refuses is not bought
 * again on every view.
 */
export async function scheduleMissingRenderings(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
  settings: RenderingSettings | undefined,
  opts?: ContentSweepOpts,
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  const scheduled = { translationsScheduled: 0, audioScheduled: 0 };
  const card = opts?.card ?? null;
  if (!settings && !hasRenderingOverride(card)) return scheduled;
  // The card's own view when the caller has one (the review path, the
  // upcoming-cards loop), so a per-card correction renders; a correction
  // needs no course settings, hence the empty stand-in. Otherwise the
  // card-less view: a card created now would get exactly this, and the
  // ensure paths only run for texts the learner has (or is about to have)
  // a curriculum card for. A user-written text resolves to canonical.
  const view: SourceView | null = card
    ? { settings: settings ?? {}, card, accentLanguage: card.accentLanguage }
    : previewView(settings);
  const renderingText = renderingTextOf(text);
  const courseLanguages = [...new Set([...baseLanguages, ...targetLanguages])];
  for (const lang of courseLanguages) {
    if (lang === text.language) {
      const rendering = sourceRenderingForView(view, renderingText, textId);
      if (rendering.audioVariantKey === null || opts?.skipTts) continue;
      // The row the card plays for its own language: the accent row once it
      // has landed, else the source text (`servedSourceText` has the same
      // fallback).
      const accent = servedAccentRow(text, view);
      const accentRow =
        accent !== undefined
          ? await liveTranslation(ctx, textId, accent)
          : null;
      const spoken =
        accent !== undefined && accentRow
          ? {
              language: accent,
              text: accentRow.translatedText,
              regionVariant: accentRow.regionVariant,
            }
          : { language: lang, text: text.text, regionVariant: undefined };
      if (await ensureVariantAudio(ctx, textId, spoken, rendering, opts)) {
        scheduled.audioScheduled++;
      }
      continue;
    }
    // A first pass on the language's default dialect decides whether the
    // language renders at all (no read when it does not); the row's own
    // dialect (`regionVariant`) then decides the form, since a mixed code's
    // sub-variants map the levels differently.
    const probeRendering = renderingForView(view, renderingText, textId, lang);
    if (
      probeRendering.textVariantKey === null &&
      probeRendering.audioVariantKey === null
    ) {
      continue;
    }
    const canonical = await liveTranslation(ctx, textId, lang);
    // The pin outranks the variant, so a card reading an archived revision
    // is served that wording and never a rewrite
    // (`resolveServedRendering`). Buying one for it would be paid for and
    // thrown away, so the sweep asks the same question the reader does.
    if (
      canonical &&
      (await resolveServedFromLive(ctx, canonical, view?.pinAt)).archived
    ) {
      continue;
    }
    // The variant is a rewrite of the canonical wording: nothing to do
    // until the canonical sweep has landed it (and audio-only variants
    // need it as the text to speak).
    if (!canonical) continue;
    // NO provenance gate here on purpose. `mayRegenerateTranslation` answers
    // "may an automated pass overwrite or delete this row?", and creating a
    // rendering variant does neither: the canonical row is read as the thing
    // to rewrite and is never written. Gating on it meant every
    // `curated-manual` row (the Essential greetings, in all 60 languages)
    // ignored the course's politeness setting and the Flag dialog's
    // correction for good, while `textVariantMissing` kept reporting the card
    // as missing content. A user-created text never reaches this line anyway:
    // `resolveLanguageRendering` returns the canonical rendering for one, so
    // both keys are null and the loop has already continued above.
    const rendering = renderingForView(
      view,
      renderingText,
      textId,
      lang,
      canonical.regionVariant,
    );

    let variant: Doc<'translations'> | null = null;
    if (rendering.textVariantKey !== null) {
      variant = await liveTranslation(
        ctx,
        textId,
        lang,
        rendering.textVariantKey,
      );
      if (!variant) {
        // The canonical row already IS the requested rendering (stamped by
        // the classifier): serve it, ask for nothing.
        if (canonicalSatisfies(canonical, rendering)) {
          variant = canonical;
        } else if (renderingStampPending(canonical, rendering)) {
          // Ask for the stamp this branch is waiting on. `renderingStampPending`
          // assumes "the canonical sweep that runs before the rendering sweep
          // has asked for the stamp", which holds for the paired callers
          // (`prepareCardContent`, the upcoming-cards probe) and NOT for a
          // caller that runs this sweep alone: `requestLibraryRenderings` and
          // the collection preview build a collector, flush it, and would
          // never put a row in it, so a legacy unstamped row waited for a
          // stamp nobody ever requested and sat on the "updating" chip for
          // good. Same collector, so a paired caller still gets one
          // classifier call per language rather than two.
          collectRenderingStamp(canonical, opts?.stamps);
          continue;
        } else if (
          await hasBlockingLlmClaim(
            ctx,
            textId,
            lang,
            opts?.llmPriority,
            rendering.textVariantKey,
          )
        ) {
          continue;
        } else {
          if (opts?.probe) throw new ProbeNeedsWork();
          const claimId = await claimLlmTranslationIfAvailable(
            ctx,
            textId,
            lang,
            opts?.llmPriority,
            rendering.textVariantKey,
          );
          if (!claimId) continue;
          const form = rendering.form;
          await ctx.runMutation(
            internal.features.llmTranslationQueue.enqueueLlmTranslation,
            {
              args: {
                textId,
                sourceLanguage: text.language,
                targetLanguage: lang,
                text: text.text,
                audioSpeakerGender: rendering.voiceGender,
                preferredRegionVariant: canonical.regionVariant,
                skipTts: opts?.skipTts,
                priority: opts?.priority,
                llmPriority: opts?.llmPriority,
                requestedByUserId: opts?.requestedByUserId,
                variantKey: rendering.textVariantKey,
                // Withheld on a browse surface. `skipTts` stops synthesis
                // HERE, but the key rides the job to the store, where the
                // card-exists escape hatch drops `skipTts` and promotes the
                // clip to the interactive pool. That hatch reads "a card
                // exists on this text", which for a canonical row means
                // "this clip is needed" and for a preference-keyed variant
                // does not: the card it finds may be another learner's, on
                // other settings. One "Show more" could claim a synthesis
                // per row. The ensure pass voices the variant through
                // `ensureVariantAudio` once the text is actually a card.
                audioVariantKey: opts?.skipTts
                  ? undefined
                  : (rendering.audioVariantKey ?? undefined),
                requestedGender:
                  parseVariantKey(rendering.textVariantKey).gender === AUTO
                    ? undefined
                    : rendering.voiceGender,
                requestedForm: form
                  ? {
                      id: form.id,
                      label: form.promptLabel,
                      prompt: form.prompt,
                    }
                  : undefined,
                rewriteOf: canonical.translatedText,
              },
            },
          );
          scheduled.translationsScheduled++;
          continue;
        }
      } else if (!variant.sameAsCanonical) {
        // A served variant is content like any other row: its wording
        // gets the annotations of its language, by its own id (the store
        // would otherwise find the canonical row and refuse the wording).
        if (opts?.probe && annotationsDue(lang, variant)) {
          throw new ProbeNeedsWork();
        }
        await scheduleTranslationAnnotations(ctx, variant, variant._id);
      }
    }

    // Audio in the card's voice for the served wording: the variant's own
    // when it differs, else the canonical wording.
    if (rendering.audioVariantKey === null || opts?.skipTts) continue;
    const spokenRow = variant && !variant.sameAsCanonical ? variant : canonical;
    if (
      await ensureVariantAudio(
        ctx,
        textId,
        {
          language: lang,
          text: spokenRow.translatedText,
          regionVariant: spokenRow.regionVariant,
        },
        rendering,
        opts,
      )
    ) {
      scheduled.audioScheduled++;
    }
  }
  return scheduled;
}

/**
 * Word timings (and a pending STT verdict) for a VARIANT clip. The canonical
 * equivalent is `scheduleTimingsBackfillIfNeeded`, which reads the sweep
 * state's canonical pointers and so never sees a variant.
 */
async function backfillVariantTimingsIfNeeded(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  lang: string,
  audioVariantKey: string,
  payload: ResolvedAudioPayload,
  opts: ContentSweepOpts | undefined,
): Promise<void> {
  if (sttBackfillExhausted(payload.asset)) return;
  const needsTimings =
    !payload.wordTimings && languageSupportsWordTimings(lang);
  const needsVerdict =
    payload.ttsQuality === 'unchecked' && languageSupportsStt(lang);
  if (!needsTimings && !needsVerdict) return;
  if (opts?.probe) {
    if (
      await hasBlockingTtsClaim(ctx, textId, lang, undefined, audioVariantKey)
    ) {
      return;
    }
    throw new ProbeNeedsWork();
  }
  const claimed = await claimTtsIfAvailable(
    ctx,
    textId,
    lang,
    undefined,
    audioVariantKey,
  );
  if (!claimed) return;
  await ctx.scheduler.runAfter(
    0,
    internal.features.ttsProcessing.backfillWordTimings,
    {
      textId,
      language: lang,
      storageId: payload.storageId,
      requestedByUserId: opts?.requestedByUserId,
      variantKey: audioVariantKey,
    },
  );
}

/**
 * The audio half of one language's rendering: the clip of `spoken` under
 * `rendering.audioVariantKey`. Detaches a pointer the current TTS setup no
 * longer accepts, attaches a cached asset, or claims and enqueues the
 * synthesis. Returns true iff a pointer was attached or a job enqueued;
 * throws ProbeNeedsWork in probe mode where it would write.
 */
export async function ensureVariantAudio(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  spoken: { language: string; text: string; regionVariant: string | undefined },
  rendering: LanguageRendering,
  opts: ContentSweepOpts | undefined,
): Promise<boolean> {
  const audioVariantKey = rendering.audioVariantKey;
  if (audioVariantKey === null) return false;
  const lang = spoken.language;
  const pointer = await audioPointer(ctx, textId, lang, audioVariantKey);
  if (pointer) {
    // The same validity checks the canonical sweep runs
    // (`sweepInvalidAudio`), so a provider switch, a `ttsVersion` bump or
    // a lost blob reaches variant clips too: detach the pointer and fall
    // through to a fresh synthesis. The asset stays (retention rule in
    // convex/lib/audioAssets.ts); a dead one is dropped with the pointer.
    const payload = await resolveAudioPayload(ctx, pointer);
    const blobGone =
      payload === null || (await ctx.db.system.get(payload.storageId)) === null;
    const { providerMismatch, versionMismatch } = payload
      ? audioAssetMismatch(lang, payload)
      : { providerMismatch: false, versionMismatch: false };
    // A pointer speaking a different sentence is not this variant's clip.
    // `retireVariantRenderings` deletes an in-flight synthesis's CLAIM but
    // cannot stop the job, which lands and attaches the old wording's asset
    // under this key. When the new canonical wording already satisfies the
    // form no variant row is ever requested, so the store-side wording
    // check (`scheduleTtsForLandedTranslation`) never runs, and without
    // this the card showed one sentence and played another for good. The
    // asset stays: it is still correct audio for its own string.
    const wordingMismatch =
      payload !== null && payload.asset.spokenText !== spoken.text;
    if (!blobGone && !providerMismatch && !versionMismatch && !wordingMismatch) {
      // The clip is good. It may still be missing its word timings or its
      // STT verdict, and the canonical backfill
      // (`scheduleTimingsBackfillIfNeeded`) only walks `state.audioMap`,
      // which holds canonical pointers, so a rewritten sentence never got
      // karaoke. Same claim key as the synthesis, so the two cannot race.
      if (payload) {
        await backfillVariantTimingsIfNeeded(
          ctx,
          textId,
          lang,
          audioVariantKey,
          payload,
          opts,
        );
      }
      return false;
    }
    // A job in flight for this variant re-points the row when it lands.
    if (await hasActiveTtsClaim(ctx, textId, lang, audioVariantKey)) {
      return false;
    }
    if (opts?.probe) throw new ProbeNeedsWork();
    await deleteAudioRow(
      ctx,
      pointer,
      blobGone ? { blobAlreadyGone: true } : { keepAsset: true },
    );
  }
  // Defer while the variant's own translation job is in flight: it
  // enqueues the audio for the wording it lands.
  if (
    rendering.textVariantKey !== null &&
    (await hasBlockingLlmClaim(
      ctx,
      textId,
      lang,
      opts?.llmPriority,
      rendering.textVariantKey,
    ))
  ) {
    return false;
  }
  if (
    await hasBlockingTtsClaim(
      ctx,
      textId,
      lang,
      opts?.priority,
      audioVariantKey,
    )
  ) {
    return false;
  }
  if (opts?.probe) throw new ProbeNeedsWork();
  const voiceName = getVoiceForText(
    lang,
    textId,
    spoken.regionVariant,
    rendering.voiceGender,
  );
  // The regenerate-audio button bypasses the asset cache like the
  // canonical path does (a hit would hand back the clip being replaced).
  const asset = opts?.forceAudioRegen
    ? null
    : await findReusableAudioAssetForVoice(ctx, {
        language: lang,
        voiceName,
        regionVariant: spoken.regionVariant,
        spokenText: spoken.text,
      });
  if (asset) {
    await upsertAudioPointer(ctx, textId, lang, asset._id, audioVariantKey);
    return true;
  }
  const claimed = await claimTtsIfAvailable(
    ctx,
    textId,
    lang,
    opts?.priority,
    audioVariantKey,
  );
  if (!claimed) return false;
  await enqueueTtsForVoice(ctx, {
    textId,
    text: spoken.text,
    language: lang,
    voiceName,
    regionVariant: spoken.regionVariant,
    forceRegen: opts?.forceAudioRegen,
    priority: opts?.priority,
    requestedByUserId: opts?.requestedByUserId,
    variantKey: audioVariantKey,
  });
  return true;
}
