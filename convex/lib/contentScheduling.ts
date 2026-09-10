import { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import {
  getMixedAccentTextLanguage,
  getVoiceForText,
  getVoiceGenderByApiCode,
  resolveCardSpeakerGenders,
  getTtsProviderForLanguage,
  isMixedLanguage,
  isTtsVersionStale,
  isTranslationVersionStale,
  languageSupportsStt,
  languageSupportsWordTimings,
  pickAccentForText,
  usesSourceTextVerbatim,
} from '../../lib/languages';
import {
  GOOGLE_TRANSLATE_SOURCE,
  mayRegenerateTranslation,
  SOURCE_VERBATIM_TRANSLATION_SOURCE,
} from '../../lib/translationProvenance';
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
  servedAccentRow,
  sourceRenderingForView,
  viewAcceptsLegacyRow,
  dialectForRendering,
  type SourceView,
  type SweepCard,
  primaryKeyForLanguage,
} from '../db/translationReads';
import {
  NO_FORM,
  parseRenderingKey,
  type LanguageRendering,
  type RenderingSettings,
} from '../../lib/preferenceResolution';
import { classificationLanguageForRow } from './renderingClassifier';
import { languageMarksFirstPerson } from '../../lib/languageForms';

/**
 * Content-scheduling helpers: the "make this text's content complete" sweep
 * (`ensureTextContent`), which every card surface, warm loop and browse
 * surface runs, plus the claim + enqueue slices it is built from (rendering
 * jobs on the LLM queue, TTS with `audioAssets` cache reuse). Lifted out of
 * features/decks.ts so features/collections.ts can share it without
 * importing decks. The registered functions that expose these helpers
 * (prepareCardContent, ensureCardContent, …) stay in features/decks.ts.
 *
 * The model (docs/architecture/rendering-keys.md): a card resolves to one
 * RENDERING KEY per language (lib/preferenceResolution.ts), every row
 * written since the cutover carries its key, and the sweep's job per
 * language is "does the row at this key exist, and is it complete". A row
 * with no key is a legacy row from before; a view that accepts legacy rows
 * (a user-written text, an uncorrected card from before the feature) is
 * maintained on those and never asks for a keyed row where it has one.
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

// ────────────────────────────────────────────────────────────────────────────
// Rendering jobs
// ────────────────────────────────────────────────────────────────────────────

/** Options a rendering job is enqueued with. */
export type RenderingJobOpts = {
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
   * absent on every ordinary fill of a missing key.
   */
  replaceExisting?: boolean;
  /** Why the translation is requested; see translationReasonValidator. */
  translationReason?: TranslationReason;
  /**
   * Adoption: verify the legacy row's wording against the key and store a
   * copy of it when it passes, generating afresh only when it does not.
   */
  adoptLegacy?: boolean;
};

/**
 * Claim + enqueue ONE rendering job for (text, language) producing the given
 * keys: the primary key first when it is in the list (a fresh translation),
 * then every other key as a versioning of the primary wording. Every key is
 * claimed here, in the mutation, so nothing inside the job ever waits for
 * another job; keys already held by a fresh claim are dropped from the list.
 * An accent-only sibling of the text's own language with no rewrite of its
 * own (an `en` sentence on an `en_us` course) is stored verbatim under each
 * key without any LLM. Returns true iff a job was enqueued (or a verbatim
 * row written); in probe mode throws ProbeNeedsWork iff it would.
 */
export async function enqueueRenderingJob(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  targetLanguage: string,
  keys: string[],
  opts: RenderingJobOpts,
): Promise<boolean> {
  if (keys.length === 0) return false;
  if (usesSourceTextVerbatim(targetLanguage, text.language)) {
    if (opts.probe) throw new ProbeNeedsWork();
    for (const key of keys) {
      await storeTranslationAndScheduleTTSHandler(
        ctx,
        verbatimTranslationArgs(text, targetLanguage, key, opts),
      );
    }
    return true;
  }
  if (opts.probe) {
    // A fresh LLM claim means a job already owns this key: the real call
    // would no-op, so it is not "work needed". Priority-aware on purpose:
    // a fresh 'background' claim probed at interactive priority IS needy,
    // because the real run would take it over (cancel the warm job,
    // re-enqueue on llmPool), which is a write.
    for (const key of keys) {
      if (
        !(await hasBlockingLlmClaim(
          ctx,
          text._id,
          targetLanguage,
          opts.llmPriority,
          key,
        ))
      ) {
        throw new ProbeNeedsWork();
      }
    }
    return false;
  }
  const claimed: string[] = [];
  for (const key of keys) {
    const claimId = await claimLlmTranslationIfAvailable(
      ctx,
      text._id,
      targetLanguage,
      opts.llmPriority,
      key,
    );
    if (claimId) claimed.push(key);
  }
  if (claimed.length === 0) return false;
  await ctx.runMutation(
    internal.features.llmTranslationQueue.enqueueLlmTranslation,
    {
      args: {
        textId: text._id,
        sourceLanguage: text.language,
        targetLanguage,
        text: text.text,
        renderingKeys: claimed,
        preferredRegionVariant: opts.preferredRegionVariant,
        skipTts: opts.skipTts,
        priority: opts.priority,
        llmPriority: opts.llmPriority,
        requestedByUserId: opts.requestedByUserId,
        replaceExisting: opts.replaceExisting,
        translationReason: opts.translationReason,
        adoptLegacy: opts.adoptLegacy,
      },
    },
  );
  return true;
}

