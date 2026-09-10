import { v, Infer } from 'convex/values';
import { vOnCompleteArgs, type WorkId } from '@convex-dev/workpool';
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
  type ReasoningEffort,
  normalizeModelOutput,
  translateBestOfN,
  translateTextWithLLM,
  type TranslationPromptArgs,
} from './translationLLM';
import {
  ACCENT_REWRITE_STAGES,
  getAccentRewriteConfig,
  getMixedVariantByRegion,
  getTranslationConfigForLanguage,
  getTranslationSourceFromStage,
  getVoiceForText,
  isMixedLanguage,
  pickMixedVariantForNewRow,
  resolveMixedVariant,
  resolveTranslationStages,
  ROMANIZATION_LANGUAGES,
  TRANSLATION_RULES,
  type TranslationRuleId,
} from '../../lib/languages';
import { SOURCE_VERBATIM_TRANSLATION_SOURCE } from '../../lib/translationProvenance';
import {
  languageMarksFirstPerson,
  NO_FORM,
  politenessFormById,
  sentenceAddressesSomeone,
  type PolitenessForm,
} from '../../lib/languageForms';
import {
  parseRenderingKey,
  primaryRenderingKey,
} from '../../lib/preferenceResolution';
import {
  storeTranslationAndScheduleTTSHandler,
  verbatimTranslationArgs,
} from './translationPipeline';
import { romanizeText } from './translation';
import { getRomanizationSource } from '../lib/localRomanization';
import { romanizationAfterFailure } from '../lib/textAnnotations';
import { llmPool, llmWarmPool, type PoolRunResult } from '../lib/workpools';
import {
  llmPriorityValidator,
  ttsPriorityValidator,
  translationReasonValidator,
  isRetranslationReason,
  type LlmPriority,
} from '../types';
import {
  resolveRetranslation,
  resolveRetranslationIfPending,
} from './cardEditAudit';
import { captureGeneration } from '../lib/posthogAi';
import { verifyRendering, type RenderingVerdict } from './renderingClassification';

/**
 * LLM rendering pipeline, built on the `llmPool` / `llmWarmPool` workpools
 * (convex/lib/workpools.ts; the tier comes from `llmPriority`, see
 * `llmPriorityValidator`). One job renders a LIST of rendering keys for one
 * (text, language) (docs/architecture/rendering-keys.md):
 *
 *   1. `enqueueRenderingJob` (convex/lib/contentScheduling.ts) claims every
 *      key in the mutation (`claimLlmTranslationIfAvailable`), so the job
 *      never waits for another job.
 *   2. `enqueueLlmTranslation` enqueues `processLlmTranslationForCard` into
 *      the pool and stamps the pool's workId onto each claim: the claims
 *      now live exactly as long as the pool job.
 *   3. The worker renders the PRIMARY key first when it is in the list (a
 *      fresh translation for the text's voice and primary form), then every
 *      other key by versioning the primary wording, verifies each wording
 *      against its key with the rendering classifier (one retry), and
 *      writes each row via `storeTranslationAndScheduleTTS`. On a
 *      translation failure it THROWS: the pool retries with jittered
 *      exponential backoff.
 *   4. `onLlmTranslationComplete` (guaranteed to run on success, failure, and
 *      cancellation) releases the claims, or, when the pool's retry budget
 *      is exhausted, keeps them marked failed for a cooldown. There is no
 *      machine-translation fallback: a key the model cannot render stays
 *      empty until the cooldown passes.
 */

/**
 * Per-(textId, language, key) LLM claim freshness window. The claim is
 * released by the pool job's onComplete (guaranteed), so staleness is only a
 * catastrophic backstop, e.g. the onComplete handler itself failing.
 * Generous on purpose: a pool job (retries included) can legitimately run
 * for several minutes, and a premature "stale" verdict makes a concurrent
 * reconcile double-enqueue. Exported so callers like `ensureTextContent`
 * can decide whether to defer a TTS enqueue while a job is in flight for
 * the row.
 */
export const CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * Point-read the (textId, targetLanguage, key) LLM claim, if any. Every
 * job since the rendering keys is keyed; `variantKey` undefined only
 * matches a claim from before.
 */
export async function getLlmClaim(
  ctx: QueryCtx | MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
  variantKey?: string,
): Promise<Doc<'llmTranslationClaims'> | null> {
  return await ctx.db
    .query('llmTranslationClaims')
    .withIndex('by_text_language_variant', (q) =>
      q
        .eq('textId', textId)
        .eq('targetLanguage', targetLanguage)
        .eq('variantKey', variantKey),
    )
    .first();
}

/** True while the claim is inside its CLAIM_STALE_MS freshness window. */
export function isClaimFresh(claim: { claimedAt: number }): boolean {
  return Date.now() - claim.claimedAt < CLAIM_STALE_MS;
}

/**
 * How long a key whose attempts were exhausted holds its claim
 * (`variantFailedAt`) before the ensure path may buy another attempt. A
 * sentence the model refuses is otherwise re-bought on every card view,
 * since the card keeps reporting the key as missing.
 */
export const VARIANT_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** True while an exhausted claim is still inside its cooldown. */
function variantFailureHolds(claim: { variantFailedAt?: number }): boolean {
  return (
    claim.variantFailedAt !== undefined &&
    Date.now() - claim.variantFailedAt < VARIANT_RETRY_COOLDOWN_MS
  );
}

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
  // An exhausted job blocks every caller for its cooldown and nobody after
  // it: the job is over, there is nothing to take over, and asking again
  // inside the cooldown would buy the same refusal.
  if (claim.variantFailedAt !== undefined) return variantFailureHolds(claim);
  const fresh = isClaimFresh(claim);
  const takeover =
    fresh && claim.priority === 'background' && priority !== 'background';
  return fresh && !takeover;
}

