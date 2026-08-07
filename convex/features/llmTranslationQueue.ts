import { v, Infer } from 'convex/values';
import { NonRetryableError, vOnCompleteArgs } from '@convex-dev/workpool';
import {
  internalAction,
  internalMutation,
  internalQuery,
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc, Id } from '../_generated/dataModel';
import {
  translateBestOfN,
  translateTextWithLLM,
  type ReasoningEffort,
} from './translationLLM';
import {
  getMixedVariantByRegion,
  getTranslationConfigForLanguage,
  getTranslationSourceFromStage,
  getVoiceForLanguage,
  getVoiceForLanguageVariant,
  isMixedLanguage,
  resolveMixedVariant,
  resolveTranslationStages,
  ROMANIZATION_LANGUAGES,
  TRANSLATION_RULES,
  type TranslationRuleId,
} from '../../lib/languages';
import { romanizeText } from './translation';
import { getRomanizationSource } from '../lib/localRomanization';
import { llmPool } from '../lib/workpools';
import { asVoiceGender } from '../types';
import { captureGeneration } from '../lib/posthogAi';

/**
 * LLM translation pipeline, built on the `llmPool` workpool
 * (convex/lib/workpools.ts). Per translation:
 *
 *   1. `claimLlmTranslationIfAvailable` (called from `scheduleMissingContent`
 *      / `flagTranslation`) atomically reserves the (textId, language) slot.
 *   2. `enqueueLlmTranslation` enqueues `processLlmTranslationForCard` into
 *      the pool and stamps the pool's workId onto the claim — the claim now
 *      lives exactly as long as the pool job.
 *   3. The worker calls `translateTextWithLLM` (with the language's model-
 *      stage fallback chain). On success it writes via
 *      `storeTranslationAndScheduleTTS` (the same mutation the Google path
 *      uses, so romanization/TTS downstream is unchanged). On failure it
 *      THROWS — the pool retries with jittered exponential backoff.
 *   4. `onLlmTranslationComplete` (guaranteed to run on success, failure, and
 *      cancellation) releases the claim — or, when the pool's retry budget is
 *      exhausted, enqueues the Google Translate fallback and re-points the
 *      claim at the fallback job. `onGoogleFallbackComplete` then releases it.
 */

/**
 * Per-(textId, language) LLM claim freshness window. The claim is released by
 * the pool job's onComplete (guaranteed), so staleness is only a catastrophic
 * backstop — e.g. the onComplete handler itself failing. Generous on purpose:
 * a pool job (retries included) can legitimately run for several minutes, and
 * a premature "stale" verdict makes a concurrent reconcile double-enqueue.
 * Exported so callers like `scheduleMissingContent` can decide whether to
 * defer a TTS enqueue while an LLM retranslation is in flight for the row.
 */
export const CLAIM_STALE_MS = 10 * 60 * 1000;

/** Point-read the (textId, targetLanguage) LLM translation claim, if any. */
export async function getLlmClaim(
  ctx: QueryCtx | MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
): Promise<Doc<'llmTranslationClaims'> | null> {
  return await ctx.db
    .query('llmTranslationClaims')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('targetLanguage', targetLanguage),
    )
    .first();
}

/** True while the claim is inside its CLAIM_STALE_MS freshness window. */
export function isClaimFresh(claim: { claimedAt: number }): boolean {
  return Date.now() - claim.claimedAt < CLAIM_STALE_MS;
}

/**
 * Retry budget for the Google fallback job (the LLM pool default of 8
 * attempts belongs to the quality path; the fallback is a last resort and
 * fails terminally after 3).
 */
const GOOGLE_FALLBACK_RETRY = {
  maxAttempts: 3,
  initialBackoffMs: 2_000,
  base: 3,
} as const;

/**
 * Atomically check-and-insert an LLM translation claim. Returns the new claim's
 * `_id` iff the caller acquired the claim (and should enqueue the job), or null
 * when a fresh claim already holds the slot. Stale claims (older than
 * CLAIM_STALE_MS) are reclaimed.
 */
