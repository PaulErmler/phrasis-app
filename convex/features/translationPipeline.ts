import { v, Infer } from 'convex/values';
import { MutationCtx, ActionCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import { translateText, romanizeText } from './translation';
import { captureGeneration } from '../lib/posthogAi';
import { costForCharacters } from '../config/aiCosts';
import { getRomanizationSource } from '../lib/localRomanization';
import {
  getVoiceForLanguage,
  getVoiceForLanguageVariant,
  getVoiceGenderByApiCode,
  getMixedVariantByRegion,
  resolveMixedVariant,
  ROMANIZATION_LANGUAGES,
  IPA_LANGUAGES,
  FURIGANA_LANGUAGES,
  DEFAULT_CONTENT_VERSION,
  getCurrentTranslationVersion,
  postProcessTranslation,
} from '../../lib/languages';
import {
  GOOGLE_TRANSLATE_SOURCE,
  isUserCreatedText,
} from '../../lib/translationProvenance';
import { soundsSame } from '../lib/textComparison';
import {
  resolveRetranslation,
  resolveRetranslationIfPending,
} from './cardEditAudit';
import { deleteAudioRowsForTextLanguage } from '../lib/audio';
import { findReusableAudioAsset, upsertAudioPointer } from '../lib/audioAssets';
import { claimTtsIfAvailable } from './ttsProcessing';
import { getLlmClaim } from './llmTranslationQueue';
import { enqueueTtsForVoice } from '../lib/contentScheduling';
import { scheduleSearchableTextRebuild } from './searchRebuild';
import {
  ttsPriorityValidator,
  voiceGenderValidator,
  asVoiceGender,
} from '../types';

/**
 * Translation write pipeline: the legacy Google Translate worker action and
 * `storeTranslationAndScheduleTTS`, the single write choke point every
 * translation producer (LLM queue, Google path, retranslations) lands
 * through. Owns the insert/replace/fill-metadata decision, the retranslation
 * audio decision (`soundsSame`), the audit-row resolution matrix, and the
 * follow-up scheduling (IPA/furigana regeneration, searchable-text rebuild,
 * TTS enqueue). The registered functions stay in features/decks.ts and
 * delegate here.
 */

// ────────────────────────────────────────────────────────────────────────────
// Args validators (registered in features/decks.ts via `.fields`)
// ────────────────────────────────────────────────────────────────────────────

const vProcessTranslationForCardArgs = v.object({
  textId: v.id('texts'),
  sourceLanguage: v.string(),
  targetLanguage: v.string(),
  text: v.string(),
  audioSpeakerGender: v.optional(v.string()),
  /**
   * User whose deliberate action caused this job; cost events bill to them
   * (see the llm queue's validator for the full contract). Forwarded to
   * `storeTranslationAndScheduleTTS` so the TTS leg inherits it.
   */
  requestedByUserId: v.optional(v.string()),
  /**
   * Retranslation flag. Set when this action is dispatched as the
   * Google fallback for a deliberate LLM retranslation (flagTranslation
   * or the model-swap migration). When true, the action skips the
   * "reuse existing translatedText" shortcut and Google-translates fresh,
   * then forwards the flag to `storeTranslationAndScheduleTTS` so the
   * existing row is actually overwritten. False/absent → historical
   * behavior (reuse existing translation if present).
   *
   * Failure contract: THROWS on translation/store errors. This action runs
   * as an llmPool job (both the direct Google path and the LLM fallback),
   * so the pool retries with backoff and terminal failures land in
   * `onGoogleFallbackComplete`, which logs and leaves the claim to expire
   * as a re-drive backoff.
   */
  replaceExisting: v.optional(v.boolean()),
  /**
   * Single-writer token, forwarded to `storeTranslationAndScheduleTTS` as
   * `expectedClaimId`. Set by the LLM-fallback dispatch (the claim the
   * failed LLM job owned, re-pointed at this job); absent on the direct
   * Google path, which holds no claim.
   */
  claimId: v.optional(v.id('llmTranslationClaims')),
  /**
   * Mixed-dialect pin: the `regionVariant` of a translation row deleted
   * before this regeneration was enqueued (captured pre-delete by the
   * version-stale sweep, or forwarded through the LLM fallback). Preferred
   * over a fresh `resolveMixedVariant` pick so the dialect never flips.
   */
  preferredRegionVariant: v.optional(v.string()),
  /**
   * Translation-only mode, forwarded to `storeTranslationAndScheduleTTS`
   * so the landing translation does not auto-enqueue TTS. Set by the
   * collection-preview generation path (directly or via the LLM fallback).
   */
  skipTts: v.optional(v.boolean()),
  /** TTS priority, forwarded to `storeTranslationAndScheduleTTS`. */
  priority: v.optional(ttsPriorityValidator),
  /**
   * Card-edit audit row this job resolves, forwarded from the LLM fallback
   * dispatch. Absent on the direct Google path, which no user gesture
   * triggers.
   */
  retranslationAuditId: v.optional(v.id('cardEditRetranslations')),
});
export const processTranslationForCardArgs =
  vProcessTranslationForCardArgs.fields;
export type ProcessTranslationForCardArgs = Infer<
  typeof vProcessTranslationForCardArgs
>;

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
   * an existing translation. Today only `flagTranslation` (the user
   * reported a bad translation and we want the new LLM output to replace
   * the displayed text).
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
   * Speaker gender ('male' | 'female') the translation was produced under
   * The card's resolved `audioSpeakerGender`. Persisted on the translation
   * row so the gender-mismatch sweep in `scheduleMissingContent` can
   * invalidate translations whose grammar no longer agrees with the card's
   * current voice gender. Optional during rollout so old call sites that
   * haven't been threaded yet still compile.
   */
  speakerGender: v.optional(voiceGenderValidator),
  /**
   * Single-writer token: the `llmTranslationClaims` row the calling job was
   * enqueued under. When supplied, the write only proceeds if that exact
   * claim doc still exists. A reclaim deletes + reinserts the claim under
   * a new `_id`, so a mismatch means another job now owns this
   * (textId, targetLanguage) and this result is stale. Absent on the
   * claimless direct-Google path (`scheduleMissingContent`'s non-openrouter
   * branch), which then keeps its historical no-overwrite semantics only.
   */
  expectedClaimId: v.optional(v.id('llmTranslationClaims')),
  /**
   * Translation-only mode: store the translation but do NOT auto-enqueue
   * TTS, UNLESS a card references this text. Used by the collection-preview
   * generation path, where audio for preview-only texts is deliberately
   * deferred to an explicit audio-icon click. The card check closes a
   * pipeline hole: a text can become a card while its skipTts warm job is
   * in flight (onboarding seeds racing the collection warms), and the
   * concurrent ensure sweep defers TTS to this very job via the fresh LLM
   * claim, so honoring skipTts unconditionally left the card with a
   * translation and no audio, forever. Absent/false → historical behavior
   * (translation landing schedules its TTS).
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
});
export const storeTranslationAndScheduleTtsArgs =
  vStoreTranslationAndScheduleTtsArgs.fields;
export type StoreTranslationAndScheduleTtsArgs = Infer<
  typeof vStoreTranslationAndScheduleTtsArgs
>;

// ────────────────────────────────────────────────────────────────────────────
// Legacy Google Translate worker
// ────────────────────────────────────────────────────────────────────────────

/** Handler body of the internal query `getTranslationForTextLanguage`. */
export async function getTranslationForTextLanguageHandler(
  ctx: QueryCtx,
  args: { textId: Id<'texts'>; targetLanguage: string },
): Promise<{
  translatedText: string;
  romanizedText?: string;
  regionVariant?: string;
} | null> {
  const row = await ctx.db
    .query('translations')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
    )
    .first();
  if (!row) return null;
  return {
    translatedText: row.translatedText,
    romanizedText: row.romanizedText,
    regionVariant: row.regionVariant,
  };
}

