import { v, Infer } from 'convex/values';
import {
  NonRetryableError,
  vOnCompleteArgs,
  type WorkId,
} from '@convex-dev/workpool';
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
import { llmPool, llmWarmPool } from '../lib/workpools';
import {
  asVoiceGender,
  llmPriorityValidator,
  ttsPriorityValidator,
  voiceGenderValidator,
  type LlmPriority,
  type VoiceGender,
} from '../types';
import { captureGeneration } from '../lib/posthogAi';

/**
 * LLM translation pipeline, built on the `llmPool` / `llmWarmPool` workpools
 * (convex/lib/workpools.ts; the tier comes from `llmPriority`, see
 * `llmPriorityValidator`). Per translation:
 *
 *   1. `claimLlmTranslationIfAvailable` (called from `scheduleMissingContent`
 *      / `flagTranslation`) atomically reserves the (textId, language) slot.
 *   2. `enqueueLlmTranslation` enqueues `processLlmTranslationForCard` into
 *      the pool and stamps the pool's workId onto the claim: the claim now
 *      lives exactly as long as the pool job.
 *   3. The worker calls `translateTextWithLLM` (with the language's model-
 *      stage fallback chain). On success it writes via
 *      `storeTranslationAndScheduleTTS` (the same mutation the Google path
 *      uses, so romanization/TTS downstream is unchanged). On failure it
 *      THROWS: the pool retries with jittered exponential backoff.
 *   4. `onLlmTranslationComplete` (guaranteed to run on success, failure, and
 *      cancellation) releases the claim: or, when the pool's retry budget is
 *      exhausted, enqueues the Google Translate fallback and re-points the
 *      claim at the fallback job. `onGoogleFallbackComplete` then releases it.
 */

/**
 * Per-(textId, language) LLM claim freshness window. The claim is released by
 * the pool job's onComplete (guaranteed), so staleness is only a catastrophic
 * backstop, e.g. the onComplete handler itself failing. Generous on purpose:
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
 * Would `claimLlmTranslationIfAvailable` at `priority` return null against this
 * claim? The read-only mirror of that function's fresh-vs-takeover rule, split
 * out so the two can't drift. A fresh claim blocks, EXCEPT a background claim
 * checked at interactive priority (the takeover case, which would write).
 */
function llmClaimBlocksPriority(
  claim: Doc<'llmTranslationClaims'>,
  priority: LlmPriority | undefined,
): boolean {
  const fresh = isClaimFresh(claim);
  const takeover =
    fresh && claim.priority === 'background' && priority !== 'background';
  return fresh && !takeover;
}

/**
 * True when a claim exists that `claimLlmTranslationIfAvailable` at `priority`
 * would respect (return null against). Used by the probe path in
 * `scheduleTranslationForLanguage`: a background-held slot probed at
 * interactive priority must classify as NEEDY, because the real run would take
 * the claim over (cancel the warm job, re-enqueue interactively), and that is a
 * write. A priority-blind check would report it handled and leave the user
 * waiting out `llmWarmPool`'s queue.
 */
export async function hasBlockingLlmClaim(
  ctx: QueryCtx | MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
  priority: LlmPriority | undefined,
): Promise<boolean> {
  const existing = await getLlmClaim(ctx, textId, targetLanguage);
  return existing !== null && llmClaimBlocksPriority(existing, priority);
}

/**
 * Atomically check-and-insert an LLM translation claim. Returns the new claim's
 * `_id` iff the caller acquired the claim (and should enqueue the job), or null
 * when a fresh claim already holds the slot. Stale claims (older than
 * CLAIM_STALE_MS) are reclaimed.
 *
 * One exception to "fresh claim wins", mirroring `claimTtsIfAvailable`: an
 * interactive caller takes over a fresh claim held at priority 'background'.
 * The warmup translates exactly the texts a new user hits during onboarding,
 * so this collision is the normal path, not an edge case, and without takeover
 * the user's request would no-op and then wait out the low-parallelism warm
 * pool. The takeover cancels the warm job (a queued one dies; one already
 * mid-run finishes, but the caller's enqueue re-stamps `workId` in this same
 * transaction, so the superseded job's ownership-gated completion can't release
 * the new claim). Background callers never take over anything.
 */