/**
 * Regenerate a stale KEYED row IN PLACE. The row keeps serving its current
 * wording and audio until the new wording lands; the write choke point
 * (`storeTranslationAndScheduleTTS`, reason `'version_bump'`) then
 * restamps an identical result, or archives the old wording for the cards
 * that reference the text before replacing it (see `supersededAt` in
 * schema.ts). Nothing is deleted up front, so a learner never sees a gap and
 * never sees their card's wording change. Two triggers share it: a language
 * `translationVersion` bump, and derivation staleness (a versioned row
 * whose primary wording moved on). Legacy rows are never regenerated: a
 * card still on one keeps it, and a new card gets a keyed row instead.
 * Returns true iff a job was enqueued; in probe mode throws ProbeNeedsWork
 * iff it would.
 */
export async function enqueueVersionBumpRegen(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  translation: Doc<'translations'>,
  opts: {
    skipTts?: boolean;
    priority?: TtsPriority;
    llmPriority?: LlmPriority;
    probe?: boolean;
    requestedByUserId?: string;
  },
): Promise<boolean> {
  if (translation.variantKey === undefined) return false;
  return enqueueRenderingJob(
    ctx,
    text,
    translation.targetLanguage,
    [translation.variantKey],
    {
      ...opts,
      // The row survives, so its dialect pin is still on it; forwarding it
      // keeps a swept-then-refilled race on the same variant either way.
      preferredRegionVariant: translation.regionVariant,
      replaceExisting: true,
      translationReason: 'version_bump',
    },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Audio
// ────────────────────────────────────────────────────────────────────────────

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
    /** The rendering key the clip belongs to; see ttsJobArgsValidator. */
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
 * Fill audio for (text, language) under one pointer key, the slice shared
 * by `ensureTextContent`, `storeTranslationAndScheduleTTS`'s siblings, and
 * the preview audio-icon click (`requestPreviewAudio`). For the text's own
 * language the source text is synthesized; for any other language the
 * caller must pass the stored translation row (synthesis text + dialect
 * pin). `variantKey` undefined is the legacy pointer.
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
  voiceGender: string | undefined,
  translation: Doc<'translations'> | null,
  opts?: {
    forceRegen?: boolean;
    priority?: TtsPriority;
    /** Read-only probe: throw ProbeNeedsWork instead of writing. */
    probe?: boolean;
    /** Requester attribution for the synthesis cost event. */
    requestedByUserId?: string;
    /** The pointer key; undefined = the legacy pointer. */
    variantKey?: string;
  },
): Promise<boolean> {
  const isSource = language === text.language;
  if (!isSource && !translation) return false;
  const variantKey = opts?.variantKey;
  if (opts?.probe) {
    // A fresh TTS claim the real run would respect means a job is already
    // filling this slot — not needy. Priority-aware on purpose: a fresh
    // 'background' claim probed at interactive priority IS needy, because
    // the real run would take it over (cancel the warm job, re-enqueue on
    // the interactive pool) — a write. Anything else (cache attach or
    // claim + enqueue) would write too.
    if (
      await hasBlockingTtsClaim(
        ctx,
        text._id,
        language,
        opts?.priority,
        variantKey,
      )
    ) {
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
    voiceGender,
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
      await upsertAudioPointer(ctx, text._id, language, asset._id, variantKey);
      return true;
    }
  }

  const claimed = await claimTtsIfAvailable(
    ctx,
    text._id,
    language,
    opts?.priority,
    variantKey,
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
    variantKey,
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

// ────────────────────────────────────────────────────────────────────────────
// The sweep
// ────────────────────────────────────────────────────────────────────────────

/** Options threaded through the whole `ensureTextContent` sweep. */
export type ContentSweepOpts = {
  /**
   * Translation-only pass (collection previews, the library page): rows
   * get their wording but no audio. See `skipTts` on the LLM job args.
   */
  skipTts?: boolean;
  /**
   * The card the sweep runs for, when the caller has one, so a per-card
   * correction (`cards.renderingGenderOverride` /
   * `renderingPolitenessOverride`) renders and the source clip voiced is
   * the one the card plays (its accent row). Absent or null = the rendering
   * a card created now would get.
   */
  card?: SweepCard | null;
  /** The course's politeness setting; absent = each sentence's primary form. */
  settings?: RenderingSettings;
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
 * The sweep's view of one language of the text: the rendering the view
 * resolves to, the rows that exist for it, and which of them the view is
 * served. Built once by `loadContentState` and mutated in place by the
 * invalidation sweeps (a detached pointer becomes `null` so the fill loop
 * refills the slot).
 */
type LanguageSlot = {
  lang: string;
  /** The key, voice and form this view reads for `lang`. */
  rendering: LanguageRendering;
  /** The primary key of (text, lang) on the row's dialect. */
  primaryKey: string;
  /** The live LEGACY row (no key), when one exists. */
  legacy: Doc<'translations'> | null;
  /** The live row at `rendering.key`, when one exists. */
  keyed: Doc<'translations'> | null;
  /**
   * The row this view is served and maintains: the keyed row, or the legacy
   * row for a view that accepts legacy rows. Null when the view is waiting
   * for its keyed row (a placeholder legacy row is not this view's to
   * maintain).
   */
  served: Doc<'translations'> | null;
  servedKeyed: boolean;
  /** The superseded revisions of the served row's key range, oldest first. */
  superseded: Doc<'translations'>[];
  /** The pointer key the served rendering plays under; undefined = legacy. */
  audioKey: string | undefined;
  audio: Doc<'audioRecordings'> | null;
  /** The LLM claim at `rendering.key`. */
  llmClaim: Doc<'llmTranslationClaims'> | null;
};

/** The key of the LLM claim that would replace the row a slot reads. */
function slotClaimKey(slot: LanguageSlot): string | undefined {
  return slot.served !== null && !slot.servedKeyed
    ? undefined
    : slot.rendering.key;
}

type ContentSweepState = {
  slots: Map<string, LanguageSlot>;
  /** Resolved payloads for the pointers that SURVIVED the validity sweep. */
  audioPayloadMap: Map<string, ResolvedAudioPayload>;
  acceptsLegacy: boolean;
};

/**
 * Batch load the rows, pointers and claims of every required language: the
 * legacy rows first (they carry the dialect pin the key depends on), then
 * the keyed rows, the pointers and the claims in one parallel round each.
 */
async function loadContentState(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  view: SourceView,
  allRequiredLanguages: string[],
): Promise<ContentSweepState> {
  const acceptsLegacy = viewAcceptsLegacyRow(view, text);
  const renderingText = renderingTextOf(text);
  const targets = allRequiredLanguages.filter((l) => l !== text.language);
  const legacyRevisions = await Promise.all(
    targets.map((lang) => translationRevisions(ctx, textId, lang)),
  );
  const legacySplit = legacyRevisions.map(splitRevisions);
  const renderings = targets.map((lang, i) =>
    renderingForView(
      view,
      renderingText,
      textId,
      lang,
      dialectForRendering(lang, textId, legacySplit[i].live),
    ),
  );
  const primaryKeys = targets.map((lang, i) =>
    primaryKeyForLanguage(
      text,
      lang,
      dialectForRendering(lang, textId, legacySplit[i].live),
    ),
  );
  // A view on its legacy row never reads the keyed range; every other view
  // reads it, and the legacy row is only its placeholder.
  const keyedRevisions = await Promise.all(
    targets.map((lang, i) =>
      acceptsLegacy && legacySplit[i].live
        ? Promise.resolve([] as Doc<'translations'>[])
        : translationRevisions(ctx, textId, lang, renderings[i].key),
    ),
  );
  const keyedSplit = keyedRevisions.map(splitRevisions);

  const slots = new Map<string, LanguageSlot>();
  const sourceRendering = sourceRenderingForView(view, renderingText, textId);
  slots.set(text.language, {
    lang: text.language,
    rendering: sourceRendering,
    primaryKey: sourceRendering.key,
    legacy: null,
    keyed: null,
    served: null,
    servedKeyed: false,
    superseded: [],
    // A view on legacy rows plays the legacy source clip; every other view
    // plays the clip keyed by its voice.
    audioKey: acceptsLegacy ? undefined : sourceRendering.key,
    audio: null,
    llmClaim: null,
  });
  targets.forEach((lang, i) => {
    const legacy = legacySplit[i].live;
    const keyed = keyedSplit[i].live;
    const served = acceptsLegacy ? (legacy ?? keyed) : keyed;
    const servedKeyed = served !== null && served === keyed;
    slots.set(lang, {
      lang,
      rendering: renderings[i],
      primaryKey: primaryKeys[i],
      legacy,
      keyed,
      served,
      servedKeyed,
      superseded: servedKeyed
        ? keyedSplit[i].superseded
        : served
          ? legacySplit[i].superseded
          : [],
      // The pointer this view maintains: a legacy view's legacy pointer
      // while it reads a legacy row, else the key's. A view waiting for
      // its keyed row leaves the legacy clip to the legacy cards.
      audioKey:
        acceptsLegacy && !servedKeyed ? undefined : renderings[i].key,
      audio: null,
      llmClaim: null,
    });
  });

  const slotList = [...slots.values()];
  const [pointers, claims] = await Promise.all([
    Promise.all(
      slotList.map((slot) =>
        audioPointer(ctx, textId, slot.lang, slot.audioKey),
      ),
    ),
    Promise.all(
      slotList.map((slot) =>
        slot.lang === text.language
          ? Promise.resolve(null)
          : // The claim of the row this view reads: a flag on a legacy row
            // claims the legacy slot (`replacesLegacyRow`), everything
            // else the key.
            getLlmClaim(ctx, textId, slot.lang, slotClaimKey(slot)),
      ),
    ),
  ]);
  slotList.forEach((slot, i) => {
    slot.audio = pointers[i];
    slot.llmClaim = claims[i];
  });
  return { slots, audioPayloadMap: new Map(), acceptsLegacy };
}

/**
 * Validate audio pointers. Detach stale ones (missing blob, a voice the
 * pointer's key does not name, superseded provider, bumped ttsVersion,
 * accent drift). All checks read the row's RESOLVED payload (the shared
 * `audioAssets` row). Detaching a pointer leaves a still-shared asset
 * untouched; the re-synthesis a stale asset triggers patches that asset in
 * place, healing every other text sharing the string at once.
 * Do not delete while TTS is in flight: `processTTSForCard` may have
 * attached a row whose URL is not yet resolvable, or concurrent cleanup
 * would remove the row while later validation updates expect it to exist
 * (silent no-op).
 *
 * Mutates the slots (detached pointers become null) and fills
 * `state.audioPayloadMap` for the surviving rows.
 */
async function sweepInvalidAudio(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  textVoice: 'male' | 'female',
  state: ContentSweepState,
  opts: ContentSweepOpts | undefined,
  // Languages whose wording is being replaced in this same pass. Their clip
  // is left exactly as it is, whatever mismatch it has: the incoming
  // replace archives it against the LIVE pointer and then invalidates it
  // itself. See the note where `correctedLanguages` is filled.
  correctedLanguages: ReadonlySet<string>,
): Promise<void> {
  for (const slot of state.slots.values()) {
    const { lang, audio } = slot;
    if (!audio) continue;
    const payload = await resolveAudioPayload(ctx, audio);
    if (!payload) {
      // Dangling pointer (asset gone), no usable audio behind this row.
      // Remove it so the enqueue loop below refills the language.
      if (await hasActiveTtsClaim(ctx, textId, lang, slot.audioKey)) continue;
      if (opts?.probe) throw new ProbeNeedsWork();
      await deleteAudioRow(ctx, audio, { blobAlreadyGone: true });
      slot.audio = null;
      continue;
    }
    // `db.system.get` (metadata point-read), not `storage.getUrl`: presence
    // is the signal, and the metadata read is far cheaper than minting a
    // signed URL — this loop runs per (card × language) on the ensure path.
    const blobExists = (await ctx.db.system.get(payload.storageId)) !== null;
    if (!blobExists) {
      if (await hasActiveTtsClaim(ctx, textId, lang, slot.audioKey)) {
        continue;
      }
      if (opts?.probe) throw new ProbeNeedsWork();
      // The blob is gone, nothing left to reference-protect; row (and, for
      // a last-pointer row, its dead asset) bookkeeping still runs.
      await deleteAudioRow(ctx, audio, { blobAlreadyGone: true });
      slot.audio = null;
      continue;
    }
    // A wording replacement is coming for this language. Detaching the
    // clip for ANY reason here, voice, provider, version or accent, makes
    // `replaceForVersionBump` find no live pointer when the new wording
    // lands, skip the archive, and move every pinned card onto the new
    // wording. The replace invalidates the clip itself once the archive has
    // captured it; a byte-identical restamp leaves the mismatch to the next
    // sweep, which no longer sees the language as corrected.
    if (correctedLanguages.has(lang)) continue;
    // A keyed pointer speaks the voice its key names, so any other voice is
    // wrong for it. A legacy pointer speaks the text's own voice; it is
    // re-voiced only when that voice is the sentence's own (a user-written
    // text, or a verdict that fixes the speaker), never over a coin flip.
    const wantedVoice =
      slot.audioKey !== undefined
        ? parseRenderingKey(slot.audioKey).voice
        : text.userCreated || definitiveSpeakerGender(text) !== null
          ? textVoice
          : undefined;
    const genderMismatch =
      wantedVoice !== undefined && payload.voiceGender !== wantedVoice;
    // A keyed pointer whose asset speaks another sentence is not this
    // rendering's clip (a late synthesis after the wording moved on).
    const wordingMismatch =
      slot.audioKey !== undefined &&
      slot.lang !== text.language &&
      slot.served !== null &&
      payload.asset.spokenText !== slot.served.translatedText;
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
      wordingMismatch ||
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
      slot.audio = null;
    } else {
      state.audioPayloadMap.set(lang, payload);
    }
  }
}

/**
 * Regenerate served KEYED rows that are stale, in place, through the
 * version-bump path. Two triggers:
 *
 *  1. Version-stale: the language's `translationVersion` config was bumped
 *     above the row's stamp (a new model or prompt).
 *  2. Derivation-stale: a row the versioning prompt produced whose
 *     `versionedFromText` no longer equals the primary row's wording (a
 *     flag, a curriculum fix or a bump moved the primary on).
 *
 * Legacy rows are never regenerated (a card still on one keeps it; a new
 * card gets a keyed row). Content we may not touch is skipped
 * (`mayRegenerateTranslation`). Skipped too while TTS is in flight or an
 * LLM job already owns the key. Returns the languages whose replacement is
 * now in flight, so the audio sweep leaves their clip for the archive.
 */
async function sweepStaleTranslations(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  state: ContentSweepState,
  opts: ContentSweepOpts | undefined,
): Promise<{ regenScheduled: number; correctedLanguages: Set<string> }> {
  const correctedLanguages = new Set<string>();
  let regenScheduled = 0;
  for (const slot of state.slots.values()) {
    const { lang, served } = slot;
    if (!served || !slot.servedKeyed) continue;
    if (!mayRegenerateTranslation(text, served)) continue;
    const isVersionStale = isTranslationVersionStale(
      lang,
      served.translationVersion,
    );
    let derivationStale = false;
    if (served.versionedFromText !== undefined) {
      const primary =
        served.variantKey === slot.primaryKey
          ? served
          : await liveTranslation(ctx, textId, lang, slot.primaryKey);
      derivationStale =
        primary !== null && primary.translatedText !== served.versionedFromText;
    }
    if (!isVersionStale && !derivationStale) continue;
    if (await hasActiveTtsClaim(ctx, textId, lang, slot.audioKey)) continue;
    // Defer while a job for this key is in flight. It will overwrite the
    // row anyway, so a second one would race the pending write.
    if (slot.llmClaim && isClaimFresh(slot.llmClaim)) continue;

    const enqueued = await enqueueVersionBumpRegen(ctx, text, served, {
      skipTts: opts?.skipTts,
      priority: opts?.priority,
      llmPriority: opts?.llmPriority,
      probe: opts?.probe,
      requestedByUserId: opts?.requestedByUserId,
    });
    if (enqueued) {
      regenScheduled++;
      correctedLanguages.add(lang);
      // The fresh claim makes `scheduleLanguageContent` defer this pass's
      // TTS for the language, so no audio is synthesized for the wording
      // about to be replaced.
      slot.llmClaim = await getLlmClaim(ctx, textId, lang, served.variantKey);
    }
  }
  return { regenScheduled, correctedLanguages };
}

/**
 * Schedule an STT backfill for an existing audio pointer that lacks
 * timings, or that was stored 'unchecked' because STT failed at synthesis
 * time, in which case the backfill delivers the verdict too. A no-op unless
 * the pointer survived the validity sweep, so its payload is in
 * `state.audioPayloadMap`, the language's STT can produce what is missing,
 * and the asset has backfill attempts left (`sttBackfillExhausted`). A clip
 * STT keeps failing on is left alone rather than retried on every view.
 */
async function scheduleTimingsBackfillIfNeeded(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  slot: LanguageSlot,
  state: ContentSweepState,
  opts: ContentSweepOpts | undefined,
): Promise<void> {
  const { lang, audio } = slot;
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
    if (
      await hasBlockingTtsClaim(ctx, textId, lang, undefined, slot.audioKey)
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
    slot.audioKey,
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
      variantKey: slot.audioKey,
    },
  );
}

/**
 * The superseded revisions of the served row are content in their own
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
  slot: LanguageSlot,
  textVoice: string,
  opts: ContentSweepOpts | undefined,
): Promise<void> {
  const lang = slot.lang;
  for (const revision of slot.superseded) {
    if (opts?.probe && annotationsDue(lang, revision)) {
      throw new ProbeNeedsWork();
    }
    await scheduleTranslationAnnotations(ctx, revision, revision._id);
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
        audioSpeakerGender: textVoice,
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

/** Copy of `value` with every `undefined` property dropped, for inserts. */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

/**
 * Whether a legacy row may stand in for a key without a model call: the
 * wording cannot carry either axis (an unmarked language, or a form-free
 * key on a language that does not mark the first person), so there is
 * nothing to verify.
 */
function legacyNeedsVerification(
  legacy: Pick<Doc<'translations'>, 'targetLanguage' | 'regionVariant'>,
  key: string,
): boolean {
  const concrete = classificationLanguageForRow(legacy);
  return (
    languageMarksFirstPerson(concrete) ||
    parseRenderingKey(key).formId !== NO_FORM
  );
}

/**
 * Whether a legacy row may stand in for the PRIMARY key at all: not
 * version-stale (a bump means the wording is to be redone, and a new card
 * must not inherit it; a human wording the pipeline never regenerates,
 * `mayRegenerateTranslation`, has no version to be stale against), and,
 * when the wording could carry an axis, written by a model that was told
 * the voice (never machine translation, never a verbatim copy).
 */
function legacyAdoptable(
  text: Doc<'texts'>,
  legacy: Doc<'translations'>,
  key: string,
): boolean {
  if (
    mayRegenerateTranslation(text, legacy) &&
    isTranslationVersionStale(legacy.targetLanguage, legacy.translationVersion)
  ) {
    return false;
  }
  if (!legacyNeedsVerification(legacy, key)) return true;
  return (
    legacy.translationSource !== GOOGLE_TRANSLATE_SOURCE &&
    legacy.translationSource !== SOURCE_VERBATIM_TRANSLATION_SOURCE
  );
}

/**
 * Copy a legacy row under a key: the same wording, annotations, provenance
 * and version stamp, so a version-stale legacy wording is never frozen
 * under a key and the copy's annotations need no regeneration. The audio
 * ensure finds the same asset by string, voice and setup, so no clip is
 * synthesized for it.
 */
async function copyLegacyRowUnderKey(
  ctx: MutationCtx,
  legacy: Doc<'translations'>,
  key: string,
  voice: 'male' | 'female',
): Promise<Doc<'translations'>> {
  const id = await ctx.db.insert(
    'translations',
    defined({
      textId: legacy.textId,
      targetLanguage: legacy.targetLanguage,
      translatedText: legacy.translatedText,
      romanizedText: legacy.romanizedText,
      romanizationSource: legacy.romanizationSource,
      ipaText: legacy.ipaText,
      ipaSource: legacy.ipaSource,
      furiganaText: legacy.furiganaText,
      furiganaSource: legacy.furiganaSource,
      translationSource: legacy.translationSource,
      regionVariant: legacy.regionVariant,
      translationVersion: legacy.translationVersion,
      speakerGender: voice,
      variantKey: key,
    }),
  );
  return (await ctx.db.get(id))!;
}

/**
 * Make the row at the slot's key exist: adopt the legacy row when it may
 * stand in for the primary key (a copy with no call when the wording
 * cannot carry an axis, a verifying job otherwise), else claim and enqueue
 * one job for the key, together with the primary key when the primary row
 * is missing (a versioned key is derived from it). Returns true iff a job
 * was enqueued (a copy is complete on return); throws ProbeNeedsWork in
 * probe mode where it would write.
 */
async function ensureRenderingRow(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  textId: Id<'texts'>,
  slot: LanguageSlot,
  gate: MetadataGate,
  opts: ContentSweepOpts | undefined,
): Promise<boolean> {
  const { lang, legacy, primaryKey } = slot;
  const key = slot.rendering.key;
  // Every branch below writes a row or a claim under a key: none of it
  // before the metadata the key is computed from is in.
  if (!(await gate.ready())) return false;
  const jobOpts: RenderingJobOpts = {
    preferredRegionVariant: legacy?.regionVariant,
    skipTts: opts?.skipTts,
    priority: opts?.priority,
    llmPriority: opts?.llmPriority,
    probe: opts?.probe,
    requestedByUserId: opts?.requestedByUserId,
  };
  if (legacy && key === primaryKey && legacyAdoptable(text, legacy, key)) {
    if (!legacyNeedsVerification(legacy, key)) {
      if (opts?.probe) throw new ProbeNeedsWork();
      const copied = await copyLegacyRowUnderKey(
        ctx,
        legacy,
        key,
        slot.rendering.voiceGender,
      );
      // The copy is this view's row from now on: the caller goes on to
      // its annotations and audio in this same pass. Nothing is in flight
      // for it, so it is not counted as scheduled work.
      slot.keyed = copied;
      slot.served = copied;
      slot.servedKeyed = true;
      slot.superseded = [];
      slot.audioKey = key;
      slot.audio = null;
      return false;
    }
    return enqueueRenderingJob(ctx, text, lang, [key], {
      ...jobOpts,
      adoptLegacy: true,
    });
  }
  // A versioned key is derived from the primary row. When that row is
  // missing and the legacy row can stand in for it with no call, copy it
  // first, so the job versions from it instead of translating the primary
  // afresh; otherwise the job renders both.
  let primaryExists =
    key === primaryKey ||
    (await liveTranslation(ctx, textId, lang, primaryKey)) !== null;
  if (
    !primaryExists &&
    legacy &&
    legacyAdoptable(text, legacy, primaryKey) &&
    !legacyNeedsVerification(legacy, primaryKey)
  ) {
    if (opts?.probe) throw new ProbeNeedsWork();
    await copyLegacyRowUnderKey(
      ctx,
      legacy,
      primaryKey,
      parseRenderingKey(primaryKey).voice,
    );
    primaryExists = true;
  }
  // The primary rendered with the key is offered the legacy wording for
  // adoption like a primary-only job would be.
  return enqueueRenderingJob(
    ctx,
    text,
    lang,
    primaryExists ? [key] : [primaryKey, key],
    {
      ...jobOpts,
      adoptLegacy:
        !primaryExists &&
        legacy !== null &&
        legacyAdoptable(text, legacy, primaryKey),
    },
  );
}

function audioOptsOf(slot: LanguageSlot, opts: ContentSweepOpts | undefined) {
  return {
    forceRegen: opts?.forceAudioRegen,
    priority: opts?.priority,
    probe: opts?.probe,
    requestedByUserId: opts?.requestedByUserId,
    variantKey: slot.audioKey,
  };
}

/**
 * Fill one language's remaining gaps after the sweeps: the missing row at
 * the key (non-source languages), missing annotations, missing audio
 * (deferred while a job for the key is in flight), or the timings backfill
 * for audio that already exists.
 */
async function scheduleLanguageContent(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  slot: LanguageSlot,
  textVoice: 'male' | 'female',
  state: ContentSweepState,
  gate: MetadataGate,
  opts: ContentSweepOpts | undefined,
): Promise<{ translationScheduled: boolean; audioScheduled: boolean }> {
  const scheduled = { translationScheduled: false, audioScheduled: false };
  const { lang } = slot;

  if (lang === text.language) {
    // Source language, no translation needed, maybe TTS in the view's voice.
    if (opts?.skipTts) return scheduled;
    if (slot.audio == null) {
      // A keyed source clip is voiced by its key; not before the metadata
      // that fixes the voice is in. The legacy clip speaks the text's
      // voice as it stands.
      if (slot.audioKey !== undefined && !(await gate.ready())) {
        return scheduled;
      }
      scheduled.audioScheduled = await scheduleAudioForLanguage(
        ctx,
        text,
        lang,
        slot.rendering.voiceGender,
        null,
        audioOptsOf(slot, opts),
      );
    } else {
      await scheduleTimingsBackfillIfNeeded(ctx, textId, slot, state, opts);
    }
    return scheduled;
  }

  if (!slot.served) {
    scheduled.translationScheduled = await ensureRenderingRow(
      ctx,
      text,
      textId,
      slot,
      gate,
      opts,
    );
    // A legacy row copied under the key is served from here on; anything
    // else (a job, a wait) leaves the language to a later pass.
    if (!slot.served) return scheduled;
  }
  const translation = slot.served;
  const hasAudio = slot.audio != null;

  // The row exists. Backfill missing annotations (romanization, IPA,
  // furigana), by the row's own id so a keyed row's wording is the one
  // annotated. Same `=== undefined` sentinel semantics as the source loop.
  if (opts?.probe && annotationsDue(lang, translation)) {
    throw new ProbeNeedsWork();
  }
  await scheduleTranslationAnnotations(
    ctx,
    translation,
    slot.servedKeyed ? translation._id : undefined,
  );
  if (opts?.skipTts) return scheduled;
  if (!hasAudio) {
    // Defer TTS while a job for this key is in flight: it will overwrite
    // the row anyway, and `storeTranslationAndScheduleTTS` enqueues the
    // audio for the wording it lands. Without this guard a flag's
    // retranslation raced a concurrent sweep into synthesizing the OLD
    // wording just before the new one landed.
    const jobInFlight =
      slot.llmClaim !== null && isClaimFresh(slot.llmClaim);
    if (!jobInFlight) {
      scheduled.audioScheduled = await scheduleAudioForLanguage(
        ctx,
        text,
        lang,
        slot.servedKeyed ? slot.rendering.voiceGender : textVoice,
        translation,
        audioOptsOf(slot, opts),
      );
    }
  } else {
    await scheduleTimingsBackfillIfNeeded(ctx, textId, slot, state, opts);
  }
  await scheduleSupersededRevisionContent(
    ctx,
    textId,
    text,
    slot,
    textVoice,
    opts,
  );
  return scheduled;
}

/**
 * Make a text's content complete for one view: decide the voice, make
 * sure the source metadata is in (curriculum texts), resolve the rendering
 * key per language, then fill each language's gaps (the row at the key,
 * annotations, audio, timings) and repair what went stale. One entry point
 * for every caller: the card surfaces pass their card and the course
 * settings, the warm and browse surfaces pass the settings alone, and the
 * guard "which rendering does this view read" is applied once, inside.
 *
 * Returns how many translation and audio jobs were scheduled; a text whose
 * metadata was just requested reports one translation and returns early.
 */
export async function ensureTextContent(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
  opts?: ContentSweepOpts,
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  const sourceLanguage = text.language;

  // The voice, decided once and kept: the sentence's own when it fixes it,
  // else one seeded flip written into `audioSpeakerGender` (lib/voices.ts).
  const { audioSpeakerGender: textVoice, genderPatch } =
    resolveCardSpeakerGenders(text, textId);
  if (Object.keys(genderPatch).length > 0) {
    if (opts?.probe) throw new ProbeNeedsWork();
    await ctx.db.patch(textId, genderPatch);
    text = { ...text, ...genderPatch };
  }

  // The metadata precondition: a curriculum text is classified from its
  // source sentence BEFORE its first keyed row or clip, so no key is ever
  // computed from a voice or a register a verdict can later overturn. The
  // gate is asked only where a keyed write is due: legacy rows and clips
  // are repaired without it. The verdict re-runs this sweep
  // (`applyTextMetadata`). A text the classifier keeps failing on renders
  // from defaults after `MAX_METADATA_ATTEMPTS`.
  const gate = metadataGate(ctx, text, baseLanguages, targetLanguages, opts);

  const view: SourceView = opts?.card
    ? {
        settings: opts.settings,
        card: opts.card,
        accentLanguage: opts.card.accentLanguage,
      }
    : previewView(opts?.settings);

  // Always include the text's own language (`sourceLanguage`) so the
  // source-language branch of `scheduleLanguageContent` queues audio for it
  // regardless of what the caller passed in `baseLanguages`. Without this, a
  // user whose course uses an English VARIANT (`en_gb` / `en_us` / `en_au`)
  // would never get audio for `en` curriculum + placement-test texts.
  //
  // A mixed-accent course (`en`) shows a British- or Australian-voiced
  // curriculum text the `en_gb` / `en_au` rewrite instead of the source
  // wording (`servedAccentRow`), so that row is required content on such a
  // course as well. Never for a user-created text: its wording is the
  // user's.
  const courseLanguages = [...baseLanguages, ...targetLanguages];
  const accent =
    !text.userCreated && courseLanguages.includes(sourceLanguage)
      ? (servedAccentRow(text, view) ??
        getMixedAccentTextLanguage(sourceLanguage, textId))
      : undefined;
  const allRequiredLanguages = [
    ...new Set([
      sourceLanguage,
      ...courseLanguages,
      ...(accent ? [accent] : []),
    ]),
  ];

  const state = await loadContentState(
    ctx,
    textId,
    text,
    view,
    allRequiredLanguages,
  );

  // Translations first, audio second. The wording sweep decides whether a
  // replacement is coming, and the audio sweep needs that answer before it
  // detaches a clip the incoming replace still has to archive.
  const { regenScheduled, correctedLanguages } = await sweepStaleTranslations(
    ctx,
    textId,
    text,
    state,
    opts,
  );
  await sweepInvalidAudio(
    ctx,
    textId,
    text,
    textVoice,
    state,
    opts,
    correctedLanguages,
  );
  await scheduleMissingSourceAnnotations(ctx, textId, text, opts);

  let translationsScheduled = regenScheduled;
  let audioScheduled = 0;
  for (const lang of allRequiredLanguages) {
    const slot = state.slots.get(lang);
    if (!slot) continue;
    const scheduled = await scheduleLanguageContent(
      ctx,
      textId,
      text,
      slot,
      textVoice,
      state,
      gate,
      opts,
    );
    if (scheduled.translationScheduled) translationsScheduled++;
    if (scheduled.audioScheduled) audioScheduled++;
  }
  // A classifier call scheduled by the gate is work on the way too.
  if (gate.requested) translationsScheduled++;
  return { translationsScheduled, audioScheduled };
}

/**
 * The audio half of one rendering outside the sweep: the clip of `spoken`
 * under `key`, for the preview's audio-icon click. Attaches a cached asset
 * or claims and enqueues the synthesis. Returns true iff a pointer was
 * attached or a job enqueued.
 */
export async function ensureRenderingAudio(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  spoken: { language: string; text: string; regionVariant: string | undefined },
  rendering: LanguageRendering,
  opts: { priority?: TtsPriority; requestedByUserId?: string },
): Promise<boolean> {
  const lang = spoken.language;
  const key = rendering.key;
  const pointer = await audioPointer(ctx, textId, lang, key);
  if (pointer) {
    const payload = await resolveAudioPayload(ctx, pointer);
    const blobGone =
      payload === null || (await ctx.db.system.get(payload.storageId)) === null;
    if (!blobGone && payload.asset.spokenText === spoken.text) return false;
    if (await hasActiveTtsClaim(ctx, textId, lang, key)) return false;
    await deleteAudioRow(
      ctx,
      pointer,
      blobGone ? { blobAlreadyGone: true } : { keepAsset: true },
    );
  }
  if (await hasBlockingTtsClaim(ctx, textId, lang, opts.priority, key)) {
    return false;
  }
  const voiceName = getVoiceForText(
    lang,
    textId,
    spoken.regionVariant,
    rendering.voiceGender,
  );
  const asset = await findReusableAudioAssetForVoice(ctx, {
    language: lang,
    voiceName,
    regionVariant: spoken.regionVariant,
    spokenText: spoken.text,
  });
  if (asset) {
    await upsertAudioPointer(ctx, textId, lang, asset._id, key);
    return true;
  }
  const claimed = await claimTtsIfAvailable(
    ctx,
    textId,
    lang,
    opts.priority,
    key,
  );
  if (!claimed) return false;
  await enqueueTtsForVoice(ctx, {
    textId,
    text: spoken.text,
    language: lang,
    voiceName,
    regionVariant: spoken.regionVariant,
    priority: opts.priority,
    requestedByUserId: opts.requestedByUserId,
    variantKey: key,
  });
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Sentence metadata for curriculum texts (lib/sentenceMetadataSource.ts)
// ────────────────────────────────────────────────────────────────────────────

/**
 * How many classifier calls one curriculum text may cost before the sweep
 * stops waiting for a verdict and renders from defaults (neutral register,
 * the seeded voice, the legacy addressee fallback).
 */
export const MAX_METADATA_ATTEMPTS = 3;

/** How long a metadata request is honoured before a sweep asks again. */
const METADATA_REQUEST_COOLDOWN_MS = 15 * 60 * 1000;

export type MetadataState = 'current' | 'exhausted' | 'in_flight' | 'needed';

/**
 * Where a text stands with the sentence-metadata classifier. A user-written
 * text is classified at creation and never again (`current`). A curriculum
 * text is `current` at the current classifier source, `exhausted` after
 * `MAX_METADATA_ATTEMPTS`, `in_flight` while a request is inside its
 * cooldown, else `needed`.
 */
export function metadataState(
  text: Pick<
    Doc<'texts'>,
    'userCreated' | 'metadataSource' | 'metadataRequestedAt' | 'metadataAttempts'
  >,
): MetadataState {
  if (text.userCreated) return 'current';
  if (hasCurrentSentenceMetadata(text)) return 'current';
  // A request inside its cooldown is in flight whatever the count: the
  // last permitted call may still land, and a keyed row written meanwhile
  // would be stranded by its verdict.
  if (
    text.metadataRequestedAt !== undefined &&
    Date.now() - text.metadataRequestedAt < METADATA_REQUEST_COOLDOWN_MS
  ) {
    return 'in_flight';
  }
  if ((text.metadataAttempts ?? 0) >= MAX_METADATA_ATTEMPTS) return 'exhausted';
  return 'needed';
}

/**
 * The metadata precondition as one sweep sees it: `ready()` is true when a
 * keyed write may go ahead (the text is classified, or the classifier has
 * given up on it), else false, after scheduling the classifier the first
 * time it is asked. Asked lazily so a pass that writes nothing keyed never
 * pays a call.
 */
export type MetadataGate = {
  ready(): Promise<boolean>;
  /** Whether this sweep scheduled the classifier. */
  readonly requested: boolean;
};

export function metadataGate(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
  opts: Parameters<typeof requestSentenceMetadataIfNeeded>[4],
): MetadataGate {
  let state = metadataState(text);
  let requested = false;
  return {
    get requested() {
      return requested;
    },
    async ready() {
      if (state === 'current' || state === 'exhausted') return true;
      if (state === 'needed') {
        const result = await requestSentenceMetadataIfNeeded(
          ctx,
          text,
          baseLanguages,
          targetLanguages,
          opts,
        );
        requested = result === 'requested';
        state = 'in_flight';
      }
      return false;
    },
  };
}

/**
 * Claim the text and schedule the classifier on its SOURCE sentence alone
 * when it still needs one. The custom-card path sends every rendering,
 * because a gendered form in any translation fixes the sentence's gender;
 * on a curriculum text the translations were generated for whatever voice
 * was known at the time, so they get no vote. The verdict lands through
 * `applyTextMetadata`, which stamps `metadataSource` and re-runs the sweep.
 * Returns the text's state after this call (`requested` when a call was
 * scheduled); in probe mode throws ProbeNeedsWork iff it would schedule.
 */
export async function requestSentenceMetadataIfNeeded(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
  opts: Pick<
    ContentSweepOpts,
    'probe' | 'requestedByUserId' | 'priority' | 'llmPriority'
  > | undefined,
): Promise<MetadataState | 'requested'> {
  const state = metadataState(text);
  if (state !== 'needed') return state;
  if (opts?.probe) throw new ProbeNeedsWork();
  await ctx.db.patch(text._id, {
    metadataRequestedAt: Date.now(),
    metadataAttempts: (text.metadataAttempts ?? 0) + 1,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.features.sentenceMetadata.classifyCurriculumText,
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
  return 'requested';
}