/** Handler body of the internal action `processTranslationForCard`. */
export async function processTranslationForCardHandler(
  ctx: ActionCtx,
  args: ProcessTranslationForCardArgs,
): Promise<null> {
  const existingRow: {
    translatedText: string;
    romanizedText?: string;
    regionVariant?: string;
  } | null = await ctx.runQuery(
    internal.features.decks.getTranslationForTextLanguage,
    {
      textId: args.textId,
      targetLanguage: args.targetLanguage,
    },
  );

  // Mixed-dialect targets (today: es_mixed) pick a deterministic
  // sub-variant per text. The Google translate target is the sub-code so
  // we get regional spelling/vocab; the persisted row keeps the mixed
  // code as `targetLanguage` and records the chosen variant.
  //
  // Variant pin: prefer the existing row's persisted regionVariant, then
  // the pre-delete capture (`preferredRegionVariant`), then a fresh
  // deterministic pick. Regeneration must not flip the card's dialect.
  // All three resolve to null for non-mixed targets.
  const mixed =
    (existingRow?.regionVariant
      ? getMixedVariantByRegion(args.targetLanguage, existingRow.regionVariant)
      : null) ??
    (args.preferredRegionVariant
      ? getMixedVariantByRegion(
          args.targetLanguage,
          args.preferredRegionVariant,
        )
      : null) ??
    resolveMixedVariant(args.targetLanguage, args.textId as string);
  const translateTarget = mixed ? mixed.subCode : args.targetLanguage;
  const regionVariant = mixed?.regionVariant;

  let translation: string;
  let romanizedText: string | undefined;

  // Honor `replaceExisting`: a retranslation that fell back to Google
  // must Google-translate fresh rather than reuse the stale existing
  // translatedText, otherwise the audio would be regenerated against
  // an unchanged translation and we'd write the same row back.
  const reuseExisting = !args.replaceExisting && existingRow !== null;
  if (reuseExisting) {
    translation = existingRow!.translatedText;
    // `=== undefined`: respect the empty-string sentinel from a prior
    // failed attempt so we don't keep re-running the 3-retry burst.
    if (
      ROMANIZATION_LANGUAGES.has(translateTarget) &&
      existingRow!.romanizedText === undefined
    ) {
      try {
        romanizedText = await romanizeText(translation, translateTarget);
      } catch {
        // 3 retries already exhausted. Persist sentinel so subsequent
        // ensureContent runs see "tried" and skip rescheduling.
        romanizedText = '';
      }
    } else {
      romanizedText = existingRow!.romanizedText;
    }
  } else {
    // Post-process before romanization so the derived romanizedText is
    // computed from the cleaned text.
    const translateStartedAt = Date.now();
    translation = postProcessTranslation(
      translateTarget,
      await translateText(args.text, args.sourceLanguage, translateTarget),
    );
    // Google bills per character of source text. This is the final fallback
    // after the LLM stage chain has given up, so its volume doubles as a
    // health signal for the LLM translation pipeline.
    await captureGeneration(ctx, {
      distinctId: args.requestedByUserId,
      feature: 'machine_translation',
      model: 'google-translate-v2',
      provider: 'google',
      latencyMs: Date.now() - translateStartedAt,
      costUsd: costForCharacters('googleTranslate', args.text.length),
      sharedContent: true,
      extra: {
        text_id: args.textId,
        target_language: translateTarget,
        character_count: args.text.length,
      },
    });
    if (ROMANIZATION_LANGUAGES.has(translateTarget)) {
      try {
        romanizedText = await romanizeText(translation, translateTarget);
      } catch (err) {
        // 3 retries already exhausted. Persist the empty-string
        // sentinel so ensureContent doesn't reschedule another burst.
        console.error(
          `Romanization failed for ${args.targetLanguage} (persisting sentinel):`,
          err instanceof Error ? err.message : err,
        );
        romanizedText = '';
      }
    }
  }

  const voiceName = regionVariant
    ? getVoiceForLanguageVariant(
        args.targetLanguage,
        regionVariant,
        args.audioSpeakerGender,
      )
    : getVoiceForLanguage(args.targetLanguage, args.audioSpeakerGender);

  // Source travels with the romanization value (real or sentinel) so a
  // future strategy swap can target rows produced by the old method.
  // Resolved from `translateTarget` (the actual code romanizeText was
  // given) so mixed dialects record the sub-code's source.
  const romanizationSource =
    romanizedText !== undefined
      ? getRomanizationSource(translateTarget)
      : undefined;

  await ctx.runMutation(
    internal.features.decks.storeTranslationAndScheduleTTS,
    {
      textId: args.textId,
      targetLanguage: args.targetLanguage,
      translatedText: translation,
      voiceName,
      romanizedText,
      romanizationSource,
      // Legacy Google Translate path (used as the fallback when the LLM
      // queue's stage chain exhausts, or for languages explicitly pinned
      // to `translationProvider: 'google'`).
      translationSource: GOOGLE_TRANSLATE_SOURCE,
      regionVariant,
      replaceExisting: args.replaceExisting,
      speakerGender: asVoiceGender(args.audioSpeakerGender),
      expectedClaimId: args.claimId,
      skipTts: args.skipTts,
      priority: args.priority,
      retranslationAuditId: args.retranslationAuditId,
    },
  );

  return null;
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
  /** Which of the three write shapes ran. */
  outcome: 'inserted' | 'replaced' | 'metadata_filled';
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
 *  - backstop at the write choke point: no job may overwrite existing wording
 *    on a user-created card, whatever enqueued it. Callers already refuse to
 *    ask (`flagTranslation` short-circuits on user-created texts, and
 *    `updateEssentialGreetings` only targets premade rows), so no live path
 *    reaches this today. It is defence in depth against a future caller.
 *    Deliberately scoped to the OVERWRITE. The `existing &&` is load-bearing,
 *    and NOT for the fill-a-missing-language path: that one never sets
 *    `replaceExisting` (see `scheduleTranslationForLanguage`), so the guard is
 *    inert there either way. It matters for `onGoogleFallbackComplete`, which
 *    forwards the original job's `replaceExisting: true` into a re-enqueue,
 *    by the time that lands, the row it meant to replace may have been swept,
 *    and refusing then would leave the card with no translation at all.
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

  const existing = await ctx.db
    .query('translations')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
    )
    .first();

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
  await ctx.db.insert('translations', {
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
    // Freshly produced row → stamp the language's current method version.
    translationVersion: getCurrentTranslationVersion(args.targetLanguage),
  });
  return {
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
 * drops the language's audio rows (all voices, reference-aware; keepAsset
 * because a retranslation is a content change — the old recording is still
 * correct audio of the old sentence and stays cached). Returns true when the
 * audio was kept (and TTS must not be enqueued).
 */
