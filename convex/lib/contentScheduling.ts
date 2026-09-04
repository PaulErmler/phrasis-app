import { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import {
  getVoiceForLanguage,
  getVoiceForLanguageVariant,
  getVoiceGenderByApiCode,
  resolveCardSpeakerGenders,
  getTtsProviderForLanguage,
  getTranslationConfigForLanguage,
  isTtsVersionStale,
  isTranslationVersionStale,
  languageSupportsStt,
} from '../../lib/languages';
import { mayRegenerateTranslation } from '../../lib/translationProvenance';
import { shouldOverwriteProvider } from '../../lib/ttsPrecedence';
import { missingAnnotationKinds, TEXT_ANNOTATIONS } from './textAnnotations';
import { deleteAudioRow } from './audio';
import {
  findReusableAudioAsset,
  resolveAudioPayload,
  upsertAudioPointer,
} from './audioAssets';
import { llmPool, llmWarmPool } from './workpools';
import type { TtsPriority, LlmPriority, TranslationReason } from '../types';
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
import { splitRevisions, translationRevisions } from '../db/translationReads';

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
 * that reference the text before replacing it (see `translationArchive` in
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
  },
): Promise<boolean> {
  return scheduleTranslationForLanguage(ctx, text, translation.targetLanguage, {
    ...opts,
    // The row survives, so its dialect pin is still on it; forwarding it
    // keeps the Google path and a swept-then-refilled race on the same
    // variant either way.
    preferredRegionVariant: translation.regionVariant,
    replaceExisting: true,
    translationReason: 'version_bump',
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
  // validation roundtrip uses the matching STT locale.
  const regionVariant = isSource ? undefined : translation!.regionVariant;
  const voiceName = regionVariant
    ? getVoiceForLanguageVariant(language, regionVariant, audioSpeakerGender)
    : getVoiceForLanguage(language, audioSpeakerGender);
  const spokenText = isSource ? text.text : translation!.translatedText;

  if (!opts?.forceRegen) {
    const voiceGender = getVoiceGenderByApiCode(voiceName);
    if (voiceGender !== undefined) {
      const asset = await findReusableAudioAsset(ctx, {
        language,
        voiceGender,
        regionVariant,
        spokenText,
      });
      if (asset) {
        await upsertAudioPointer(ctx, text._id, language, asset._id);
        return true;
      }
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

/** Options threaded through the whole `scheduleMissingContent` sweep. */
type ContentSweepOpts = {
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
      allRequiredLanguages.map((lang) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', lang),
          )
          .first(),
      ),
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
 * `state.audioPayloadMap` for the surviving rows. Returns the languages
 * whose audio was found to have drifted gender, so the translation sweep
 * can also invalidate the legacy translation row (the one without a stamped
 * `speakerGender`) that was generated alongside the now-stale audio.
 */
async function sweepInvalidAudio(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  audioSpeakerGender: string | undefined,
  state: ContentSweepState,
  opts: ContentSweepOpts | undefined,
): Promise<Set<string>> {
  const langsWithAudioGenderDrift = new Set<string>();
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
      const genderMismatch =
        (audioSpeakerGender === 'male' || audioSpeakerGender === 'female') &&
        payload.voiceGender !== audioSpeakerGender;
      // Assets carried over from pre-provider-field audio are legacy Google.
      const existingProvider = payload.ttsProvider ?? 'google';
      const currentProvider = getTtsProviderForLanguage(lang);
      // Provider regen is now gated by lib/ttsPrecedence.ts, only the
      // (current, existing) matchups listed there force a delete + re-synth
      // (e.g. google now overwrites azure, to migrate the Arabic dialects
      // off Azure). Unlisted pairs keep the existing audio.
      const providerMismatch = shouldOverwriteProvider(
        currentProvider,
        existingProvider,
      );
      // Version-stale audio: the language's `ttsVersion` config was bumped
      // above what this audio was stamped with (a new voice pool / Gemini prompt
      // / provider). Regenerate. `isTtsVersionStale` encodes the "undefined ===
      // current" rule so un-backfilled rows never storm.
      const versionMismatch = isTtsVersionStale(lang, payload.ttsVersion);
      if (genderMismatch) {
        langsWithAudioGenderDrift.add(lang);
      }
      if (genderMismatch || providerMismatch || versionMismatch) {
        if (opts?.probe) throw new ProbeNeedsWork();
        // Reference-aware delete: a shared asset (or an `editCard`-copied
        // legacy blob) survives while anything else still points at it.
        // Gender drift additionally keeps the asset+blob even as the last
        // pointer: that audio is still CORRECT for this string+voice. It
        // stays in the content-addressed cache so flipping the gender back
        // (or any other text with the same sentence) reuses it for free.
        // Provider/ttsVersion migrations are true obsolescence (a new TTS
        // system) and keep the full garbage collection.
        await deleteAudioRow(ctx, audio, {
          keepAsset: genderMismatch && !providerMismatch && !versionMismatch,
        });
        state.audioMap.set(lang, null);
      } else {
        state.audioPayloadMap.set(lang, payload);
      }
    }
  }
  return langsWithAudioGenderDrift;
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
async function sweepStaleTranslations(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  audioSpeakerGender: string | undefined,
  state: ContentSweepState,
  langsWithAudioGenderDrift: Set<string>,
  opts: ContentSweepOpts | undefined,
): Promise<{
  sweptRegionVariants: Map<string, string>;
  regenScheduled: number;
}> {
  const sweptRegionVariants = new Map<string, string>();
  let regenScheduled = 0;
  for (const [lang, translation] of state.translationMap) {
    if (!translation) continue;
    // The one provenance gate for all three triggers below. Covers
    // user-created (custom/chat) cards and human-authored rows alike. Every
    // regeneration site shares this predicate so none of them can drift out of
    // agreement with the others.
    if (!mayRegenerateTranslation(text, translation)) continue;

    const isLegacy = translation.speakerGender === undefined;
    const isDrifted =
      !isLegacy && translation.speakerGender !== audioSpeakerGender;
    const isLegacyAlongsideDriftedAudio =
      isLegacy && langsWithAudioGenderDrift.has(lang);
    // Version-stale translation: the language's `translationVersion` config was
    // bumped above this row's stamp (a new model/prompt). Regenerate.
    // `isTranslationVersionStale` encodes the "undefined === current" rule.
    const isVersionStale = isTranslationVersionStale(
      lang,
      translation.translationVersion,
    );

    if (!isDrifted && !isLegacyAlongsideDriftedAudio && !isVersionStale)
      continue;
    if (await hasActiveTtsClaim(ctx, textId, lang)) continue;
    // Defer while an LLM retranslation is in flight. It will overwrite the row
    // anyway, so deleting now just races the pending write.
    const llmClaim = state.llmClaimMap.get(lang) ?? null;
    if (llmClaim && isClaimFresh(llmClaim)) continue;

    if (!isDrifted && !isLegacyAlongsideDriftedAudio) {
      // Pure version staleness: keep the row and its audio serving, and
      // regenerate in place. The helper throws ProbeNeedsWork in probe mode
      // iff it would enqueue, matching the fill path's probe semantics.
      const enqueued = await enqueueVersionBumpRegen(ctx, text, translation, {
        audioSpeakerGender,
        priority: opts?.priority,
        llmPriority: opts?.llmPriority,
        probe: opts?.probe,
        requestedByUserId: opts?.requestedByUserId,
      });
      if (enqueued) {
        regenScheduled++;
        // The fresh claim makes `scheduleLanguageContent` defer this pass's
        // TTS for the language, so no audio is synthesized for the wording
        // about to be replaced.
        state.llmClaimMap.set(lang, await getLlmClaim(ctx, textId, lang));
      }
      continue;
    }

    if (opts?.probe) throw new ProbeNeedsWork();
    if (translation.regionVariant) {
      sweptRegionVariants.set(lang, translation.regionVariant);
    }
    await ctx.db.delete(translation._id);
    state.translationMap.set(lang, null);
    // Audio for the legacy-alongside-drifted case was already deleted by the
    // validity loop. The block below only fires when the sweep itself owns
    // the delete, i.e. post-PR drift / version bump where the audio looked fine
    // to the validity loop but the translation row is now stale. Reference-aware
    // delete so a blob shared via an `editCard` copy isn't dropped.
    const staleAudio = state.audioMap.get(lang);
    if (staleAudio) {
      // keepAsset: every trigger here is a CONTENT change (gender drift /
      // translation-version bump regenerating the text), the recording
      // itself is still valid audio of the old string, so it stays in the
      // audioAssets cache instead of being garbage-collected.
      await deleteAudioRow(ctx, staleAudio, { keepAsset: true });
      state.audioMap.set(lang, null);
    }
  }
  return { sweptRegionVariants, regenScheduled };
}

/**
 * Schedule a Scribe backfill for an existing audio row that lacks timings.
 * A no-op unless the row survived the validity sweep (its payload is in
 * `state.audioPayloadMap`), the shared asset has no timings yet, and the
 * language supports STT at all.
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
  if (!audio || !payload || payload.wordTimings) return;
  // Languages without STT support (e.g. `el`, Azure Fast Transcription
  // can't transcribe `el-GR`) will never get word timings, so don't waste
  // a claim on a backfill that's guaranteed to no-op.
  if (!languageSupportsStt(lang)) return;
  if (opts?.probe) {
    // Claim-held = a job (synthesis or backfill) already owns the slot —
    // unless it's a background claim the real (priority-less, hence
    // interactive) claim below would take over, which is a write.
    if (await hasBlockingTtsClaim(ctx, textId, lang, undefined)) return;
    throw new ProbeNeedsWork();
  }
  const claimed = await claimTtsIfAvailable(ctx, textId, lang);
  if (!claimed) return;
  // Forward the persisted regionVariant for mixed-dialect rows so STT runs
  // against the same locale the voice was synthesized in. Undefined for
  // non-mixed languages and for the source-language (no translations row).
  const regionVariant = state.translationMap.get(lang)?.regionVariant;
  await ctx.scheduler.runAfter(
    0,
    internal.features.ttsProcessing.backfillWordTimings,
    { textId, language: lang, storageId: payload.storageId, regionVariant },
  );
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
  for (const kind of missingAnnotationKinds(text.language, text)) {
    if (opts?.probe) throw new ProbeNeedsWork();
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
  for (const kind of missingAnnotationKinds(lang, translation)) {
    if (opts?.probe) throw new ProbeNeedsWork();
    await ctx.scheduler.runAfter(0, TEXT_ANNOTATIONS[kind].translationAction, {
      textId,
      text: translation.translatedText,
      language: lang,
    });
  }
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
  const allRequiredLanguages = [
    ...new Set([sourceLanguage, ...baseLanguages, ...targetLanguages]),
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

  const langsWithAudioGenderDrift = await sweepInvalidAudio(
    ctx,
    textId,
    audioSpeakerGender,
    state,
    opts,
  );

  const { sweptRegionVariants, regenScheduled } = await sweepStaleTranslations(
    ctx,
    textId,
    text,
    audioSpeakerGender,
    state,
    langsWithAudioGenderDrift,
    opts,
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

  return { translationsScheduled, audioScheduled };
}