export async function claimLlmTranslationIfAvailable(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
): Promise<Id<'llmTranslationClaims'> | null> {
  const existing = await getLlmClaim(ctx, textId, targetLanguage);

  if (existing) {
    if (isClaimFresh(existing)) {
      return null;
    }
    await ctx.db.delete(existing._id);
  }

  return await ctx.db.insert('llmTranslationClaims', {
    textId,
    targetLanguage,
    claimedAt: Date.now(),
  });
}

const llmJobArgsValidator = v.object({
  textId: v.id('texts'),
  sourceLanguage: v.string(),
  targetLanguage: v.string(),
  text: v.string(),
  audioSpeakerGender: v.optional(v.string()),
  // Retranslation flag forwarded to `storeTranslationAndScheduleTTS` (and
  // through the fallback to `processTranslationForCard`). Set by
  // `flagTranslation` so the new LLM output overwrites the displayed text.
  replaceExisting: v.optional(v.boolean()),
  // Optional rule override forwarded to `resolveTranslationStages`. Used by
  // `flagTranslation` to force the `retranslation_high` chain regardless of
  // the language's normal routing. Worker validates against TRANSLATION_RULES
  // and silently falls back to the language's rule on unknown values.
  ruleOverride: v.optional(v.string()),
  // Single-writer token: the claim doc this job was enqueued under (stamped
  // by `enqueueLlmTranslation` from its own claim lookup). The worker forwards
  // it to `storeTranslationAndScheduleTTS` as `expectedClaimId`, so a job
  // whose claim was reclaimed mid-flight (delete + reinsert → new _id) skips
  // its write instead of clobbering the new owner's result.
  claimId: v.optional(v.id('llmTranslationClaims')),
  // Mixed-dialect pin: the `regionVariant` of a translation row that was
  // deleted before this regeneration was enqueued (the version-stale sweep
  // captures it pre-delete). The worker prefers it over a fresh
  // `resolveMixedVariant` pick so a card's dialect never flips on regen.
  preferredRegionVariant: v.optional(v.string()),
  // Translation-only mode: forwarded to `storeTranslationAndScheduleTTS` so
  // the landing translation does NOT auto-enqueue TTS. Set by the collection
  // preview (`requestPreviewTranslations`) — audio there is generated only on
  // an explicit audio-icon click, or by the normal ensure path once the text
  // becomes a card.
  skipTts: v.optional(v.boolean()),
});

/** onComplete context: everything the Google fallback needs to run. */
const llmCompletionContextValidator = v.object({
  textId: v.id('texts'),
  sourceLanguage: v.string(),
  targetLanguage: v.string(),
  text: v.string(),
  audioSpeakerGender: v.optional(v.string()),
  replaceExisting: v.optional(v.boolean()),
  preferredRegionVariant: v.optional(v.string()),
  skipTts: v.optional(v.boolean()),
});

type LlmJobArgs = Infer<typeof llmJobArgsValidator>;

// Explicit handler param types throughout this file: handlers reference
// same-file functions via `internal.…` (enqueue → worker → onComplete), and
// letting TS infer their types through the generated `internal` object is
// circular — inference collapses to `any` for every handler in the module.
type PoolRunResult =
  | { kind: 'success'; returnValue: unknown }
  | { kind: 'failed'; error: string }
  | { kind: 'canceled' };

/**
 * Enqueue an LLM translation into the pool and stamp the pool's workId onto
 * the (textId, language) claim — enqueue and claim update commit atomically,
 * so the claim is released exactly when THIS job's onComplete runs and a
 * superseded job's completion can't delete a newer owner's claim. The claim's
 * `_id` also rides along in the worker args (`claimId`) as the single-writer
 * token for the eventual `storeTranslationAndScheduleTTS` write.
 *
 * No-ops when a live pool job already owns the claim (fresh + foreign
 * workId) — see the guard below.
 *
 * The caller is expected to hold the claim already (via
 * `claimLlmTranslationIfAvailable`, usually in the same transaction).
 */