async function invalidateAudioIfAudiblyChanged(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
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
  }> = {
    translatedText,
    // A retranslation is freshly produced → stamp the current method version.
    translationVersion: getCurrentTranslationVersion(args.targetLanguage),
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
    outcome: 'replaced',
    audioUnchangedBySound,
    searchableContentChanged: true,
    ipaMissingAfterWrite: true,
    furiganaMissingAfterWrite: true,
  };
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
    write.outcome === 'replaced' && write.audioUnchangedBySound
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
): Promise<void> {
  if (write.ipaMissingAfterWrite && IPA_LANGUAGES.has(args.targetLanguage)) {
    await ctx.scheduler.runAfter(
      0,
      internal.features.ipa.processIpaForTranslation,
      {
        textId: args.textId,
        text: translatedText,
        language: args.targetLanguage,
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

  const existingAudio = await ctx.db
    .query('audioRecordings')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', args.textId).eq('language', args.targetLanguage),
    )
    .first();

  if (!existingAudio) {
    // A translation just landed. Check the content-addressed store before
    // spending synthesis: another text with this exact string (same
    // language, gender, dialect) may already have fresh audio, in which
    // case attaching the pointer is all that's needed. Any drift the
    // existing-audio skip above leaves behind (e.g. a stale gender) is the
    // sweep's job, which reads through the same asset payload.
    const voiceGender = getVoiceGenderByApiCode(args.voiceName);
    const asset =
      voiceGender !== undefined
        ? await findReusableAudioAsset(ctx, {
            language: args.targetLanguage,
            voiceGender,
            regionVariant: args.regionVariant,
            spokenText: translatedText,
          })
        : null;
    if (asset) {
      await upsertAudioPointer(
        ctx,
        args.textId,
        args.targetLanguage,
        asset._id,
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
        });
      }
    }
  }
}