/**
 * True when a claim exists that `claimLlmTranslationIfAvailable` at `priority`
 * would respect (return null against). Used by the probe path in
 * `enqueueRenderingJob`: a background-held slot probed at interactive
 * priority must classify as NEEDY, because the real run would take the claim
 * over (cancel the warm job, re-enqueue interactively), and that is a write.
 */
export async function hasBlockingLlmClaim(
  ctx: QueryCtx | MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
  priority: LlmPriority | undefined,
  variantKey?: string,
): Promise<boolean> {
  const existing = await getLlmClaim(ctx, textId, targetLanguage, variantKey);
  return existing !== null && llmClaimBlocksPriority(existing, priority);
}

/**
 * Atomically check-and-insert an LLM claim for one key. Returns the new
 * claim's `_id` iff the caller acquired the claim (and should enqueue the
 * job), or null when a fresh claim already holds the slot. Stale claims
 * (older than CLAIM_STALE_MS) are reclaimed.
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
  variantKey?: string,
): Promise<Id<'llmTranslationClaims'> | null> {
  const existing = await getLlmClaim(ctx, textId, targetLanguage, variantKey);

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
    ...(variantKey !== undefined ? { variantKey } : {}),
  });
}

const llmJobArgsValidator = v.object({
  textId: v.id('texts'),
  sourceLanguage: v.string(),
  targetLanguage: v.string(),
  text: v.string(),
  // The rendering keys this job produces, `"<male|female>|<formId|none>"`
  // (lib/preferenceResolution.ts). The primary key of (text, language), when
  // present, is rendered first as a fresh translation; every other key is
  // versioned from the primary wording (which must already exist, or be in
  // this list). Every key was claimed by the enqueuing mutation.
  renderingKeys: v.array(v.string()),
  // The user whose deliberate action caused this job (custom card, card
  // edit, translation flag, chat approval, …). Cost events bill to them as
  // "spend this user caused" (paired with shared_content, see
  // convex/lib/posthogAi.ts). Absent for background/self-heal work, which
  // stays in the system:content-pipeline bucket.
  requestedByUserId: v.optional(v.string()),
  // Retranslation flag forwarded to `storeTranslationAndScheduleTTS`. Set by
  // `flagTranslation` so the new LLM output overwrites the displayed text.
  replaceExisting: v.optional(v.boolean()),
  // Optional rule override forwarded to `resolveTranslationStages`. Used by
  // `flagTranslation` to force the `retranslation_high` chain regardless of
  // the language's normal routing. Worker validates against TRANSLATION_RULES
  // and silently falls back to the language's rule on unknown values.
  ruleOverride: v.optional(v.string()),
  // Single-writer tokens: the claim doc of each key this job was enqueued
  // under (stamped by `enqueueLlmTranslation` from its own claim lookup).
  // The worker forwards the key's token to `storeTranslationAndScheduleTTS`
  // as `expectedClaimId`, so a job whose claim was reclaimed mid-flight
  // (delete + reinsert → new _id) skips its write instead of clobbering the
  // new owner's result.
  claimIds: v.optional(
    v.array(
      v.object({ key: v.string(), claimId: v.id('llmTranslationClaims') }),
    ),
  ),
  // Mixed-dialect pin: the `regionVariant` of the row this job renders next
  // to. The worker prefers it over a fresh `resolveMixedVariant` pick so a
  // card's dialect never flips.
  preferredRegionVariant: v.optional(v.string()),
  // Translation-only mode: forwarded to `storeTranslationAndScheduleTTS` so
  // the landing translation does NOT auto-enqueue TTS. Set by the browse
  // surfaces; audio there is generated only on an explicit audio-icon click,
  // or by the normal ensure path once the text becomes a card.
  skipTts: v.optional(v.boolean()),
  // TTS priority, forwarded to `storeTranslationAndScheduleTTS` so the audio
  // this translation triggers lands in the tier the content was requested at
  // (warm sweeps pass 'background'). See ttsPriorityValidator.
  priority: v.optional(ttsPriorityValidator),
  // Tier THIS translation runs at, as opposed to `priority` above, which is
  // about the audio it triggers. Read only by `enqueueLlmTranslation`, to pick
  // the pool and to stamp the claim; the worker itself makes no scheduling
  // decisions, so it is deliberately NOT forwarded into the worker's args.
  llmPriority: v.optional(llmPriorityValidator),
  // Wording a user typed when manually editing a curriculum card's
  // translation, forwarded to the prompt as a fenced, sanitized
  // <user_suggested_translation> hint. Set only by
  // `suggestCurriculumFixesForEdit` (features/scheduling.ts).
  userSuggestedTranslation: v.optional(v.string()),
  // WHY this translation was requested. The worker branches on it for the
  // "the user says this is wrong" prompt block. Absent means 'fill'.
  translationReason: v.optional(translationReasonValidator),
  // The wording a flag disputes, for the prompt's reconsider block. Passed
  // by the flag path, which knows the row the learner saw (keyed or legacy).
  previousTranslation: v.optional(v.string()),
  // The `cardEditRetranslations` row this job resolves, so the write choke
  // point can record which outcome this attempt reached. Resolved by the
  // LAST key's write, which is the key the gesture was about.
  retranslationAuditId: v.optional(v.id('cardEditRetranslations')),
  // Adoption: the primary key may be a verified copy of the legacy row's
  // wording instead of a fresh translation (`ensureRenderingRow`).
  adoptLegacy: v.optional(v.boolean()),
  // A flag or curriculum fix on a card still reading a LEGACY row: the one
  // key in `renderingKeys` (the text's primary key) says which voice and
  // form to render, but the wording is claimed and stored under the legacy
  // slot (no key), replacing the row the learner disputed. The only path
  // that ever writes a legacy row after the cutover
  // (docs/architecture/rendering-keys.md).
  replacesLegacyRow: v.optional(v.boolean()),
});

/**
 * Which axes a versioned key changes against the primary key, on a
 * language that marks them: the form when the ids differ (a key carries a
 * form only where the language marks one), the gender when the voices
 * differ and the language inflects the first person. Neither: the primary
 * wording is copied under the key without a call.
 */