export const enqueueLlmTranslation = internalMutation({
  args: {
    args: llmJobArgsValidator,
  },
  returns: v.null(),
  handler: async (ctx: MutationCtx, { args }: { args: LlmJobArgs }) => {
    const claim = await getLlmClaim(ctx, args.textId, args.targetLanguage);
    // A fresh claim already stamped with another job's workId means a live
    // pool job owns this (textId, language): enqueueing again would run the
    // translation twice and hijack that job's claim. Unreachable from the
    // claim-then-enqueue callers (their fresh claim is workId-less); kept as
    // a guard against callers that enqueue without re-claiming.
    if (claim && claim.workId !== undefined && isClaimFresh(claim)) {
      return null;
    }

    const workId: string = await llmPool.enqueueAction(
      ctx,
      internal.features.llmTranslationQueue.processLlmTranslationForCard,
      {
        textId: args.textId,
        sourceLanguage: args.sourceLanguage,
        targetLanguage: args.targetLanguage,
        text: args.text,
        audioSpeakerGender: args.audioSpeakerGender,
        replaceExisting: args.replaceExisting,
        ruleOverride: args.ruleOverride,
        claimId: claim?._id,
        preferredRegionVariant: args.preferredRegionVariant,
        skipTts: args.skipTts,
      },
      {
        onComplete:
          internal.features.llmTranslationQueue.onLlmTranslationComplete,
        context: {
          textId: args.textId,
          sourceLanguage: args.sourceLanguage,
          targetLanguage: args.targetLanguage,
          text: args.text,
          audioSpeakerGender: args.audioSpeakerGender,
          replaceExisting: args.replaceExisting,
          preferredRegionVariant: args.preferredRegionVariant,
          skipTts: args.skipTts,
        },
      },
    );

    if (claim) {
      await ctx.db.patch(claim._id, { workId, claimedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Worker action: read the texts row for metadata, call the LLM (running the
 * language's model-stage fallback chain in-call), and write the result via
 * `storeTranslationAndScheduleTTS` (same path as Google).
 *
 * Failure contract: THROW on any failure. The pool retries with backoff up to
 * its budget; the final failure lands in `onLlmTranslationComplete`, which
 * schedules the Google fallback. Config errors (a non-openrouter language
 * reaching this worker) throw `NonRetryableError` so the pool skips straight
 * to the fallback instead of burning retries on a deterministic failure.
 */
export const processLlmTranslationForCard = internalAction({
  args: llmJobArgsValidator.fields,
  returns: v.null(),
  handler: async (ctx: ActionCtx, args: LlmJobArgs) => {
    // Read metadata off the texts row — the worker is the single source of
    // truth for "what speaker/addressee/referent fields land in the prompt".
    const text = await ctx.runQuery(
      internal.features.llmTranslationQueue.getTextRowForTranslation,
      { textId: args.textId },
    );
    if (!text) {
      // Cascade-deleted mid-flight. Nothing to translate; returning success
      // lets onComplete release the claim.
      console.error('[llmTranslationQueue] text row missing', {
        textId: args.textId,
      });
      return null;
    }

    // Mixed-dialect targets (today: es_mixed) resolve to a concrete sub-
    // variant per text. The LLM prompt is built using the sub-variant's
    // config so the model gets accurate region instructions, and the
    // persisted regionVariant lets the audio player synthesize with the
    // matching accent.
    //
    // Variant pin: prefer (a) the regionVariant already persisted on the
    // existing translation row, then (b) the one captured before a sweep
    // deleted the row (`preferredRegionVariant`), then (c) a fresh
    // deterministic pick — so a regeneration can never flip the card's
    // dialect out from under existing audio.
    let mixed: ReturnType<typeof resolveMixedVariant> = null;
    if (isMixedLanguage(args.targetLanguage)) {
      const existingRow = await ctx.runQuery(
        internal.features.decks.getTranslationForTextLanguage,
        { textId: args.textId, targetLanguage: args.targetLanguage },
      );
      if (existingRow?.regionVariant) {
        mixed = getMixedVariantByRegion(
          args.targetLanguage,
          existingRow.regionVariant,
        );
      }
      if (!mixed && args.preferredRegionVariant) {
        mixed = getMixedVariantByRegion(
          args.targetLanguage,
          args.preferredRegionVariant,
        );
      }
      if (!mixed) {
        mixed = resolveMixedVariant(args.targetLanguage, args.textId as string);
      }
    }
    const cfgLanguageCode = mixed ? mixed.subCode : args.targetLanguage;
    const regionVariant = mixed?.regionVariant;

    const cfg = getTranslationConfigForLanguage(cfgLanguageCode);
    // Validate the rule override before passing it through — an unknown
    // string would crash `resolveTranslationStages`. Unknown values silently
    // fall back to the language's normal routing.
    const ruleOverride =
      args.ruleOverride && args.ruleOverride in TRANSLATION_RULES
        ? (args.ruleOverride as TranslationRuleId)
        : undefined;
    const stages = resolveTranslationStages(
      cfgLanguageCode,
      text.text.length,
      ruleOverride ? { ruleOverride } : undefined,
    );
    if (cfg.provider !== 'openrouter' || stages.length === 0) {
      // Misrouted: the pool worker should only ever receive openrouter
      // languages. Deterministic config error — retrying can't help, so
      // NonRetryableError sends it straight to onComplete's Google fallback.
      throw new NonRetryableError(
        `[llmTranslationQueue] non-openrouter language reached worker: ` +
          `${args.targetLanguage} (resolved ${cfgLanguageCode}, ${stages.length} stages)`,
      );
    }

    // ── Resolve metadata for the prompt ──
    // addressesSomeone: prefer the explicit boolean; fall back to
    // (addresseeNumber !== 'not_applicable') for legacy rows.
    const addressesSomeone =
      text.addressesSomeone ??
      (text.addresseeNumber !== 'not_applicable');

    // referentGender: fall back to a deterministic coin-flip seeded the same
    // way the backfill seeds it (`externalId || _id`, salt `'referent'`), so
    // a row translated pre-backfill and again post-backfill ends up on the
    // same gender.
    const referentGender: 'male' | 'female' =
      text.referentGender === 'male' || text.referentGender === 'female'
        ? text.referentGender
        : legacyReferentGenderFallback(text.externalId, text._id as string);

    const speakerGender =
      text.speakerGender === 'male' ||
      text.speakerGender === 'female' ||
      text.speakerGender === 'neutral'
        ? (text.speakerGender as 'male' | 'female' | 'neutral')
        : undefined;

    const addresseeGender =
      addressesSomeone &&
      (text.addresseeGender === 'male' || text.addresseeGender === 'female')
        ? (text.addresseeGender as 'male' | 'female')
        : undefined;

    const formality =
      addressesSomeone &&
      (text.register === 'formal' ||
        text.register === 'informal' ||
        text.register === 'neutral')
        ? (text.register as 'formal' | 'informal' | 'neutral')
        : undefined;

    // Fetch the sliding window of arc siblings (≤ 5 preceding + ≤ 3
    // following), but only when this text has an arcId. Custom/chat and
    // legacy rows skip the lookup entirely, so they pay no extra cost.
    let arcContext:
      | { preceding: string[]; following: string[] }
      | undefined;
    if (text.arcId && text.arcId.length > 0) {
      arcContext = await ctx.runQuery(
        internal.features.llmTranslationQueue.getArcWindowForText,
        {
          collectionId: text.collectionId,
          arcId: text.arcId,
          targetRank: text.collectionRank,
        },
      );
      if (
        arcContext.preceding.length === 0 &&
        arcContext.following.length === 0
      ) {
        arcContext = undefined;
      }
    }

    // Gate the "previous translation" prompt block to flag-triggered
    // retranslations only. `flagTranslation` is the unique caller that
    // sets BOTH `replaceExisting: true` (the storage-overwrite semantic)
    // AND a flag-specific `ruleOverride` ('retranslation_high' for
    // curriculum texts, 'retranslation_custom' for user-created texts).
    // A future caller that sets `replaceExisting` for some other reason
    // — e.g. a model-swap migration — must NOT see the "the user flagged
    // this as wrong" framing, which would be a lie.
    const FLAG_TRIGGERED_RULES = new Set<string>([
      'retranslation_high',
      'retranslation_custom',
    ]);
    let previousTranslation: string | undefined;
    if (
      args.replaceExisting &&
      args.ruleOverride &&
      FLAG_TRIGGERED_RULES.has(args.ruleOverride)
    ) {
      const existing = await ctx.runQuery(
        internal.features.decks.getTranslationForTextLanguage,
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
        },
      );
      if (existing && existing.translatedText.length > 0) {
        previousTranslation = existing.translatedText;
      }
    }

    const promptArgs = {
      text: text.text,
      sourceLang: args.sourceLanguage,
      // For mixed languages, expose the resolved sub-code to the LLM (e.g.
      // 'es' or 'es_latam' rather than 'es_mixed'). The persisted row still
      // uses the mixed code as targetLanguage; only the prompt's region
      // context comes from the sub-variant.
      targetLang: cfgLanguageCode,
      targetLangName: cfg.targetLangName,
      targetLangNativeName: cfg.targetLangNativeName,
      targetRegion: cfg.targetRegion,
      addressesSomeone,
      referentGender,
      speakerGender,
      addresseeGender,
      formality,
      arcContext,
      previousTranslation,
    } as const;

    // Run each stage of the resolved translation rule in order. The first
    // success wins; on truncated / empty / HTTP error we try the next
    // fallback. Track which stage produced the winning result so it can be
    // persisted as `translationSource`. If the whole chain fails, THROW —
    // the pool retries this job with backoff, and after the last attempt
    // onComplete schedules Google Translate as the final safety net.
    let result: Awaited<ReturnType<typeof translateTextWithLLM>> | null = null;
    let winningStage: (typeof stages)[number] | null = null;
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];

      // Shared PostHog dimensions for every capture this stage produces.
      const stageExtra = {
        text_id: args.textId,
        target_language: args.targetLanguage,
        stage_index: i,
        stage_count: stages.length,
        reasoning: stage.reasoning ?? 'none',
      };

      if (stage.samples) {
        // Best-of-N stage: several candidate calls + possibly a judge, each
        // reported as its own generation event. `suspect_hidden_reasoning`
        // flags calls whose output-token count dwarfs the visible text — the
        // tell for providers that ignore `reasoning: {enabled: false}` and
        // silently bill thinking tokens (observed on Luna's Azure endpoints
        // during the Aug 2026 eval).
        const bo = await translateBestOfN({ ...promptArgs, stage });
        for (const t of bo.telemetryList) {
          const visibleTokenEstimate =
            t.role === 'candidate' && bo.result.ok
              ? Math.max(16, Math.ceil(bo.result.text.length / 2))
              : undefined;
          await captureGeneration(ctx, {
            feature: 'translation',
            model: t.model,
            provider: 'openrouter',
            latencyMs: t.latencyMs,
            inputTokens: t.inputTokens,
            outputTokens: t.outputTokens,
            costUsd: t.costUsd,
            traceId: t.generationId,
            isError: t.error !== undefined,
            error: t.error,
            sharedContent: true,
            extra: {
              ...stageExtra,
              strategy: `bo${stage.samples.total}`,
              role: t.role,
              candidate_index: t.candidateIndex,
              judge_attempt: t.judgeAttempt,
              n_unique: bo.meta.nUnique,
              judge_fallback: bo.meta.judgeFallback,
              suspect_hidden_reasoning:
                visibleTokenEstimate !== undefined &&
                t.outputTokens > 4 * visibleTokenEstimate,
            },
          });
        }
        result = bo.result;
      } else {
        result = await translateTextWithLLM({
          ...promptArgs,
          model: stage.model,
          reasoning: stage.reasoning as ReasoningEffort | undefined,
          maxOutputTokens: stage.maxOutputTokens,
          provider: stage.provider,
        });
        // One cost event per stage attempt, failures included: a stage that
        // truncates still burned tokens, and the failure rate of the cheap first
        // stage is exactly what decides whether the fallback chain is worth its
        // price. `translateTextWithLLM` has no ctx of its own, so it hands the
        // numbers back and the capture happens here.
        if (result.telemetry) {
          await captureGeneration(ctx, {
            feature: 'translation',
            model: result.telemetry.model,
            provider: 'openrouter',
            latencyMs: result.telemetry.latencyMs,
            inputTokens: result.telemetry.inputTokens,
            outputTokens: result.telemetry.outputTokens,
            costUsd: result.telemetry.costUsd,
            traceId: result.telemetry.generationId,
            isError: !result.ok,
            error: result.ok ? undefined : result.reason,
            // Reused by every user who reaches this sentence — see the
            // attribution note on `captureGeneration`.
            sharedContent: true,
            extra: stageExtra,
          });
        }
      }
      if (result.ok) {
        winningStage = stage;
        break;
      }
      if (i < stages.length - 1) {
        const next = stages[i + 1];
        console.warn('[llmTranslationQueue] stage failed — retrying with next stage', {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          stageIndex: i,
          stageModel: stage.model,
          stageReasoning: stage.reasoning,
          reason: result.reason,
          nextStageModel: next.model,
          nextStageReasoning: next.reasoning,
        });
      }
    }
    if (!result) throw new Error('Unreachable: stages.length >= 1');

    if (!result.ok) {
      // Truncation / empty / HTTP error across the whole stage chain.
      throw new Error(
        `[llmTranslationQueue] LLM stage chain failed for ${args.targetLanguage}: ` +
          `${result.reason}${result.detail ? ` — ${result.detail}` : ''}`,
      );
    }

    // Success: optionally romanize the translation, then write.
    // `romanizeText` already retries up to 3 times internally; on full
    // exhaustion we persist an empty-string sentinel so ensureContent
    // doesn't reschedule another burst on every call.
    let romanizedText: string | undefined;
    if (ROMANIZATION_LANGUAGES.has(args.targetLanguage)) {
      try {
        romanizedText = await romanizeText(result.text, args.targetLanguage);
      } catch (err) {
        console.error(
          `[llmTranslationQueue] Romanization failed for ${args.targetLanguage} (persisting sentinel):`,
          err instanceof Error ? err.message : err,
        );
        romanizedText = '';
      }
    }

    // For mixed languages, pick a voice matching the resolved regional
    // variant so the synthesized audio agrees with the persisted
    // `regionVariant`. Non-mixed languages fall through to the simple picker.
    const voiceName = regionVariant
      ? getVoiceForLanguageVariant(
        args.targetLanguage,
        regionVariant,
        args.audioSpeakerGender,
      )
      : getVoiceForLanguage(args.targetLanguage, args.audioSpeakerGender);

    // Source resolved from `cfgLanguageCode` (the sub-code for mixed
    // dialects) so the recorded source matches what `romanizeText` ran on.
    const romanizationSource =
      romanizedText !== undefined
        ? getRomanizationSource(cfgLanguageCode)
        : undefined;

    // Translation source: derived from the stage that actually produced
    // the result (not the primary), so a row that succeeded on a fallback
    // is tagged with the fallback's model/reasoning.
    const translationSource = winningStage
      ? getTranslationSourceFromStage(winningStage)
      : undefined;

    await ctx.runMutation(
      internal.features.decks.storeTranslationAndScheduleTTS,
      {
        textId: args.textId,
        targetLanguage: args.targetLanguage,
        translatedText: result.text,
        voiceName,
        romanizedText,
        romanizationSource,
        translationSource,
        regionVariant,
        replaceExisting: args.replaceExisting,
        speakerGender: asVoiceGender(args.audioSpeakerGender),
        // Single-writer gate: skip the write if the claim this job was
        // enqueued under has been reclaimed by a newer job mid-flight.
        expectedClaimId: args.claimId,
        skipTts: args.skipTts,
      },
    );
    return null;
  },
});

/**
 * Pool onComplete for `processLlmTranslationForCard`. Guaranteed to run on
 * success, failure, and cancellation.
 *
 * - success / canceled → release the claim (ownership-gated on `workId`, so
 *   a superseded job's completion can't delete a newer owner's claim).
 * - failed (pool retry budget exhausted, or NonRetryableError) → enqueue the
 *   Google Translate fallback and re-point the claim at the fallback job, so
 *   a concurrent `scheduleMissingContent` can't route the same (textId, lang)
 *   through the LLM again mid-fallback. The fallback fires ONLY while this
 *   job still owns the claim — a superseded job spawning one would race the
 *   current owner's write and duplicate provider spend.
 */
export const onLlmTranslationComplete = internalMutation({
  args: vOnCompleteArgs(llmCompletionContextValidator),
  returns: v.null(),
  handler: async (
    ctx: MutationCtx,
    {
      workId,
      context,
      result,
    }: {
      workId: string;
      context: Infer<typeof llmCompletionContextValidator>;
      result: PoolRunResult;
    },
  ) => {
    const claim = await getLlmClaim(ctx, context.textId, context.targetLanguage);
    const ownsClaim =
      claim !== null && (claim.workId === undefined || claim.workId === workId);

    if (result.kind !== 'failed') {
      if (claim && ownsClaim) {
        await ctx.db.delete(claim._id);
      }
      return null;
    }

    if (!claim || !ownsClaim) {
      // Superseded: another job reclaimed this (textId, language) while this
      // one was queued/retrying (or the claim is already gone). The current
      // owner drives its own fallback; spawning one here would race the
      // owner's write and duplicate provider spend.
      console.warn('[llmTranslationQueue] LLM attempts exhausted on a superseded job — skipping Google fallback', {
        textId: context.textId,
        targetLanguage: context.targetLanguage,
        error: result.error,
      });
      return null;
    }

    console.warn('[llmTranslationQueue] LLM attempts exhausted — falling back to Google', {
      textId: context.textId,
      targetLanguage: context.targetLanguage,
      error: result.error,
    });
    const fallbackWorkId: string = await llmPool.enqueueAction(
      ctx,
      internal.features.decks.processTranslationForCard,
      {
        textId: context.textId,
        sourceLanguage: context.sourceLanguage,
        targetLanguage: context.targetLanguage,
        text: context.text,
        audioSpeakerGender: context.audioSpeakerGender,
        replaceExisting: context.replaceExisting,
        preferredRegionVariant: context.preferredRegionVariant,
        skipTts: context.skipTts,
        // The claim keeps its _id across the re-point below, so the fallback
        // inherits the same single-writer token.
        claimId: claim._id,
      },
      {
        retry: GOOGLE_FALLBACK_RETRY,
        onComplete:
          internal.features.llmTranslationQueue.onGoogleFallbackComplete,
        context: {
          textId: context.textId,
          targetLanguage: context.targetLanguage,
        },
      },
    );
    await ctx.db.patch(claim._id, {
      workId: fallbackWorkId,
      claimedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Pool onComplete for the Google fallback (also used by the direct Google
 * path in `scheduleMissingContent`, which holds no claim — the lookup then
 * no-ops).
 *
 * Terminal failure (LLM chain AND Google both failed) deliberately KEEPS the
 * claim: letting it expire via CLAIM_STALE_MS gives a backoff before the next
 * reconcile re-drives this (textId, lang), preventing a retry hot-loop.
 */
export const onGoogleFallbackComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({ textId: v.id('texts'), targetLanguage: v.string() }),
  ),
  returns: v.null(),
  handler: async (
    ctx: MutationCtx,
    {
      workId,
      context,
      result,
    }: {
      workId: string;
      context: { textId: Id<'texts'>; targetLanguage: string };
      result: PoolRunResult;
    },
  ) => {
    if (result.kind === 'failed') {
      console.error('[llmTranslationQueue] terminal translation failure (LLM + Google both failed):', {
        textId: context.textId,
        targetLanguage: context.targetLanguage,
        error: result.error,
      });
      return null;
    }
    const claim = await getLlmClaim(ctx, context.textId, context.targetLanguage);
    if (claim && (claim.workId === undefined || claim.workId === workId)) {
      await ctx.db.delete(claim._id);
    }
    return null;
  },
});

/**
 * Stable male/female pick for legacy rows missing `referentGender`.
 *
 * MUST match the seeding rule of the (since-removed) one-time metadata
 * backfill — `stableCoinFlip(pickSeedKey(doc), 'referent')` in
 * `convex/admin/backfillTextMetadata.ts`, see git history — so a row
 * translated pre-backfill and re-translated post-backfill (with a persisted
 * value) lines up on the same gender. The seed key is the row's `externalId`
 * when present (stable across dataset re-uploads), else its `_id`.
 */
function legacyReferentGenderFallback(
  externalId: string | undefined,
  idString: string,
): 'male' | 'female' {
  const seedKey = externalId && externalId.length > 0 ? externalId : idString;
  const s = `referent|${seedKey}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 1) === 0 ? 'male' : 'female';
}

/** Internal query for the action to read the texts row inside its single-tx read window. */
export const getTextRowForTranslation = internalQuery({
  args: { textId: v.id('texts') },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id('texts'),
      externalId: v.optional(v.string()),
      text: v.string(),
      addressesSomeone: v.optional(v.boolean()),
      addresseeNumber: v.optional(v.string()),
      speakerGender: v.optional(v.string()),
      addresseeGender: v.optional(v.string()),
      register: v.optional(v.string()),
      referentGender: v.optional(v.string()),
      // Arc-context plumbing fields. Present for premade-dataset texts that
      // carry an arcId; undefined for legacy or user-created rows (which the
      // worker then skips the arc-window lookup for).
      collectionId: v.id('collections'),
      collectionRank: v.number(),
      arcId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.textId);
    if (!row) return null;
    return {
      _id: row._id,
      externalId: row.externalId,
      text: row.text,
      addressesSomeone: row.addressesSomeone,
      addresseeNumber: row.addresseeNumber,
      speakerGender: row.speakerGender,
      addresseeGender: row.addresseeGender,
      register: row.register,
      referentGender: row.referentGender,
      collectionId: row.collectionId,
      collectionRank: row.collectionRank,
      arcId: row.arcId,
    };
  },
});

const ARC_WINDOW_PRECEDING = 5;
const ARC_WINDOW_FOLLOWING = 3;

/**
 * Sliding-window arc context. Two bounded indexed range scans (≤ 5 + ≤ 3
 * documents) against `by_collection_arcId_and_rank`. Returns sentences in
 * chronological (collectionRank ASC) order — the target's neighbors but not
 * the target itself, which the caller wraps with `<target>` in the prompt.
 */
export const getArcWindowForText = internalQuery({
  args: {
    collectionId: v.id('collections'),
    arcId: v.string(),
    targetRank: v.number(),
  },
  returns: v.object({
    preceding: v.array(v.string()),
    following: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const precedingDesc = await ctx.db
      .query('texts')
      .withIndex('by_collection_arcId_and_rank', (q) =>
        q
          .eq('collectionId', args.collectionId)
          .eq('arcId', args.arcId)
          .lt('collectionRank', args.targetRank),
      )
      .order('desc')
      .take(ARC_WINDOW_PRECEDING);

    const following = await ctx.db
      .query('texts')
      .withIndex('by_collection_arcId_and_rank', (q) =>
        q
          .eq('collectionId', args.collectionId)
          .eq('arcId', args.arcId)
          .gt('collectionRank', args.targetRank),
      )
      .order('asc')
      .take(ARC_WINDOW_FOLLOWING);

    // `precedingDesc` came back in descending rank order; reverse so the
    // prompt window reads chronologically (oldest → target → newest).
    return {
      preceding: precedingDesc.reverse().map((t) => t.text),
      following: following.map((t) => t.text),
    };
  },
});