export async function claimLlmTranslationIfAvailable(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
  priority?: LlmPriority,
): Promise<Id<'llmTranslationClaims'> | null> {
  const existing = await getLlmClaim(ctx, textId, targetLanguage);

  if (existing) {
    if (llmClaimBlocksPriority(existing, priority)) {
      return null;
    }
    // Not blocking = stale, or a fresh background claim this caller takes
    // over. Only the takeover has a live warm job to cancel.
    if (isClaimFresh(existing) && existing.workId !== undefined) {
      await llmWarmPool.cancel(ctx, existing.workId as WorkId);
    }
    await ctx.db.delete(existing._id);
  }

  return await ctx.db.insert('llmTranslationClaims', {
    textId,
    targetLanguage,
    claimedAt: Date.now(),
    priority,
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
  // preview (`requestPreviewTranslations`), audio there is generated only on
  // an explicit audio-icon click, or by the normal ensure path once the text
  // becomes a card.
  skipTts: v.optional(v.boolean()),
  // TTS priority, forwarded to `storeTranslationAndScheduleTTS` so the audio
  // this translation triggers lands in the tier the content was requested at
  // (warm sweeps pass 'background'). See ttsPriorityValidator.
  priority: v.optional(ttsPriorityValidator),
  // Tier THIS translation runs at, as opposed to `priority` above, which is
  // about the audio it triggers. Read only by `enqueueLlmTranslation`, to pick
  // the pool and to stamp the claim; the worker itself makes no scheduling
  // decisions, so it is deliberately NOT forwarded into the worker's args.
  // The Google fallback reads its copy from the completion context below.
  // See llmPriorityValidator.
  llmPriority: v.optional(llmPriorityValidator),
  // Wording a user typed when manually editing a curriculum card's
  // translation, forwarded to the prompt as a fenced, sanitized
  // <user_suggested_translation> hint. Set only by
  // `suggestCurriculumFixesForEdit` (features/scheduling.ts).
  //
  // Deliberately absent from `llmCompletionContextValidator` below: the
  // Google Translate fallback has nowhere to put a suggestion, so leaving the
  // field out of the completion context makes it structurally impossible for
  // one to leak down that path.
  userSuggestedTranslation: v.optional(v.string()),
  // ── Gendered-variant mode (speaker-gender preference) ──
  // When `variantId` is set, this job produces a `translationVariants` row
  // instead of the base `translations` row: the prompt's <speaker_gender>
  // is forced to `variantGender` (everything else — register, addressee,
  // referent, arc context — stays as stored on the text), and the result is
  // written via `storeTranslationVariantAndScheduleTTS` (decks.ts), which
  // also chains asset-only TTS at the variant gender. Variant jobs hold no
  // `llmTranslationClaims` row (the pending variant row is its own claim,
  // see convex/schema.ts) and never fall back to Google Translate — Google
  // has no notion of speaker gender, so a failed variant simply stays
  // missing (readers keep serving the base row) until a later ensure pass
  // retries. Both fields travel together; `enqueueVariantTranslation` is the
  // only producer.
  variantId: v.optional(v.id('translationVariants')),
  variantGender: v.optional(voiceGenderValidator),
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
  priority: v.optional(ttsPriorityValidator),
  llmPriority: v.optional(llmPriorityValidator),
});

type LlmJobArgs = Infer<typeof llmJobArgsValidator>;

// Explicit handler param types throughout this file: handlers reference
// same-file functions via `internal.…` (enqueue → worker → onComplete), and
// letting TS infer their types through the generated `internal` object is
// circular. Inference collapses to `any` for every handler in the module.
type PoolRunResult =
  | { kind: 'success'; returnValue: unknown }
  | { kind: 'failed'; error: string }
  | { kind: 'canceled' };

/**
 * Enqueue an LLM translation into the pool and stamp the pool's workId onto
 * the (textId, language) claim. Enqueue and claim update commit atomically,
 * so the claim is released exactly when THIS job's onComplete runs and a
 * superseded job's completion can't delete a newer owner's claim. The claim's
 * `_id` also rides along in the worker args (`claimId`) as the single-writer
 * token for the eventual `storeTranslationAndScheduleTTS` write.
 *
 * No-ops when a live pool job already owns the claim (fresh + foreign
 * workId), see the guard below.
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

    // Priority = pool choice: interactive jobs go to llmPool, warm sweeps to
    // the low-parallelism llmWarmPool (see workpools.ts). Both pools share
    // onLlmTranslationComplete, so claim lifetime is identical either way.
    const pool = args.llmPriority === 'background' ? llmWarmPool : llmPool;
    const workId: string = await pool.enqueueAction(
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
        priority: args.priority,
        userSuggestedTranslation: args.userSuggestedTranslation,
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
          priority: args.priority,
          llmPriority: args.llmPriority,
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
    // Read metadata off the texts row. The worker is the single source of
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
    // deterministic pick, so a regeneration can never flip the card's
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
    // Validate the rule override before passing it through. An unknown
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
      // languages. Deterministic config error, retrying can't help, so
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

    // Gendered-variant jobs force the speaker gender the variant is being
    // produced for; everything else in the prompt stays as stored so the
    // variant differs from the base row ONLY along the speaker-gender axis.
    const speakerGender = args.variantGender
      ? args.variantGender
      : text.speakerGender === 'male' ||
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
    // e.g. a model-swap migration. Must NOT see the "the user flagged
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
      // No gate needed, unlike previousTranslation: this arrives only from
      // `suggestCurriculumFixesForEdit`, which sets it exactly when the
      // "a user thinks this is wrong" framing is true. buildPrompt sanitizes
      // it before it reaches the model.
      userSuggestedTranslation: args.userSuggestedTranslation,
    } as const;

    // Run each stage of the resolved translation rule in order. The first
    // success wins; on truncated / empty / HTTP error we try the next
    // fallback. Track which stage produced the winning result so it can be
    // persisted as `translationSource`. If the whole chain fails, THROW.
    // The pool retries this job with backoff, and after the last attempt
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
        // flags calls whose output-token count dwarfs the visible text. The
        // tell for providers that ignore `reasoning: {enabled: false}` and
        // silently bill thinking tokens (observed on Luna's Azure endpoints
        // during the Aug 2026 eval).
        const bo = await translateBestOfN({ ...promptArgs, stage });
        // Capture outside the closure: the `stage.samples` narrowing from
        // the enclosing if doesn't survive into the callback.
        const sampleTotal = stage.samples.total;
        // Independent captures. Fire together instead of serializing up to
        // N+1 awaited PostHog writes.
        await Promise.all(bo.telemetryList.map(async (t) => {
          const visibleTokenEstimate =
            t.visibleTextLength !== undefined
              ? Math.max(16, Math.ceil(t.visibleTextLength / 2))
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
              strategy: `bo${sampleTotal}`,
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
        }));
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
            // Reused by every user who reaches this sentence. See the
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

    // Gendered-variant jobs write the variant row (+ chained asset-only TTS)
    // and stop: the base `translations` row is not theirs to touch.
    if (args.variantId !== undefined && args.variantGender !== undefined) {
      await ctx.runMutation(
        internal.features.decks.storeTranslationVariantAndScheduleTTS,
        {
          variantId: args.variantId,
          translatedText: result.text,
          voiceName,
          romanizedText,
          romanizationSource,
          translationSource,
          regionVariant,
          priority: args.priority,
        },
      );
      return null;
    }

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
        priority: args.priority,
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
 *   job still owns the claim: a superseded job spawning one would race the
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
    // Stay on the tier the LLM attempt ran at: a warm translation's fallback
    // must not jump onto the interactive pool.
    const fallbackPool =
      context.llmPriority === 'background' ? llmWarmPool : llmPool;
    const fallbackWorkId: string = await fallbackPool.enqueueAction(
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
        priority: context.priority,
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
 * path in `scheduleMissingContent`, which holds no claim. The lookup then
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

// ─── Gendered translation variants (speaker-gender preference) ─────────────

/**
 * Point-read the (textId, targetLanguage, speakerGender) variant row, if any.
 * Shared by the reader overlay (convex/lib/cardContent.ts) and the scheduler
 * (`scheduleMissingContent` in decks.ts).
 */
export async function getTranslationVariant(
  ctx: QueryCtx | MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
  speakerGender: VoiceGender,
): Promise<Doc<'translationVariants'> | null> {
  return await ctx.db
    .query('translationVariants')
    .withIndex('by_text_language_and_gender', (q) =>
      q
        .eq('textId', textId)
        .eq('targetLanguage', targetLanguage)
        .eq('speakerGender', speakerGender),
    )
    .first();
}

/**
 * True while a pending variant row's generation claim is fresh. A ready row
 * (translatedText set) is never "in flight"; a pending row with a stale (or
 * absent) claimedAt is re-claimable — its worker died or was never enqueued.
 * Shares CLAIM_STALE_MS with the base-translation claims so the two paths
 * back off identically.
 */
export function isVariantGenerationFresh(
  variant: Pick<Doc<'translationVariants'>, 'translatedText' | 'claimedAt'>,
): boolean {
  if (variant.translatedText !== undefined) return false;
  return (
    variant.claimedAt !== undefined &&
    Date.now() - variant.claimedAt < CLAIM_STALE_MS
  );
}

/**
 * Claim-and-enqueue for one gendered translation variant. The pending
 * variant row IS the claim (claimedAt/workId live on it — see the schema
 * comment for why `llmTranslationClaims` can't grow a gender dimension), so
 * this helper creates or re-claims the row and enqueues the shared worker in
 * variant mode. Returns true iff a job was enqueued.
 *
 * Callers gate on `isVariantGenerationFresh` themselves (the scheduler batch-
 * reads variant rows); this helper re-checks nothing beyond row existence so
 * it stays a single-writer under the calling mutation's transaction.
 */
export async function claimAndEnqueueVariantTranslation(
  ctx: MutationCtx,
  args: {
    textId: Id<'texts'>;
    sourceLanguage: string;
    targetLanguage: string;
    text: string;
    variantGender: VoiceGender;
    existingVariant: Doc<'translationVariants'> | null;
    priority?: Infer<typeof ttsPriorityValidator>;
    llmPriority?: LlmPriority;
  },
): Promise<boolean> {
  const variantId =
    args.existingVariant?._id ??
    (await ctx.db.insert('translationVariants', {
      textId: args.textId,
      targetLanguage: args.targetLanguage,
      speakerGender: args.variantGender,
      claimedAt: Date.now(),
    }));
  if (args.existingVariant) {
    await ctx.db.patch(variantId, { claimedAt: Date.now() });
  }

  const pool = args.llmPriority === 'background' ? llmWarmPool : llmPool;
  const workId: string = await pool.enqueueAction(
    ctx,
    internal.features.llmTranslationQueue.processLlmTranslationForCard,
    {
      textId: args.textId,
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
      text: args.text,
      // Voice pick inside the worker keys off this, so the chained TTS
      // speaks at the variant's gender.
      audioSpeakerGender: args.variantGender,
      priority: args.priority,
      variantId,
      variantGender: args.variantGender,
    },
    {
      onComplete:
        internal.features.llmTranslationQueue.onVariantTranslationComplete,
      context: { variantId },
    },
  );
  await ctx.db.patch(variantId, { workId });
  return true;
}

/**
 * Pool onComplete for variant-mode `processLlmTranslationForCard` runs.
 * Success clears nothing (the store mutation already released the claim
 * fields when it wrote the text). Failure/cancellation releases the claim —
 * ownership-gated on workId — so a later ensure pass can retry; there is no
 * Google fallback for variants (see the validator comment).
 */
export const onVariantTranslationComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ variantId: v.id('translationVariants') })),
  returns: v.null(),
  handler: async (
    ctx: MutationCtx,
    {
      workId,
      context,
      result,
    }: {
      workId: string;
      context: { variantId: Id<'translationVariants'> };
      result: PoolRunResult;
    },
  ) => {
    if (result.kind === 'success') return null;
    const variant = await ctx.db.get(context.variantId);
    if (!variant) return null;
    if (variant.workId !== undefined && variant.workId !== workId) return null;
    if (variant.translatedText !== undefined) return null;
    if (result.kind === 'failed') {
      console.warn('[llmTranslationQueue] variant translation failed — releasing claim', {
        variantId: context.variantId,
        textId: variant.textId,
        targetLanguage: variant.targetLanguage,
        speakerGender: variant.speakerGender,
        error: result.error,
      });
    }
    // Pending row, owned by this job: release the claim fields so the row is
    // re-claimable. The row itself stays as a marker of the attempt.
    await ctx.db.patch(context.variantId, {
      claimedAt: undefined,
      workId: undefined,
    });
    return null;
  },
});

/**
 * Stable male/female pick for legacy rows missing `referentGender`.
 *
 * MUST match the seeding rule of the (since-removed) one-time metadata
 * backfill. `stableCoinFlip(pickSeedKey(doc), 'referent')` in
 * `convex/admin/backfillTextMetadata.ts`, see git history, so a row
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
 * chronological (collectionRank ASC) order. The target's neighbors but not
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