export function versioningChanges(
  concreteCode: string,
  key: string,
  primaryKey: string,
): { form: boolean; gender: boolean } {
  const requested = parseRenderingKey(key);
  const primary = parseRenderingKey(primaryKey);
  return {
    form: requested.formId !== primary.formId,
    gender:
      requested.voice !== primary.voice &&
      languageMarksFirstPerson(concreteCode),
  };
}

/**
 * onComplete context: the job args minus the fields that are meaningful only
 * to the worker run they were stamped for. `ruleOverride` and `claimIds`
 * belong to one run (the completion handler re-resolves the claims itself),
 * and `userSuggestedTranslation` never needs to outlive it.
 */
const llmCompletionContextValidator = llmJobArgsValidator.omit(
  'ruleOverride',
  'claimIds',
  'userSuggestedTranslation',
);

type LlmJobArgs = Infer<typeof llmJobArgsValidator>;

// Handler params are typed explicitly throughout this file; see
// `PoolRunResult` in convex/lib/workpools.ts for why.

/**
 * Enqueue a rendering job into the pool and stamp the pool's workId onto
 * the claim of every key it renders. Enqueue and claim update commit
 * atomically, so the claims are released exactly when THIS job's onComplete
 * runs and a superseded job's completion can't delete a newer owner's claim.
 * Each claim's `_id` also rides along in the worker args (`claimIds`) as the
 * single-writer token for the eventual `storeTranslationAndScheduleTTS`
 * write.
 *
 * A key whose fresh claim is already stamped with another job's workId is
 * dropped from the list: a live pool job owns it, and rendering it again
 * would run the model twice and hijack that job's claim. Unreachable from
 * the claim-then-enqueue callers (their fresh claims are workId-less); kept
 * as a guard against callers that enqueue without re-claiming. No-ops when
 * every key is dropped.
 */
export const enqueueLlmTranslation = internalMutation({
  args: {
    args: llmJobArgsValidator,
  },
  returns: v.null(),
  handler: async (ctx: MutationCtx, { args }: { args: LlmJobArgs }) => {
    const claims: {
      key: string;
      claim: Doc<'llmTranslationClaims'> | null;
    }[] = [];
    for (const key of args.renderingKeys) {
      const claim = await getLlmClaim(
        ctx,
        args.textId,
        args.targetLanguage,
        args.replacesLegacyRow ? undefined : key,
      );
      if (claim && claim.workId !== undefined && isClaimFresh(claim)) continue;
      claims.push({ key, claim });
    }
    if (claims.length === 0) return null;

    // Priority = pool choice: interactive jobs go to llmPool, warm sweeps to
    // the low-parallelism llmWarmPool (see workpools.ts). Both pools share
    // onLlmTranslationComplete, so claim lifetime is identical either way.
    //
    // Both payloads are derived from `args` by omission, so a field added to
    // `llmJobArgsValidator` flows through the enqueue without a matching
    // hand-written spread line. `llmPriority` is deliberately not forwarded
    // to the worker, and the worker's `claimIds` are re-stamped from this
    // transaction's claim lookup (see the field comments on the validator).
    const { llmPriority, ...workerArgs } = args;
    const {
      ruleOverride,
      claimIds,
      userSuggestedTranslation,
      ...completionContext
    } = args;
    void ruleOverride;
    void claimIds;
    void userSuggestedTranslation;
    const renderingKeys = claims.map((c) => c.key);
    const pool = llmPriority === 'background' ? llmWarmPool : llmPool;
    const workId: string = await pool.enqueueAction(
      ctx,
      internal.features.llmTranslationQueue.processLlmTranslationForCard,
      {
        ...workerArgs,
        renderingKeys,
        claimIds: claims.flatMap((c) =>
          c.claim ? [{ key: c.key, claimId: c.claim._id }] : [],
        ),
      },
      {
        onComplete:
          internal.features.llmTranslationQueue.onLlmTranslationComplete,
        context: { ...completionContext, renderingKeys },
      },
    );

    for (const { claim } of claims) {
      if (claim) {
        await ctx.db.patch(claim._id, { workId, claimedAt: Date.now() });
      }
    }
    return null;
  },
});

/** The text-row projection `getTextRowForTranslation` hands the worker. */
type TextRowForTranslation = {
  _id: Id<'texts'>;
  externalId?: string;
  text: string;
  language: string;
  userCreated: boolean;
  addressesSomeone?: boolean;
  addresseeNumber?: string;
  speakerGender?: string;
  audioSpeakerGender?: string;
  addresseeGender?: string;
  register?: string;
  referentGender?: string;
  metadataSource?: string;
  collectionId: Id<'collections'>;
  collectionRank: number;
  arcId?: string;
};

type TranslationStage = ReturnType<typeof resolveTranslationStages>[number];

/** The prompt payload shared by every stage attempt of one rendering. */
type LlmPromptArgs = TranslationPromptArgs;

/** The stored row the worker reads for the dialect pin and adoption. */
type StoredTranslationRow = {
  translatedText: string;
  romanizedText?: string;
  romanizationSource?: string;
  regionVariant?: string;
  translationSource?: string;
};