/**
 * Handler body of `storeTranslationAndScheduleTTS`: guard → post-process →
 * one of three row writes (insert / replace / fill-metadata) → audit
 * resolution → follow-ups (search rebuild, IPA/furigana, TTS). See the arg
 * validator docs above for the semantics of each mode.
 */
export async function storeTranslationAndScheduleTTSHandler(
  ctx: MutationCtx,
  args: StoreTranslationAndScheduleTtsArgs,
): Promise<null> {
  const gate = await guardTranslationWrite(ctx, args);
  if (gate === null) return null;
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
      ? await replaceTranslationRow(
          ctx,
          args,
          existing,
          translatedText,
          romanizedText,
        )
      : await fillTranslationMetadata(ctx, args, existing, romanizedText);

  await resolveAuditForWriteOutcome(ctx, args, write, translatedText);

  if (write.searchableContentChanged) {
    await scheduleSearchableTextRebuild(ctx, args.textId);
  }

  await scheduleAnnotationRegeneration(ctx, args, write, translatedText);

  // `audioUnchangedBySound`: the retained audio row already serves this
  // (text, language), skip outright.
  if (write.audioUnchangedBySound) {
    return null;
  }
  await scheduleTtsForLandedTranslation(ctx, args, translatedText);
  return null;
}
