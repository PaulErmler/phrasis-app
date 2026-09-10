import { v, Infer } from 'convex/values';
import { MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import {
  getVoiceForText,
  IPA_LANGUAGES,
  FURIGANA_LANGUAGES,
  DEFAULT_CONTENT_VERSION,
  getCurrentTranslationVersion,
  postProcessTranslation,
} from '../../lib/languages';
import {
  isUserCreatedText,
  SOURCE_VERBATIM_TRANSLATION_SOURCE,
} from '../../lib/translationProvenance';
import { soundsSame } from '../lib/textComparison';
import {
  resolveRetranslation,
  resolveRetranslationIfPending,
} from './cardEditAudit';
import { deleteAudioRow, deleteAudioRowsForTextLanguage } from '../lib/audio';
import {
  findReusableAudioAssetForVoice,
  upsertAudioPointer,
} from '../lib/audioAssets';
import { claimTtsIfAvailable } from './ttsProcessing';
import { getLlmClaim } from './llmTranslationQueue';
import { enqueueTtsForVoice } from '../lib/contentScheduling';
import { scheduleSearchableTextRebuild } from './searchRebuild';
import {
  ttsPriorityValidator,
  translationReasonValidator,
  voiceGenderValidator,
} from '../types';
import { liveTranslation, audioPointer } from '../db/translationReads';
import { parseRenderingKey } from '../../lib/preferenceResolution';
import { scheduleTranslationAnnotations } from '../lib/textAnnotations';

/**
 * Translation write pipeline: `storeTranslationAndScheduleTTS`, the single
 * write choke point every translation producer (the LLM queue, the verbatim
 * accent path, retranslations) lands through. Owns the
 * insert/replace/fill-metadata decision, the retranslation audio decision
 * (`soundsSame`), the audit-row resolution matrix, and the follow-up
 * scheduling (IPA/furigana regeneration, searchable-text rebuild, TTS
 * enqueue). The registered functions stay in features/decks.ts and delegate
 * here. Every row written since the rendering keys carries `variantKey`
 * (docs/architecture/rendering-keys.md).
 */

// ────────────────────────────────────────────────────────────────────────────
// Args validators (registered in features/decks.ts via `.fields`)
// ────────────────────────────────────────────────────────────────────────────

const vStoreTranslationAndScheduleTtsArgs = v.object({
  textId: v.id('texts'),
  targetLanguage: v.string(),
  translatedText: v.string(),
  voiceName: v.string(),
  /** Requester attribution, forwarded into the TTS enqueue. */
  requestedByUserId: v.optional(v.string()),
  romanizedText: v.optional(v.string()),
  /**
   * Identifier of the romanizer that produced `romanizedText` (or
   * attempted to and emitted the empty-string sentinel). Required when
   * `romanizedText` is supplied, omitted otherwise. Persisted alongside
   * the text so a future strategy swap can target rows by source.
   */
  romanizationSource: v.optional(v.string()),
  /**
   * Identifier of the translation method (model + reasoning, or
   * `google-translate-v2` for the legacy path). Persisted on the
   * translation row so a future strategy swap can target rows produced
   * by the old method. Optional during rollout so old call sites that
   * haven't been threaded yet still compile.
   */
  translationSource: v.optional(v.string()),
  /**
   * Concrete regional variant chosen when `targetLanguage` is a mixed code
   * (today: `es_mixed`). Stored on the translation row so the audio player
   * can pick a voice in the matching locale.
   */
  regionVariant: v.optional(v.string()),
  /**
   * Retranslation flag. Set by callers that deliberately want to overwrite
   * an existing translation: `flagTranslation` and the curriculum-fix path
   * (the user reported a bad translation and the new LLM output replaces
   * the displayed text for everyone), and the version-bump regeneration
   * (`translationReason: 'version_bump'`, which first archives the old
   * wording for the cards that already show it, see `replaceForVersionBump`).
   *
   * When `true` AND a translation row already exists, the mutation
   * replaces `translatedText`, `romanizedText` (matched with its source),
   * `translationSource`, and `regionVariant`. `flagCount` is preserved.
   * It tracks user dissatisfaction history. The audio decision also lives
   * HERE (not in retranslation callers): when the new text sounds
   * identical to the old (punctuation/'_'-only diff, `soundsSame`), the
   * existing audio rows are kept and no TTS is enqueued; otherwise the
   * stale audio rows are deleted so the no-audio guard below schedules a
   * fresh TTS. Callers must NOT delete audio up front, before the LLM
   * lands they can't know whether the change is audible.
   *
   * When `false`/absent, the historical concurrent-write protection
   * stays in place: existing `translatedText` is never overwritten and
   * metadata is patched only when missing. This is the safe default for
   * the normal new-card insertion path and for any Google-fallback that
   * fires after another write already landed.
   */
  replaceExisting: v.optional(v.boolean()),
  /**
   * Why the translation was requested. Only `'version_bump'` changes the
   * write: an identical result merely restamps the version, and a different
   * one is archived for existing cards before the row is replaced. Every
   * other reason (and absence) keeps the historical replace / fill
   * semantics. See `supersededAt` in schema.ts.
   */
  translationReason: v.optional(translationReasonValidator),
  /**
   * Speaker gender ('male' | 'female') the translation was produced under:
   * the key's voice. Persisted on the translation row.
   */
  speakerGender: v.optional(voiceGenderValidator),
  /**
   * Single-writer token: the `llmTranslationClaims` row the calling job was
   * enqueued under. When supplied, the write only proceeds if that exact
   * claim doc still exists. A reclaim deletes + reinserts the claim under
   * a new `_id`, so a mismatch means another job now owns this
   * (textId, targetLanguage, key) and this result is stale. Absent on the
   * claimless verbatim path, which then keeps its historical no-overwrite
   * semantics only.
   */
  expectedClaimId: v.optional(v.id('llmTranslationClaims')),
  /**
   * Translation-only mode: store the translation but do NOT auto-enqueue
   * TTS, UNLESS the row is the text's PRIMARY rendering and a card
   * references the text. Used by the browse surfaces, where audio for
   * preview-only texts is deliberately deferred to an explicit audio-icon
   * click. The card check closes a pipeline hole: a text can become a card
   * while its skipTts warm job is in flight (onboarding seeds racing the
   * collection warms), and the concurrent ensure sweep defers TTS to this
   * very job via the fresh LLM claim, so honoring skipTts unconditionally
   * left the card with a translation and no audio, forever. Only the
   * primary: the card found may be another learner's, on other settings,
   * and its presence says nothing about whether THIS key is ever played.
   * Absent/false → historical behavior (translation landing schedules its
   * TTS).
   */
  skipTts: v.optional(v.boolean()),
  /**
   * Priority for the TTS enqueue below (see ttsPriorityValidator).
   * Threaded from the enqueue that carried the translation job so audio
   * lands in the tier the content was requested at.
   */
  priority: v.optional(ttsPriorityValidator),
  /**
   * The `cardEditRetranslations` row this write resolves, when the job was
   * triggered by a user gesture (a flag, or a manual edit of a curriculum
   * translation). This mutation is the only place that knows which of its
   * outcomes an attempt reached, so it owns the resolution. Absent on every
   * ordinary fill, which is the overwhelming majority of calls.
   */
  retranslationAuditId: v.optional(v.id('cardEditRetranslations')),
  /**
   * The rendering key of the row (docs/architecture/rendering-keys.md).
   * Every producer passes one; the row and its audio pointer share it.
   */
  variantKey: v.optional(v.string()),
  /**
   * The primary wording a versioned row was derived from. A versioning of
   * a wording that is no longer the primary one (a flag or a bump landed
   * while the job ran) is refused: the next ensure pass versions the new
   * wording. Absent on a primary write.
   */
  /** The rendering classifier's verdict on the wording; see schema.ts. */
  renderingVerified: v.optional(v.boolean()),
});
export const storeTranslationAndScheduleTtsArgs =
  vStoreTranslationAndScheduleTtsArgs.fields;
export type StoreTranslationAndScheduleTtsArgs = Infer<
  typeof vStoreTranslationAndScheduleTtsArgs
>;

// ────────────────────────────────────────────────────────────────────────────
// Row reads for the LLM worker
// ────────────────────────────────────────────────────────────────────────────

/**
 * Handler body of the internal query `getTranslationForTextLanguage`: the
 * live row at one key (`variantKey` undefined = the legacy row), as the LLM
 * worker reads it for the dialect pin, the primary wording a versioned key
 * is derived from, and the legacy wording an adoption verifies.
 */
export async function getTranslationForTextLanguageHandler(
  ctx: QueryCtx,
  args: { textId: Id<'texts'>; targetLanguage: string; variantKey?: string },
): Promise<{
  translatedText: string;
  romanizedText?: string;
  romanizationSource?: string;
  regionVariant?: string;
  translationSource?: string;
} | null> {
  const row = await liveTranslation(ctx, args.textId, args.targetLanguage);
  if (!row) return null;
  return {
    translatedText: row.translatedText,
    romanizedText: row.romanizedText,
    romanizationSource: row.romanizationSource,
    regionVariant: row.regionVariant,
    translationSource: row.translationSource,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// storeTranslationAndScheduleTTS: named steps
// ────────────────────────────────────────────────────────────────────────────

/**
 * What one `storeTranslationAndScheduleTTS` write did to the row, threaded
 * from the branch helpers into the shared follow-up scheduling and the
 * audit-resolution tail.
 */
type TranslationWriteResult = {
  /** The row written, so the annotations are scheduled by its own id. */
  rowId: Id<'translations'>;
  /**
   * Which write shape ran. `'restamped'`: a version-bump regeneration that
   * produced the identical wording, so only the version stamp (and source)
   * moved; nothing downstream needs to run.
   */
  outcome: 'inserted' | 'replaced' | 'restamped' | 'metadata_filled';
  /**
   * Set on the replace branch when the retranslation is a punctuation-only
   * change. Audio was kept and TTS must not be enqueued.
   */
  audioUnchangedBySound: boolean;
  /**
   * Set when this write changed content that belongs in the cards'
   * searchableText (new/replaced translation, newly-filled romanization).
   * Triggers the batched rebuild fan-out.
   */
  searchableContentChanged: boolean;
  /**
   * Set when the row ends this mutation without an IPA transcription
   * (fresh insert, replace-cleared, or a legacy row that never had one).
   * IPA can't be computed inline here: espeak lives in the Node runtime
   * (convex/features/ipa.ts), so it's scheduled as a follow-up.
   */
  ipaMissingAfterWrite: boolean;
  /**
   * Same contract for furigana: like IPA it is Node-runtime compute
   * (convex/features/furigana.ts), so a replace must clear the pair and
   * schedule regeneration — leaving the old wording's furigana on the new
   * text would park a stale annotation the lazy pipeline never revisits
   * (non-undefined) and the client always rejects.
   */
  furiganaMissingAfterWrite: boolean;
};

/**
 * Refusal guards ahead of any write. Returns the text + existing row when the
 * write may proceed, or null after resolving the audit row with the matching
 * dropped/refused verdict:
 *
 *  - text cascade-deleted mid-flight (deleteCardPermanently / editCard
 *    cleanup): don't write an orphan translation row (and schedule orphan
 *    TTS) against a now-deleted text. The LLM claim (if any) is released by
 *    the pool job's onComplete. No-op in normal flow (text always exists).
 *  - single-writer gate: a job whose claim was reclaimed mid-flight (it ran
 *    past CLAIM_STALE_MS and a concurrent scheduler re-enqueued the row) must
 *    not write. The reclaiming job owns the row now, and a late stale result
 *    landing after the owner's would silently revert it (worst case: a
 *    flag-retranslation's text overwritten while its audio survives).
 *  - stale versioning: a versioned row carries the primary wording it was
 *    derived from (`versionedFromText`); when the primary row has moved on
 *    since (a flag or a bump), the versioning describes a wording no card
 *    shows and is dropped; the next ensure pass versions the new one.
 *  - backstop at the write choke point: no job may overwrite existing wording
 *    on a user-created card, whatever enqueued it. Callers already refuse to
 *    ask (`flagTranslation` short-circuits on user-created texts, and
 *    `updateEssentialGreetings` only targets premade rows), so no live path
 *    reaches this today. It is defence in depth against a future caller.
 *    Deliberately scoped to the OVERWRITE. The `existing &&` is load-bearing,
 *    and NOT for the fill-a-missing-language path: that one never sets
 *    `replaceExisting` (see `scheduleTranslationForLanguage`), so the guard is
 *    inert there either way. It matters for a re-driven retranslation that
 *    carries the original job's `replaceExisting: true`: by the time it
 *    lands, the row it meant to replace may have been swept, and refusing
 *    then would leave the card with no translation at all.
 */
async function guardTranslationWrite(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
): Promise<{
  text: Doc<'texts'>;
  existing: Doc<'translations'> | null;
} | null> {
  const text = await ctx.db.get(args.textId);
  if (text === null) {
    await resolveRetranslation(
      ctx,
      args.retranslationAuditId,
      'dropped_text_deleted',
    );
    return null;
  }

  if (args.expectedClaimId !== undefined) {
    const llmClaim = await getLlmClaim(ctx, args.textId, args.targetLanguage);
    if (llmClaim?._id !== args.expectedClaimId) {
      await resolveRetranslation(
        ctx,
        args.retranslationAuditId,
        'dropped_superseded',
      );
      return null;
    }
  }

  const existing = await liveTranslation(ctx, args.textId, args.targetLanguage);

  if (existing && args.replaceExisting && isUserCreatedText(text)) {
    await resolveRetranslation(
      ctx,
      args.retranslationAuditId,
      'refused_user_created',
    );
    return null;
  }

  return { text, existing };
}

/** Fresh row: no translation existed for this (text, language) yet. */
async function insertTranslationRow(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
  translatedText: string,
  romanizedText: string | undefined,
): Promise<TranslationWriteResult> {
  const rowId = await ctx.db.insert('translations', {
    textId: args.textId,
    targetLanguage: args.targetLanguage,
    translatedText,
    // `!== undefined` so the empty-string sentinel ("tried, failed,
    // leave empty") persists on the new row and ensureContent stops
    // rescheduling, otherwise `romanizedText === ''` would be
    // dropped by the truthy spread and look like "never attempted".
    ...(romanizedText !== undefined
      ? {
          romanizedText,
          ...(args.romanizationSource
            ? { romanizationSource: args.romanizationSource }
            : {}),
        }
      : {}),
    ...(args.translationSource
      ? { translationSource: args.translationSource }
      : {}),
    ...(args.regionVariant ? { regionVariant: args.regionVariant } : {}),
    ...(args.speakerGender ? { speakerGender: args.speakerGender } : {}),
    ...(args.variantKey ? { variantKey: args.variantKey } : {}),
    ...(args.renderingVerified !== undefined
      ? { renderingVerified: args.renderingVerified }
      : {}),
    // Freshly produced row → stamp the language's current method version.
    translationVersion: getCurrentTranslationVersion(args.targetLanguage),
  });
  return {
    rowId,
    outcome: 'inserted',
    audioUnchangedBySound: false,
    searchableContentChanged: true,
    ipaMissingAfterWrite: true,
    furiganaMissingAfterWrite: true,
  };
}

/**
 * The audio-invalidation decision for retranslations, made here where old
 * and new text are both in hand: a punctuation/'_'-only change sounds
 * identical, so the existing audio stays valid, deleting + regenerating
 * would spend real TTS cost on byte-identical speech. Only an audible change
 * drops the row's own pointer (reference-aware; keepAsset because a
 * retranslation is a content change — the old recording is still correct
 * audio of the old sentence and stays cached). Returns true when the audio
 * was kept (and TTS must not be enqueued).
 */
async function invalidateAudioIfAudiblyChanged(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
  variantKey: string | undefined,
  existingText: string,
  newText: string,
): Promise<boolean> {
  const audioUnchangedBySound = soundsSame(existingText, newText);
  if (!audioUnchangedBySound) {
    await deleteAudioRowsForTextLanguage(ctx, textId, targetLanguage, {
      keepAsset: true,
    });
  }
  return audioUnchangedBySound;
}

/**
 * Deliberate retranslation (`replaceExisting`): overwrite the translation and
 * its matched metadata. romanizedText and romanizationSource travel as a
 * unit, both replaced together, including the empty-string sentinel. If the
 * caller didn't compute a new romanization (`romanizedText` undefined), clear
 * both fields so the next ensureContent pass regenerates them against the new
 * translatedText. `flagCount` is preserved (user dissatisfaction history).
 */
async function replaceTranslationRow(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
  existing: Doc<'translations'>,
  translatedText: string,
  romanizedText: string | undefined,
): Promise<TranslationWriteResult> {
  const audioUnchangedBySound = await invalidateAudioIfAudiblyChanged(
    ctx,
    args.textId,
    args.targetLanguage,
    args.variantKey,
    existing.translatedText,
    translatedText,
  );

  const patch: Partial<{
    translatedText: string;
    romanizedText: string | undefined;
    romanizationSource: string | undefined;
    ipaText: string | undefined;
    ipaSource: string | undefined;
    furiganaText: string | undefined;
    furiganaSource: string | undefined;
    translationSource: string | undefined;
    regionVariant: string | undefined;
    speakerGender: 'male' | 'female';
    translationVersion: number;
    renderingVerified: boolean | undefined;
  }> = {
    translatedText,
    // A retranslation is freshly produced → stamp the current method version.
    translationVersion: getCurrentTranslationVersion(args.targetLanguage),
    // The derivation and the verdict describe the new wording (or nothing,
    // for a primary write).
    renderingVerified: args.renderingVerified,
  };
  if (romanizedText !== undefined) {
    patch.romanizedText = romanizedText;
    patch.romanizationSource = args.romanizationSource;
  } else {
    // Convex `patch` semantics: `undefined` clears the field.
    patch.romanizedText = undefined;
    patch.romanizationSource = undefined;
  }
  // No caller computes IPA inline (Node-runtime engine), so a replaced
  // translation always clears the pair; the follow-up scheduled by the
  // caller regenerates it against the new wording.
  patch.ipaText = undefined;
  patch.ipaSource = undefined;
  // Furigana: same reasoning as IPA, same follow-up.
  patch.furiganaText = undefined;
  patch.furiganaSource = undefined;
  if (args.translationSource) {
    patch.translationSource = args.translationSource;
  }
  if (args.regionVariant) {
    patch.regionVariant = args.regionVariant;
  }
  // Update the recorded speakerGender. A retranslation is what fixes a
  // stale gender, so the new row's gender should reflect the current card.
  if (args.speakerGender) {
    patch.speakerGender = args.speakerGender;
  }
  await ctx.db.patch(existing._id, patch);
  return {
    rowId: existing._id,
    outcome: 'replaced',
    audioUnchangedBySound,
    searchableContentChanged: true,
    ipaMissingAfterWrite: true,
    furiganaMissingAfterWrite: true,
  };
}

/** Copy of `value` with every `undefined` property dropped, for inserts. */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

/**
 * Copy the live row's current wording into a superseded row of the same
 * table together with the asset its audio plays, and mark the live row so
 * card-facing readers know to consult the superseded rows for cards pinned
 * before now. Called only when at least one card references the text AND
 * the wording has audio (`audioAssetId`): a revision nobody can be served is
 * a row for nothing, and a revision without audio would pin its cards to a
 * wording no pointer voices.
 *
 * The copy carries the wording's annotations as they are; whatever is still
 * missing is scheduled right away with the copy's own id, so a pinned card
 * gets its IPA / furigana / romanization exactly like a live one would.
 */
async function archiveTranslationRevision(
  ctx: MutationCtx,
  existing: Doc<'translations'>,
  audioAssetId: Id<'audioAssets'>,
): Promise<void> {
  const supersededAt = Date.now();
  const supersededId = await ctx.db.insert(
    'translations',
    defined({
      textId: existing.textId,
      targetLanguage: existing.targetLanguage,
      translatedText: existing.translatedText,
      romanizedText: existing.romanizedText,
      romanizationSource: existing.romanizationSource,
      ipaText: existing.ipaText,
      ipaSource: existing.ipaSource,
      furiganaText: existing.furiganaText,
      furiganaSource: existing.furiganaSource,
      translationSource: existing.translationSource,
      regionVariant: existing.regionVariant,
      speakerGender: existing.speakerGender,
      translationVersion: existing.translationVersion,
      variantKey: existing.variantKey,
      renderingVerified: existing.renderingVerified,
      audioAssetId,
      supersededAt,
    }),
  );
  await ctx.db.patch(existing._id, { lastArchivedAt: supersededAt });
  // The archive row is new: the live row's request claim does not carry
  // over, or a copy made inside the cooldown would wait it out for nothing.
  await scheduleTranslationAnnotations(
    ctx,
    { ...existing, annotationRequestedAt: undefined },
    supersededId,
  );
}

/**
 * The `replaceExisting` write of a `'version_bump'` job. Three outcomes, all
 * inside this one mutation, so there is never a window in which a card sees
 * the new wording before its old one is safe:
 *
 *  - identical wording → restamp the version (and source); annotations,
 *    audio and search strings are untouched. The common case for short
 *    curriculum sentences, and it costs no TTS.
 *  - a card references the text and the wording has audio → archive the
 *    old wording with its asset so every existing card keeps it, then the
 *    normal replacement.
 *  - nothing references the text, or the wording never got audio (a warmed
 *    row replaced before its first TTS) → the normal replacement. Nobody
 *    has heard the old wording, and pinning a card to an audio-less archive
 *    row would leave it mute: archived entries never report missing content.
 *
 * Flag and curriculum-fix retranslations never come here: they overwrite
 * for every learner, as the schema comment on `cardEditRetranslations`
 * documents. The pointer looked up is the row's own key's, which is the
 * one its clip lives under.
 */
async function replaceForVersionBump(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
  existing: Doc<'translations'>,
  translatedText: string,
  romanizedText: string | undefined,
): Promise<TranslationWriteResult> {
  if (existing.translatedText === translatedText) {
    await ctx.db.patch(existing._id, {
      translationVersion: getCurrentTranslationVersion(args.targetLanguage),
      ...(args.translationSource
        ? { translationSource: args.translationSource }
        : {}),
      // A derivation-stale row that came back byte-identical must still
      // record the primary wording it now matches, or the sweep buys the
      // same versioning on every pass. Same for the verdict.
      ...(args.renderingVerified !== undefined
        ? { renderingVerified: args.renderingVerified }
        : {}),
    });
    return {
      rowId: existing._id,
      outcome: 'restamped',
      audioUnchangedBySound: true,
      searchableContentChanged: false,
      ipaMissingAfterWrite: existing.ipaText === undefined,
      furiganaMissingAfterWrite: existing.furiganaText === undefined,
    };
  }
  // A verbatim row, an accent variant's `source-verbatim` copy of the
  // source text, is never archived. Its wording is the catalogue text every
  // card without an accent row shows anyway, so no learner loses wording
  // they learned, and archiving it would pin the first Mixed English or UK
  // card of the text to the un-rewritten copy for good.
  const referencingCard =
    existing.translationSource === SOURCE_VERBATIM_TRANSLATION_SOURCE
      ? null
      : await ctx.db
          .query('cards')
          .withIndex('by_textId', (q) => q.eq('textId', args.textId))
          .first();
  if (referencingCard) {
    const audio = await audioPointer(ctx, args.textId, args.targetLanguage);
    if (audio) {
      await archiveTranslationRevision(ctx, existing, audio.assetId);
    }
  }
  return replaceTranslationRow(
    ctx,
    args,
    existing,
    translatedText,
    romanizedText,
  );
}

/**
 * Concurrent-write protection (no `replaceExisting`): the existing
 * `translatedText` is never overwritten; metadata is patched only when
 * missing. The safe default for the normal new-card insertion path and for
 * any Google-fallback that fires after another write already landed.
 */
async function fillTranslationMetadata(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
  existing: Doc<'translations'>,
  romanizedText: string | undefined,
): Promise<TranslationWriteResult> {
  let searchableContentChanged = false;
  const patch: Partial<{
    romanizedText: string;
    romanizationSource: string;
    translationSource: string;
    regionVariant: string;
    speakerGender: 'male' | 'female';
    translationVersion: number;
  }> = {};
  // Same `!== undefined` reasoning as the insert branch: persist the sentinel
  // on first write but never overwrite a previously-stored real value. Source
  // travels with the value. They're written/cleared as a unit.
  if (romanizedText !== undefined && existing.romanizedText === undefined) {
    patch.romanizedText = romanizedText;
    if (args.romanizationSource) {
      patch.romanizationSource = args.romanizationSource;
    }
  }
  // Translation source is set on first-write of `translatedText` (which
  // happened upstream when the row was inserted). For existing rows we
  // only fill it in if it's missing. The legacy-backfill migration
  // handles older rows, but a concurrent regenerate against an existing
  // row should keep the original source as the canonical record.
  if (args.translationSource && existing.translationSource === undefined) {
    patch.translationSource = args.translationSource;
  }
  if (args.regionVariant && !existing.regionVariant) {
    patch.regionVariant = args.regionVariant;
  }
  // Same "fill if missing" pattern as the other metadata fields. Legacy
  // translation rows written before `speakerGender` existed get stamped
  // here on the first ensureContent pass that reaches them, so the
  // gender-mismatch sweep doesn't loop on them forever.
  if (args.speakerGender && existing.speakerGender === undefined) {
    patch.speakerGender = args.speakerGender;
  }
  // Fill-if-missing: stamp legacy rows (written before the field existed) at
  // BASELINE, not the current version. This branch keeps the row's OLD
  // translatedText, so it must stay regenerable by a future translationVersion
  // bump, matching the one-time content-version backfill, which stamped
  // legacy rows at v1 so `baseline < bumped = stale`. Stamping the current
  // version here would mark
  // stale content as already up-to-date and silently defeat the bump. Only the
  // insert and replaceExisting branches (fresh content) stamp the current version.
  if (existing.translationVersion === undefined) {
    patch.translationVersion = DEFAULT_CONTENT_VERSION;
  }
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(existing._id, patch);
    // Only a real romanization value changes the search string. The
    // metadata fills (source/variant/gender/version) don't, and the
    // empty-string sentinel is filtered out of searchableText anyway.
    if (patch.romanizedText) {
      searchableContentChanged = true;
    }
  }
  return {
    rowId: existing._id,
    outcome: 'metadata_filled',
    audioUnchangedBySound: false,
    searchableContentChanged,
    // Legacy row this job merely filled metadata on: schedule IPA only
    // when the row never had one (`=== undefined` honors the sentinel).
    ipaMissingAfterWrite: existing.ipaText === undefined,
    furiganaMissingAfterWrite: existing.furiganaText === undefined,
  };
}

/**
 * The retranslation-audit resolution tail: map the write outcome onto the
 * audit row's verdict. No-op without a `retranslationAuditId` (every ordinary
 * fill).
 *
 *  - inserted → 'applied'. A retranslation whose row vanished under it (a
 *    sweep deleted it while the job was in flight). The new wording still
 *    landed, so it counts as applied; there is simply no `before` to have
 *    kept audio for.
 *  - replaced → 'applied_audio_kept' | 'applied'. The outcome a reviewer is
 *    actually after: what the model produced, and whether it differed audibly
 *    enough to be worth re-synthesizing.
 *  - metadata_filled → 'dropped_superseded' (only if still pending).
 *    Unreachable for audit-carrying jobs today (they all set
 *    `replaceExisting`), but the args are independent, so close the outcome
 *    matrix: an attempt that landed here did NOT overwrite the row, and
 *    leaving its audit row 'enqueued' would read as "still in flight" in the
 *    admin QC view forever. Guarded so a resolved row is never downgraded.
 */
async function resolveAuditForWriteOutcome(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
  write: TranslationWriteResult,
  translatedText: string,
): Promise<void> {
  if (write.outcome === 'metadata_filled') {
    await resolveRetranslationIfPending(
      ctx,
      args.retranslationAuditId,
      'dropped_superseded',
    );
    return;
  }
  await resolveRetranslation(
    ctx,
    args.retranslationAuditId,
    (write.outcome === 'replaced' && write.audioUnchangedBySound) ||
      write.outcome === 'restamped'
      ? 'applied_audio_kept'
      : 'applied',
    {
      afterText: translatedText,
      afterTranslationSource: args.translationSource,
    },
  );
}

/**
 * Follow-up IPA/furigana transcription for the (possibly new) wording.
 * Deliberately runs BEFORE the `audioUnchangedBySound` early-return in the
 * handler: a sounds-the-same retranslation still changed the wording, and
 * the replace branch just cleared the pair. Harmless to race the
 * ensureContent gate; the store mutation's `=== undefined` guard makes the
 * second write a no-op.
 */
async function scheduleAnnotationRegeneration(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
  write: TranslationWriteResult,
  translatedText: string,
  // The row the annotations land on. A VARIANT write names its own row:
  // the store resolves an unnamed row to the canonical one, whose wording
  // guard would refuse the variant's text. Absent = the live canonical row.
  translationId?: Id<'translations'>,
): Promise<void> {
  if (write.ipaMissingAfterWrite && IPA_LANGUAGES.has(args.targetLanguage)) {
    await ctx.scheduler.runAfter(
      0,
      internal.features.ipa.processIpaForTranslation,
      {
        textId: args.textId,
        text: translatedText,
        language: args.targetLanguage,
        translationId,
      },
    );
  }
  if (
    write.furiganaMissingAfterWrite &&
    FURIGANA_LANGUAGES.has(args.targetLanguage)
  ) {
    await ctx.scheduler.runAfter(
      0,
      internal.features.furigana.processFuriganaForTranslation,
      {
        textId: args.textId,
        text: translatedText,
        language: args.targetLanguage,
        translationId,
      },
    );
  }
}

/**
 * TTS decision for a just-landed translation: honor `skipTts` unless a card
 * references the text (see the arg's doc for the race this closes), reuse a
 * fresh content-addressed asset when one exists, otherwise claim the slot and
 * enqueue synthesis.
 */
async function scheduleTtsForLandedTranslation(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
  translatedText: string,
): Promise<void> {
  let ttsPriority = args.priority;
  if (args.skipTts) {
    // skipTts means "don't spend synthesis on texts nobody studies". A
    // card referencing this text disproves that premise (see the arg's
    // docstring for the race this closes), so only skip when none exists.
    const cardForText = await ctx.db
      .query('cards')
      .withIndex('by_textId', (q) => q.eq('textId', args.textId))
      .first();
    if (!cardForText) {
      return;
    }
    // The card also disproves "nobody is waiting on this": this is audio
    // the race left missing on a studied card, so it rides the interactive
    // pool even though the warm caller requested 'background'.
    ttsPriority = undefined;
  }

  let existingAudio = await audioPointer(ctx, args.textId, args.targetLanguage);

  // Keyed pointers only. A pointer speaking a different sentence is not
  // "already voiced": a clip that outlived its wording (a TTS job still in
  // flight when the wording moved on) would otherwise be treated as valid
  // and the card would render one sentence while playing another. Legacy
  // pointers are left alone here: `sweepInvalidAudio` owns that drift.
  // Detach with the asset kept: it is still correct audio for its own
  // string.
  if (existingAudio && args.variantKey !== undefined) {
    const asset = await ctx.db.get(existingAudio.assetId);
    if (asset && asset.spokenText !== translatedText) {
      await deleteAudioRow(ctx, existingAudio, { keepAsset: true });
      existingAudio = null;
    }
  }

  if (!existingAudio) {
    // A translation just landed. Check the content-addressed store before
    // spending synthesis: another text with this exact string (same
    // language, gender, dialect) may already have fresh audio, in which
    // case attaching the pointer is all that's needed. Any drift the
    // existing-audio skip above leaves behind (e.g. a stale gender) is the
    // sweep's job, which reads through the same asset payload.
    const asset = await findReusableAudioAssetForVoice(ctx, {
      language: args.targetLanguage,
      voiceName: args.voiceName,
      regionVariant: args.regionVariant,
      spokenText: translatedText,
    });
    if (asset) {
      await upsertAudioPointer(
        ctx,
        args.textId,
        args.targetLanguage,
        asset._id,
        args.variantKey,
      );
    } else {
      const claimed = await claimTtsIfAvailable(
        ctx,
        args.textId,
        args.targetLanguage,
        ttsPriority,
      );
      if (claimed) {
        await enqueueTtsForVoice(ctx, {
          textId: args.textId,
          text: translatedText,
          language: args.targetLanguage,
          voiceName: args.voiceName,
          regionVariant: args.regionVariant,
          priority: ttsPriority,
          requestedByUserId: args.requestedByUserId,
          variantKey: args.variantKey,
        });
      }
    }
  }
}

/**
 * The write for a verbatim row, an accent-only variant's `source-verbatim`
 * copy of the text's own wording, voiced in the variant's accent and in the
 * key's voice. Built here for the scheduler's verbatim branch and the LLM
 * queue's rewrite-exhausted fallback, so the two never drift.
 */
export function verbatimTranslationArgs(
  text: Pick<Doc<'texts'>, '_id' | 'text' | 'audioSpeakerGender'>,
  targetLanguage: string,
  /** The row's key; undefined = the legacy row, voiced by the text's voice. */
  variantKey: string | undefined,
  opts: Pick<
    StoreTranslationAndScheduleTtsArgs,
    | 'skipTts'
    | 'priority'
    | 'requestedByUserId'
    | 'replaceExisting'
    | 'translationReason'
  >,
): StoreTranslationAndScheduleTtsArgs {
  const voice =
    variantKey !== undefined
      ? parseRenderingKey(variantKey).voice
      : text.audioSpeakerGender === 'male' ||
          text.audioSpeakerGender === 'female'
        ? text.audioSpeakerGender
        : undefined;
  return {
    textId: text._id,
    targetLanguage,
    translatedText: text.text,
    voiceName: getVoiceForText(targetLanguage, text._id, undefined, voice),
    translationSource: SOURCE_VERBATIM_TRANSLATION_SOURCE,
    speakerGender: voice,
    variantKey,
    skipTts: opts.skipTts,
    priority: opts.priority,
    requestedByUserId: opts.requestedByUserId,
    replaceExisting: opts.replaceExisting,
    translationReason: opts.translationReason,
  };
}

/**
 * Handler body of `storeTranslationAndScheduleTTS`: guard → post-process →
 * one of the row writes (insert / replace / version-bump replace / fill-metadata) → audit
 * resolution → follow-ups (search rebuild, IPA/furigana, TTS). See the arg
 * validator docs above for the semantics of each mode.
 */
export async function storeTranslationAndScheduleTTSHandler(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
): Promise<null> {
  const gate = await guardTranslationWrite(ctx, args);
  if (gate === null) return null;
  // This key's claim is done with: released here, in the same transaction
  // as the row, so a later failure of the same job (another key's
  // versioning) marks only the keys that really failed, and a retried
  // action skips this key (`processLlmTranslationForCard`).
  if (args.expectedClaimId !== undefined) {
    await ctx.db.delete(args.expectedClaimId);
  }
  const { existing } = gate;

  // Choke-point post-processing (idempotent, LLM/Google producers already
  // apply it upstream; this catches any path that didn't). The empty-string
  // romanization sentinel maps to itself, so "tried, failed" survives.
  const translatedText = postProcessTranslation(
    args.targetLanguage,
    args.translatedText,
  );
  const romanizedText =
    args.romanizedText !== undefined
      ? postProcessTranslation(args.targetLanguage, args.romanizedText)
      : undefined;

  const write = !existing
    ? await insertTranslationRow(ctx, args, translatedText, romanizedText)
    : args.replaceExisting
      ? args.translationReason === 'version_bump'
        ? await replaceForVersionBump(
            ctx,
            args,
            existing,
            translatedText,
            romanizedText,
          )
        : await replaceTranslationRow(
            ctx,
            args,
            existing,
            translatedText,
            romanizedText,
          )
      : await fillTranslationMetadata(ctx, args, existing, romanizedText);

  await resolveAuditForWriteOutcome(ctx, args, write, translatedText);

  // The cards following this rendering now show different words, so their
  // search string is stale: `searchableText` follows the served rendering
  // (`buildSearchableTextPatchForCard`).
  if (write.searchableContentChanged) {
    await scheduleSearchableTextRebuild(ctx, args.textId);
  }

  // Annotations by the row's own id: a keyed row's wording is the one
  // annotated (an unnamed row resolves to the legacy row in the store).
  await scheduleAnnotationRegeneration(
    ctx,
    args,
    write,
    translatedText,
    args.variantKey !== undefined ? write.rowId : undefined,
  );

  // `audioUnchangedBySound`: the retained audio row already serves this
  // (text, language, key), skip outright.
  if (write.audioUnchangedBySound) {
    return null;
  }
  await scheduleTtsForLandedTranslation(ctx, args, translatedText);
  return null;
}