/**
 * Resolve the concrete dialect pin for a mixed-language target (today:
 * es_mixed). The LLM prompt is built using the sub-variant's config so the
 * model gets accurate region instructions, and the persisted regionVariant
 * lets the audio player synthesize with the matching accent.
 *
 * Variant pin: prefer (a) the regionVariant already persisted on the
 * legacy row (every keyed row inherits it), then (b) the one the enqueuing
 * sweep captured (`preferredRegionVariant`), then (c) a fresh deterministic
 * pick, so a regeneration can never flip the card's dialect out from under
 * existing audio. Non-mixed targets resolve to the target language itself
 * with no variant.
 */
async function resolveMixedVariantPin(
  ctx: ActionCtx,
  args: LlmJobArgs,
  legacyRow: StoredTranslationRow | null,
): Promise<{ cfgLanguageCode: string; regionVariant: string | undefined }> {
  let mixed: ReturnType<typeof resolveMixedVariant> = null;
  if (isMixedLanguage(args.targetLanguage)) {
    if (legacyRow?.regionVariant) {
      mixed = getMixedVariantByRegion(
        args.targetLanguage,
        legacyRow.regionVariant,
      );
    }
    if (!mixed && args.preferredRegionVariant) {
      mixed = getMixedVariantByRegion(
        args.targetLanguage,
        args.preferredRegionVariant,
      );
    }
    if (!mixed) {
      // A row that exists but carries no pin predates the column: its
      // wording was written under the legacy coin, so reconstruct that one
      // and never re-roll it. Only a (text, language) with no row at all is
      // a genuinely new pick, and that one is decorrelated from the speaker
      // gender (2026-09-08 review).
      mixed =
        legacyRow === null
          ? pickMixedVariantForNewRow(
              args.targetLanguage,
              args.textId as string,
            )
          : resolveMixedVariant(args.targetLanguage, args.textId as string);
    }
  }
  return {
    cfgLanguageCode: mixed ? mixed.subCode : args.targetLanguage,
    regionVariant: mixed?.regionVariant,
  };
}

/** What one rendering key asks the model for. */
type KeyRequest = {
  key: string;
  voice: 'male' | 'female';
  form: PolitenessForm | null;
};

function keyRequest(key: string, concreteCode: string): KeyRequest {
  const { voice, formId } = parseRenderingKey(key);
  return {
    key,
    voice,
    form: formId === NO_FORM ? null : (politenessFormById(concreteCode, formId) ?? null),
  };
}

/**
 * Resolve the addressee/referent metadata, the arc-sibling window, and the
 * reconsider block into the prompt payload for one key. The worker is the
 * single source of truth for "what metadata fields land in the prompt". The
 * speaker gender is the key's voice, always concrete: the row is written
 * for that speaker and spoken in that voice.
 */
async function resolvePromptMetadata(
  ctx: ActionCtx,
  args: LlmJobArgs,
  text: TextRowForTranslation,
  cfg: ReturnType<typeof getTranslationConfigForLanguage>,
  cfgLanguageCode: string,
  request: KeyRequest,
): Promise<LlmPromptArgs> {
  // addressesSomeone: prefer the explicit boolean; fall back to
  // (addresseeNumber !== 'not_applicable') for legacy rows.
  const addressesSomeone = sentenceAddressesSomeone(text);

  // referentGender: fall back to a deterministic coin-flip seeded the same
  // way the backfill seeds it (`externalId || _id`, salt `'referent'`), so
  // a row translated pre-backfill and again post-backfill ends up on the
  // same gender.
  const referentGender: 'male' | 'female' =
    text.referentGender === 'male' || text.referentGender === 'female'
      ? text.referentGender
      : legacyReferentGenderFallback(text.externalId, text._id as string);

  const addresseeGender =
    addressesSomeone &&
    (text.addresseeGender === 'male' || text.addresseeGender === 'female')
      ? (text.addresseeGender as 'male' | 'female')
      : undefined;

  // Fetch the sliding window of arc siblings (≤ 5 preceding + ≤ 3
  // following), but only when this text has an arcId. Custom/chat and
  // legacy rows skip the lookup entirely, so they pay no extra cost.
  let arcContext: { preceding: string[]; following: string[] } | undefined;
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

  // The "previous translation" prompt block is gated to the retranslations
  // a USER asked for, read straight off `translationReason`; the wording is
  // the one the flag path saw on the learner's card.
  const previousTranslation = isRetranslationReason(args.translationReason)
    ? args.previousTranslation
    : undefined;

  return {
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
    speakerGender: request.voice,
    addresseeGender,
    arcContext,
    previousTranslation,
    // No gate needed, unlike previousTranslation: this arrives only from
    // `suggestCurriculumFixesForEdit`, which sets it exactly when the
    // "a user thinks this is wrong" framing is true. buildPrompt sanitizes
    // it before it reaches the model.
    userSuggestedTranslation: args.userSuggestedTranslation,
    // An accent sibling of the text's own language (`en` on `en_gb`):
    // buildPrompt swaps the translator prompt for the rewrite prompt and
    // ignores the context fields above. Read off the row, not the job args,
    // so a stale `sourceLanguage` can never turn a rewrite into a
    // translation.
    accentRewrite: getAccentRewriteConfig(args.targetLanguage, text.language),
    requestedForm: request.form
      ? {
          id: request.form.id,
          label: request.form.promptLabel,
          prompt: request.form.prompt,
        }
      : undefined,
  };
}

/**
 * Run each stage of the resolved translation rule in order. The first
 * success wins; on truncated / empty / HTTP error we try the next fallback.
 * Every attempt (best-of-N candidates included) reports its own PostHog
 * generation event, failures included: a stage that truncates still burned
 * tokens, and the failure rate of the cheap first stage is exactly what
 * decides whether the fallback chain is worth its price.
 *
 * Returns the winning text plus the stage that produced it (persisted as
 * `translationSource`). If the whole chain fails, THROWS: the pool retries
 * this job with backoff, and after the last attempt onComplete marks the
 * keys failed for a cooldown.
 */
async function runTranslationStageChain(
  ctx: ActionCtx,
  args: LlmJobArgs,
  stages: TranslationStage[],
  promptArgs: LlmPromptArgs,
): Promise<{ translatedText: string; winningStage: TranslationStage }> {
  let result: Awaited<ReturnType<typeof translateTextWithLLM>> | null = null;
  let winningStage: TranslationStage | null = null;
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
      // Best-of-N stage: several candidate calls + possibly a judge,
      // aggregated into ONE cost event per stage attempt. Per-call events
      // multiplied PostHog volume ~4x per sentence and no dashboard ever
      // sliced below the stage; token and cost sums keep the totals exact.
      // `suspect_hidden_reasoning` flags stages where any call's
      // output-token count dwarfs its own visible text. The tell for
      // providers that ignore `reasoning: {enabled: false}` and silently
      // bill thinking tokens (observed on Luna's Azure endpoints during
      // the Aug 2026 eval).
      const startedAt = Date.now();
      const bo = await translateBestOfN({ ...promptArgs, stage });
      const calls = bo.telemetryList;
      const judgeAttempts = calls.filter((t) => t.role === 'judge').length;
      const pricedCalls = calls.filter((t) => t.costUsd !== undefined);
      const suspectHiddenReasoning = calls.some(
        (t) =>
          t.visibleTextLength !== undefined &&
          t.outputTokens > 4 * Math.max(16, Math.ceil(t.visibleTextLength / 2)),
      );
      await captureGeneration(ctx, {
        distinctId: args.requestedByUserId,
        feature: 'translation',
        model: stage.model,
        provider: 'openrouter',
        // Wall clock for the whole stage: candidates run in parallel, then
        // the judge, so summing per-call latencies would overstate it.
        latencyMs: Date.now() - startedAt,
        inputTokens: calls.reduce((sum, t) => sum + t.inputTokens, 0),
        outputTokens: calls.reduce((sum, t) => sum + t.outputTokens, 0),
        costUsd:
          pricedCalls.length > 0
            ? pricedCalls.reduce((sum, t) => sum + (t.costUsd ?? 0), 0)
            : undefined,
        traceId: bo.result.telemetry?.generationId,
        isError: !bo.result.ok,
        error: bo.result.ok ? undefined : bo.result.reason,
        sharedContent: true,
        extra: {
          ...stageExtra,
          strategy: `bo${stage.samples.total}`,
          call_count: calls.length,
          candidate_failures: bo.meta.candidateFailures,
          judge_attempts: judgeAttempts,
          n_unique: bo.meta.nUnique,
          judge_fallback: bo.meta.judgeFallback,
          // Calls that never landed carry no cost, so the sum above can be
          // partial. Surfaced so a low total can't silently read as cheap.
          priced_calls: pricedCalls.length,
          suspect_hidden_reasoning: suspectHiddenReasoning,
        },
      });
      result = bo.result;
    } else {
      result = await translateTextWithLLM({
        ...promptArgs,
        model: stage.model,
        reasoning: stage.reasoning as ReasoningEffort | undefined,
        maxOutputTokens: stage.maxOutputTokens,
        provider: stage.provider,
      });
      // One cost event per stage attempt, failures included.
      // `translateTextWithLLM` has no ctx of its own, so it hands the
      // numbers back and the capture happens here.
      if (result.telemetry) {
        await captureGeneration(ctx, {
          distinctId: args.requestedByUserId,
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
      console.warn(
        '[llmTranslationQueue] stage failed — retrying with next stage',
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          stageIndex: i,
          stageModel: stage.model,
          stageReasoning: stage.reasoning,
          reason: result.reason,
          nextStageModel: next.model,
          nextStageReasoning: next.reasoning,
        },
      );
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
  // `result.ok` implies the loop broke with `winningStage = stage`.
  return { translatedText: result.text, winningStage: winningStage! };
}

/** One rendered wording, ready to store. */
type RenderedWording = {
  translatedText: string;
  translationSource: string;
  /** Carried from an adopted legacy row; else romanized at the store step. */
  romanizedText?: string;
  romanizationSource?: string;
  renderingVerified: boolean | undefined;
  versionedFromText: string | undefined;
  isVerbatimAccentRewrite: boolean;
};

/**
 * Run the stage chain for one key, then verify the wording against the key
 * with the rendering classifier and retry once on a mismatch, with the
 * failed attempt in the prompt. A second mismatch is stored as it is, marked
 * unverified. An accent rewrite (English) is never verified: it marks no
 * axis.
 */
async function renderWithVerification(
  ctx: ActionCtx,
  args: LlmJobArgs,
  stages: TranslationStage[],
  promptArgs: LlmPromptArgs,
  request: KeyRequest,
  concreteCode: string,
): Promise<{
  translatedText: string;
  winningStage: TranslationStage;
  renderingVerified: boolean | undefined;
}> {
  let { translatedText, winningStage } = await runTranslationStageChain(
    ctx,
    args,
    stages,
    promptArgs,
  );
  if (promptArgs.accentRewrite) {
    return { translatedText, winningStage, renderingVerified: undefined };
  }
  let verdict: RenderingVerdict = (
    await verifyRendering(ctx, {
      sentence: translatedText,
      language: concreteCode,
      key: request.key,
      userId: args.requestedByUserId,
    })
  ).verdict;
  if (verdict === 'mismatch') {
    const retry = await runTranslationStageChain(ctx, args, stages, {
      ...promptArgs,
      previousAttempt: translatedText,
    });
    translatedText = retry.translatedText;
    winningStage = retry.winningStage;
    verdict = (
      await verifyRendering(ctx, {
        sentence: translatedText,
        language: concreteCode,
        key: request.key,
        userId: args.requestedByUserId,
      })
    ).verdict;
  }
  return {
    translatedText,
    winningStage,
    renderingVerified: verdict === 'unknown' ? undefined : verdict === 'ok',
  };
}

/**
 * Store tail: optionally romanize the translation, resolve the voice and
 * the source stamps, and write via `storeTranslationAndScheduleTTS`.
 */
async function storeRenderedWording(
  ctx: ActionCtx,
  args: LlmJobArgs,
  pin: { cfgLanguageCode: string; regionVariant: string | undefined },
  request: KeyRequest,
  wording: RenderedWording,
  resolvesAudit: boolean,
): Promise<void> {
  // `romanizeText` already retries up to 3 times internally; on full
  // exhaustion we persist an empty-string sentinel so ensureContent
  // doesn't reschedule another burst on every call. A TRANSIENT failure
  // (rate limit, missing key) leaves the field undefined instead, so the
  // annotation sweep asks again later (`romanizationAfterFailure`).
  let romanizedText = wording.romanizedText;
  let romanizationSource = wording.romanizationSource;
  if (
    romanizedText === undefined &&
    ROMANIZATION_LANGUAGES.has(args.targetLanguage)
  ) {
    try {
      romanizedText = await romanizeText(
        wording.translatedText,
        args.targetLanguage,
      );
    } catch (err) {
      romanizedText = romanizationAfterFailure(
        err,
        `[llmTranslationQueue] ${args.targetLanguage}`,
      );
    }
    // Source resolved from `cfgLanguageCode` (the sub-code for mixed
    // dialects) so the recorded source matches what `romanizeText` ran on.
    romanizationSource =
      romanizedText !== undefined
        ? getRomanizationSource(pin.cfgLanguageCode)
        : undefined;
  }

  // For mixed languages, pick a voice matching the resolved regional
  // variant so the synthesized audio agrees with the persisted
  // `regionVariant`. Other languages get the text's deterministic accent
  // (mixed-accent pools) or the plain gender-preferring pick.
  const voiceName = getVoiceForText(
    args.targetLanguage,
    args.textId,
    pin.regionVariant,
    request.voice,
  );

  await ctx.runMutation(
    internal.features.decks.storeTranslationAndScheduleTTS,
    {
      textId: args.textId,
      targetLanguage: args.targetLanguage,
      requestedByUserId: args.requestedByUserId,
      translatedText: wording.translatedText,
      voiceName,
      romanizedText,
      romanizationSource,
      translationSource: wording.translationSource,
      regionVariant: pin.regionVariant,
      replaceExisting: args.replaceExisting,
      translationReason: args.translationReason,
      speakerGender: request.voice,
      // Single-writer gate: skip the write if the claim this job was
      // enqueued under has been reclaimed by a newer job mid-flight.
      expectedClaimId: args.claimIds?.find((c) => c.key === request.key)
        ?.claimId,
      skipTts: args.skipTts,
      priority: args.priority,
      variantKey: args.replacesLegacyRow ? undefined : request.key,
      versionedFromText: wording.versionedFromText,
      renderingVerified: wording.renderingVerified,
      // Resolved at the write choke point, which is the only place that
      // knows which of its several outcomes this attempt actually reached.
      retranslationAuditId: resolvesAudit
        ? args.retranslationAuditId
        : undefined,
    },
  );
}

/**
 * Worker action: read the texts row for metadata, render every key of the
 * job (the primary first as a fresh translation, the others versioned from
 * the primary wording), verify each wording, and write each row via
 * `storeTranslationAndScheduleTTS`.
 *
 * Failure contract: THROW on any failure. The pool retries with backoff up
 * to its budget; the final failure lands in `onLlmTranslationComplete`,
 * which marks the keys failed for a cooldown. Keys already stored by an
 * earlier attempt of the same job are skipped on a retry through the
 * store's own single-writer and fill-if-missing semantics.
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
      // lets onComplete release the claims.
      console.error('[llmTranslationQueue] text row missing', {
        textId: args.textId,
      });
      return null;
    }

    const legacyRow: StoredTranslationRow | null = await ctx.runQuery(
      internal.features.decks.getTranslationForTextLanguage,
      { textId: args.textId, targetLanguage: args.targetLanguage },
    );
    const pin = await resolveMixedVariantPin(ctx, args, legacyRow);
    const cfg = getTranslationConfigForLanguage(pin.cfgLanguageCode);
    const concreteCode = pin.cfgLanguageCode;
    // Validate the rule override before passing it through. An unknown
    // string would crash `resolveTranslationStages`. Unknown values silently
    // fall back to the language's normal routing.
    const ruleOverride =
      args.ruleOverride && args.ruleOverride in TRANSLATION_RULES
        ? (args.ruleOverride as TranslationRuleId)
        : undefined;

    const primaryKey = primaryRenderingKey({
      text,
      textId: args.textId,
      code: concreteCode,
    });
    // The primary first: every other key is versioned from its wording.
    const keys = [
      ...args.renderingKeys.filter((key) => key === primaryKey),
      ...args.renderingKeys.filter((key) => key !== primaryKey),
    ];
    const auditKey = keys[keys.length - 1];

    let primary: { text: string; source: string } | null = null;
    if (!keys.includes(primaryKey)) {
      const row: StoredTranslationRow | null = await ctx.runQuery(
        internal.features.decks.getTranslationForTextLanguage,
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          variantKey: primaryKey,
        },
      );
      if (row) {
        primary = {
          text: row.translatedText,
          source: row.translationSource ?? 'unknown',
        };
      }
    }

    for (const key of keys) {
      const request = keyRequest(key, concreteCode);
      const isPrimary = key === primaryKey;
      let wording: RenderedWording | null = null;

      // A retried action skips the keys an earlier attempt already landed:
      // their claims were released by the store. The primary's wording is
      // then read back for the keys versioned from it.
      const claimId = args.claimIds?.find((c) => c.key === key)?.claimId;
      if (
        claimId !== undefined &&
        !(await ctx.runQuery(
          internal.features.llmTranslationQueue.isLlmClaimHeld,
          { claimId },
        ))
      ) {
        if (isPrimary) {
          const row: StoredTranslationRow | null = await ctx.runQuery(
            internal.features.decks.getTranslationForTextLanguage,
            {
              textId: args.textId,
              targetLanguage: args.targetLanguage,
              variantKey: args.replacesLegacyRow ? undefined : primaryKey,
            },
          );
          if (row) {
            primary = {
              text: row.translatedText,
              source: row.translationSource ?? 'unknown',
            };
          }
        }
        continue;
      }

      // Adoption: the legacy row stands in for the primary key when its
      // wording already is that rendering.
      if (isPrimary && args.adoptLegacy && legacyRow) {
        const { verdict } = await verifyRendering(ctx, {
          sentence: legacyRow.translatedText,
          language: concreteCode,
          key,
          userId: args.requestedByUserId,
        });
        if (verdict === 'ok') {
          wording = {
            translatedText: legacyRow.translatedText,
            translationSource: legacyRow.translationSource ?? 'unknown',
            romanizedText: legacyRow.romanizedText,
            romanizationSource: legacyRow.romanizationSource,
            renderingVerified: true,
            versionedFromText: undefined,
            isVerbatimAccentRewrite: false,
          };
        }
      }

      if (
        wording === null &&
        (isPrimary ||
          primary === null ||
          isRetranslationReason(args.translationReason))
      ) {
        // A fresh translation for this key. A non-primary key with no
        // primary wording to version from (the primary row vanished under
        // the job) is rendered fresh too rather than dropped, and so is a
        // flagged or corrected one: the learner disputed THIS rendering,
        // and the versioning prompt carries neither the rejected wording
        // nor the suggestion. The fresh row stands on its own from then on
        // (no `versionedFromText`).
        const promptArgs = await resolvePromptMetadata(
          ctx,
          args,
          text,
          cfg,
          concreteCode,
          request,
        );
        // An accent sibling of the text's own language runs the fixed
        // rewrite chain whatever the target's translation rule or a flag's
        // override says: the job is a copy-edit, not a translation, and the
        // rules were tuned for the latter.
        const stages = promptArgs.accentRewrite
          ? ACCENT_REWRITE_STAGES
          : resolveTranslationStages(
              concreteCode,
              text.text.length,
              ruleOverride ? { ruleOverride } : undefined,
            );
        if (stages.length === 0) {
          throw new Error(
            `[llmTranslationQueue] no translation stages for ${args.targetLanguage} (resolved ${concreteCode})`,
          );
        }
        const rendered = await renderWithVerification(
          ctx,
          args,
          stages,
          promptArgs,
          request,
          concreteCode,
        );
        // The reply was normalised on its way out of the LLM call
        // (`normalizeModelOutput`), so the source goes through the same step
        // before the comparison. A sentence wrapped in quotation marks is
        // still verbatim when the model returns it unchanged.
        const isVerbatimAccentRewrite =
          promptArgs.accentRewrite !== undefined &&
          rendered.translatedText ===
            normalizeModelOutput(args.targetLanguage, text.text);
        wording = {
          translatedText: rendered.translatedText,
          translationSource: isVerbatimAccentRewrite
            ? SOURCE_VERBATIM_TRANSLATION_SOURCE
            : getTranslationSourceFromStage(rendered.winningStage),
          renderingVerified: rendered.renderingVerified,
          versionedFromText: undefined,
          isVerbatimAccentRewrite,
        };
      } else if (wording === null && primary !== null) {
        // Versioned from the primary wording. Only an axis the key CHANGES
        // against the primary key can move the wording, and only where the
        // language marks it; a key that changes nothing the language marks
        // gets a copy with no call.
        const changes = versioningChanges(concreteCode, key, primaryKey);
        if (!changes.form && !changes.gender) {
          wording = {
            translatedText: primary.text,
            translationSource: primary.source,
            renderingVerified: undefined,
            versionedFromText: primary.text,
            isVerbatimAccentRewrite: false,
          };
        } else {
          const promptArgs = {
            ...(await resolvePromptMetadata(
              ctx,
              args,
              text,
              cfg,
              concreteCode,
              request,
            )),
            rewriteOf: primary.text,
            rewriteChangesGender: changes.gender,
          };
          const stages = resolveTranslationStages(
            concreteCode,
            text.text.length,
            ruleOverride ? { ruleOverride } : undefined,
          );
          const rendered = await renderWithVerification(
            ctx,
            args,
            stages,
            promptArgs,
            request,
            concreteCode,
          );
          wording = {
            translatedText: rendered.translatedText,
            translationSource: getTranslationSourceFromStage(
              rendered.winningStage,
            ),
            renderingVerified: rendered.renderingVerified,
            versionedFromText: primary.text,
            isVerbatimAccentRewrite: false,
          };
        }
      }

      if (wording === null) continue;
      if (isPrimary) {
        primary = {
          text: wording.translatedText,
          source: wording.translationSource,
        };
      }
      await storeRenderedWording(
        ctx,
        args,
        pin,
        request,
        wording,
        key === auditKey,
      );
    }
    return null;
  },
});

/**
 * Pool onComplete for `processLlmTranslationForCard`. Guaranteed to run on
 * success, failure, and cancellation.
 *
 * - success / canceled → release the claims (ownership-gated on `workId`,
 *   so a superseded job's completion can't delete a newer owner's claim).
 * - failed (pool retry budget exhausted, or NonRetryableError) → keep the
 *   owned claims marked failed, so the ensure path does not buy the same
 *   refusal again on every view until VARIANT_RETRY_COOLDOWN_MS has passed.
 *   An accent rewrite falls back to the source text verbatim instead: the
 *   same-language "translation" has a safe answer, the catalogue wording.
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
    const owned: Doc<'llmTranslationClaims'>[] = [];
    for (const key of context.renderingKeys) {
      const claim = await getLlmClaim(
        ctx,
        context.textId,
        context.targetLanguage,
        context.replacesLegacyRow ? undefined : key,
      );
      if (claim && (claim.workId === undefined || claim.workId === workId)) {
        owned.push(claim);
      }
    }

    if (result.kind !== 'failed') {
      for (const claim of owned) {
        await ctx.db.delete(claim._id);
      }
      // A success normally resolved the audit row at the write choke point
      // already (the guard makes this a no-op then). Two ways a job lands
      // here with the row still 'enqueued': the worker returned success
      // without reaching the choke point because the text row was
      // cascade-deleted mid-flight, or the job was canceled (no cancel site
      // carries an audit id today, but the pool API allows it). Without this,
      // the row reads as "still in flight" in the admin QC view forever.
      if (context.retranslationAuditId !== undefined) {
        const textGone = (await ctx.db.get(context.textId)) === null;
        await resolveRetranslationIfPending(
          ctx,
          context.retranslationAuditId,
          textGone ? 'dropped_text_deleted' : 'failed',
        );
      }
      return null;
    }

    if (owned.length === 0) {
      // Superseded: another job reclaimed these keys while this one was
      // queued/retrying (or the claims are already gone). The current owner
      // drives its own attempt.
      console.warn(
        '[llmTranslationQueue] LLM attempts exhausted on a superseded job',
        {
          textId: context.textId,
          targetLanguage: context.targetLanguage,
          error: result.error,
        },
      );
      await resolveRetranslation(
        ctx,
        context.retranslationAuditId,
        'dropped_superseded',
      );
      return null;
    }

    // Off the text row, like the worker (`resolvePromptMetadata`), never off
    // the job's `sourceLanguage`. A stale arg must not turn a rewrite into
    // a translation, or the reverse.
    const textRow = await ctx.db.get(context.textId);
    if (
      textRow &&
      getAccentRewriteConfig(context.targetLanguage, textRow.language)
    ) {
      // An accent rewrite has a safe answer: the source text itself, the
      // same row the verbatim path writes, under this job's claims so a
      // concurrent re-drive cannot race the write. Released right after,
      // like a success.
      console.warn(
        '[llmTranslationQueue] accent rewrite attempts exhausted — storing the source text verbatim',
        {
          textId: context.textId,
          targetLanguage: context.targetLanguage,
          error: result.error,
        },
      );
      for (const claim of owned) {
        await storeTranslationAndScheduleTTSHandler(ctx, {
          ...verbatimTranslationArgs(
            textRow,
            context.targetLanguage,
            context.replacesLegacyRow
              ? undefined
              : (claim.variantKey ?? context.renderingKeys[0]),
            {
              skipTts: context.skipTts,
              priority: context.priority,
              requestedByUserId: context.requestedByUserId,
              replaceExisting: context.replaceExisting,
              translationReason: context.translationReason,
            },
          ),
          expectedClaimId: claim._id,
          retranslationAuditId: context.retranslationAuditId,
        });
        // The store released the claim with the row.
      }
      return null;
    }

    console.warn(
      '[llmTranslationQueue] rendering attempts exhausted — keys held for the cooldown',
      {
        textId: context.textId,
        targetLanguage: context.targetLanguage,
        renderingKeys: context.renderingKeys,
        error: result.error,
      },
    );
    await resolveRetranslation(ctx, context.retranslationAuditId, 'failed');
    for (const claim of owned) {
      await ctx.db.patch(claim._id, {
        workId: undefined,
        variantFailedAt: Date.now(),
      });
    }
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
/** Whether a claim still exists: released claims are landed keys. */
export const isLlmClaimHeld = internalQuery({
  args: { claimId: v.id('llmTranslationClaims') },
  returns: v.boolean(),
  handler: async (ctx, { claimId }) => (await ctx.db.get(claimId)) !== null,
});

export const getTextRowForTranslation = internalQuery({
  args: { textId: v.id('texts') },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id('texts'),
      externalId: v.optional(v.string()),
      text: v.string(),
      language: v.string(),
      userCreated: v.boolean(),
      addressesSomeone: v.optional(v.boolean()),
      addresseeNumber: v.optional(v.string()),
      speakerGender: v.optional(v.string()),
      audioSpeakerGender: v.optional(v.string()),
      addresseeGender: v.optional(v.string()),
      register: v.optional(v.string()),
      referentGender: v.optional(v.string()),
      metadataSource: v.optional(v.string()),
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
      language: row.language,
      text: row.text,
      userCreated: row.userCreated,
      addressesSomeone: row.addressesSomeone,
      addresseeNumber: row.addresseeNumber,
      speakerGender: row.speakerGender,
      audioSpeakerGender: row.audioSpeakerGender,
      addresseeGender: row.addresseeGender,
      register: row.register,
      referentGender: row.referentGender,
      metadataSource: row.metadataSource,
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
