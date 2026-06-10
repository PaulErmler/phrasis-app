import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  ActionCtx,
  MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc, Id } from '../_generated/dataModel';
import { translateTextWithLLM, type ReasoningEffort } from './translationLLM';
import {
  getTranslationConfigForLanguage,
  getTranslationSourceFromStage,
  getVoiceForLanguage,
  getVoiceForLanguageVariant,
  resolveMixedVariant,
  resolveTranslationStages,
  ROMANIZATION_LANGUAGES,
  TRANSLATION_RULES,
  type TranslationRuleId,
} from '../../lib/languages';
import { romanizeText } from './translation';
import { getRomanizationSource } from '../lib/localRomanization';
import { asVoiceGender } from '../types';

/**
 * LLM translation queue. Mirrors the TTS queue pattern in `ttsProcessing.ts`
 * but with the concurrency gate active from day one (OpenRouter does rate-limit).
 *
 * Pipeline per translation:
 *   1. `claimLlmTranslationIfAvailable` (called from `scheduleMissingContent`)
 *      atomically reserves the (textId, language) slot.
 *   2. `enqueueLlmTranslation` inserts a queue row and tries to dispatch.
 *   3. `pumpLlmQueue` runs the dispatch loop, capped at MAX_LLM_CONCURRENCY
 *      live slots. Each dispatched job inserts a slot row and schedules the
 *      `processLlmTranslationForCard` action.
 *   4. The action calls `translateTextWithLLM`. On success it writes via
 *      `storeTranslationAndScheduleTTS` (the same mutation the Google path
 *      uses, so romanization/TTS downstream is unchanged). On failure
 *      (truncation, empty output, HTTP error) it falls back to
 *      `processTranslationForCard` (the Google path) for the same row.
 *   5. `finalizeLlmTranslationJob` drops the slot + claim and pumps the next
 *      waiter, atomically.
 */

const MAX_LLM_CONCURRENCY = 64;
const SLOT_STALE_MS = 60 * 1000; // 1 minute — longer than the longest API call
/**
 * Per-(textId, language) LLM claim freshness window. Claims older than this
 * are treated as stale and reclaimable. Exported so callers like
 * `scheduleMissingContent` can decide whether to defer a TTS enqueue while
 * an LLM retranslation is in flight for the same row (a stale claim still
 * holds the slot from this caller's perspective — pump will reclaim it).
 */
export const CLAIM_STALE_MS = 30 * 1000;

// Slot bookkeeping bounds for `countLiveSlotsAndReclaimStale`. At steady-state
// peak we can see up to MAX_LLM_CONCURRENCY fresh slots plus a backlog of
// not-yet-reclaimed stale slots from the previous SLOT_STALE_MS window — so
// `2 × cap` is the legitimate ceiling. Read with extra headroom so a real
// leak surfaces rather than being silently truncated by `.take()`.
const SLOT_READ_LIMIT = MAX_LLM_CONCURRENCY * 3;
const SLOT_LEAK_WARN_THRESHOLD = MAX_LLM_CONCURRENCY * 2;

/**
 * Atomically check-and-insert an LLM translation claim. Returns true iff the
 * caller acquired the claim and should enqueue the job. Stale claims (older
 * than CLAIM_STALE_MS) are reclaimed.
 */
export async function claimLlmTranslationIfAvailable(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query('llmTranslationClaims')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('targetLanguage', targetLanguage),
    )
    .first();

  if (existing) {
    if (Date.now() - existing.claimedAt < CLAIM_STALE_MS) {
      return false;
    }
    await ctx.db.delete(existing._id);
  }

  await ctx.db.insert('llmTranslationClaims', {
    textId,
    targetLanguage,
    claimedAt: Date.now(),
  });
  return true;
}

/**
 * Count live slots and reclaim any that are older than SLOT_STALE_MS in-place.
 * Read up to `SLOT_READ_LIMIT` (3× cap) so a runaway leak is visible past the
 * legitimate steady-state peak of `2× cap` (live + stale). Warn at the peak
 * threshold so anything above it is a real anomaly, not just heavy load.
 */
async function countLiveSlotsAndReclaimStale(ctx: MutationCtx): Promise<number> {
  const rows = await ctx.db.query('llmTranslationSlots').take(SLOT_READ_LIMIT);
  if (rows.length > SLOT_LEAK_WARN_THRESHOLD) {
    console.warn('[llmTranslationQueue] unusually many slot rows', {
      rowCount: rows.length,
      threshold: SLOT_LEAK_WARN_THRESHOLD,
    });
  }
  const now = Date.now();
  let fresh = 0;
  for (const row of rows) {
    if (now - row.claimedAt > SLOT_STALE_MS) {
      await ctx.db.delete(row._id);
    } else {
      fresh++;
    }
  }
  return fresh;
}

const llmJobArgsValidator = v.object({
  textId: v.id('texts'),
  sourceLanguage: v.string(),
  targetLanguage: v.string(),
  text: v.string(),
  audioSpeakerGender: v.optional(v.string()),
  // Priority forwarded by the originating scheduling mutation. Used to keep
  // prioritization intact when the worker hands off to
  // storeTranslationAndScheduleTTS (downstream TTS) or to the Google fallback
  // path. Tiers: 2 = critical (onboarding seed / placement test), 1 = active
  // collection, 0 = background warmup. Defaults to 0 when missing.
  priority: v.optional(v.union(v.literal(0), v.literal(1), v.literal(2))),
  // Retranslation flag forwarded to `storeTranslationAndScheduleTTS` (and
  // through `scheduleGoogleFallback` to `processTranslationForCard`). Set
  // by `flagTranslation` so the new LLM output overwrites the displayed
  // text. See the storeTranslationAndScheduleTTS docstring for replacement
  // semantics.
  replaceExisting: v.optional(v.boolean()),
  // Optional rule override forwarded to `resolveTranslationStages`. Used by
  // `flagTranslation` to force the `retranslation_high` chain regardless of
  // the language's normal routing. Worker validates against TRANSLATION_RULES
  // and silently falls back to the language's rule on unknown values.
  ruleOverride: v.optional(v.string()),
});

/**
 * Drain the queue up to MAX_LLM_CONCURRENCY live slots. Safe to call when the
 * queue is empty or capacity is reached — both are no-ops. Single-mutation
 * atomicity: slot insert + scheduler schedule + queue row delete all commit
 * together so we never exceed the cap or lose a queue row partway.
 */
export const pumpLlmQueue = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    let used = await countLiveSlotsAndReclaimStale(ctx);
    while (used < MAX_LLM_CONCURRENCY) {
      // Priority drain: critical (2, onboarding seed / placement test) first,
      // then high (1, active collection), then normal (0), then any
      // pre-priority rows (undefined) left over from a deploy. FIFO within
      // each level via the queuedAt suffix in the index.
      const next =
        (await ctx.db
          .query('llmTranslationQueue')
          .withIndex('by_priority_and_queuedAt', (q) =>
            q.eq('priority', 2),
          )
          .order('asc')
          .first()) ??
        (await ctx.db
          .query('llmTranslationQueue')
          .withIndex('by_priority_and_queuedAt', (q) =>
            q.eq('priority', 1),
          )
          .order('asc')
          .first()) ??
        (await ctx.db
          .query('llmTranslationQueue')
          .withIndex('by_priority_and_queuedAt', (q) =>
            q.eq('priority', 0),
          )
          .order('asc')
          .first()) ??
        (await ctx.db
          .query('llmTranslationQueue')
          .withIndex('by_priority_and_queuedAt', (q) =>
            q.eq('priority', undefined),
          )
          .order('asc')
          .first());
      if (!next) break;

      await ctx.db.insert('llmTranslationSlots', {
        claimedAt: Date.now(),
      });
      await ctx.db.delete(next._id);
      await ctx.scheduler.runAfter(
        0,
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        next.args,
      );
      used++;
    }
    return null;
  },
});

/**
 * Insert an LLM translation job and schedule a pump on the next scheduler
 * tick. **The pump runs in its own transaction**, not inline — otherwise its
 * reads/writes against `llmTranslationSlots` would land in the caller's
 * transaction. When the caller is a big batch mutation like
 * `ensureContentForCollection` (35+ enqueues) and finalizers are concurrently
 * deleting slot rows, that overlap causes OCC retries that never converge.
 * Scheduling the pump separately keeps this mutation's read-set limited to
 * the queue row it just inserted.
 */
export const enqueueLlmTranslation = internalMutation({
  args: {
    args: llmJobArgsValidator,
    priority: v.optional(v.union(v.literal(0), v.literal(1), v.literal(2))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('llmTranslationQueue', {
      args: args.args,
      queuedAt: Date.now(),
      priority: args.priority ?? 0,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.features.llmTranslationQueue.pumpLlmQueue,
      {},
    );
    return null;
  },
});

/**
 * End-of-job cleanup: drop the slot, drop the claim (unless `keepClaim` is
 * true), pump the next waiter — all in one transaction so an action retry
 * can't leave slot/claim state drifted from queue depth. Idempotent.
 *
 * `keepClaim`: passed `true` when the LLM call failed and a Google fallback
 * was scheduled. We need the slot back so the queue keeps moving, but the
 * claim must outlive the fallback so a concurrent `scheduleMissingContent`
 * can't route the same `(textId, lang)` through the LLM again before the
 * fallback writes its `translations` row. The claim is then released by
 * `storeTranslationAndScheduleTTS` once the row exists (or by staleness
 * after CLAIM_STALE_MS if the fallback also fails).
 */
export const finalizeLlmTranslationJob = internalMutation({
  args: {
    textId: v.id('texts'),
    targetLanguage: v.string(),
    keepClaim: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Release one slot — pick the oldest. With MAX_LLM_CONCURRENCY in-flight
    // calls this is bounded reading, so `.first()` is fine.
    const slot = await ctx.db.query('llmTranslationSlots').first();
    if (slot) {
      await ctx.db.delete(slot._id);
    }

    if (!args.keepClaim) {
      const claim = await ctx.db
        .query('llmTranslationClaims')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
        )
        .first();
      if (claim) {
        await ctx.db.delete(claim._id);
      }
    }

    // Schedule the pump in a separate transaction. Inlining it here would
    // re-read `llmTranslationSlots`, and many concurrent finalizers all doing
    // a read-modify-write on the same table is the primary source of OCC
    // retries. Pump is idempotent and runs on the next scheduler tick.
    await ctx.scheduler.runAfter(
      0,
      internal.features.llmTranslationQueue.pumpLlmQueue,
      {},
    );
    return null;
  },
});

/**
 * Worker action: read the texts row for metadata, call the LLM, write the
 * result via `storeTranslationAndScheduleTTS` (same path as Google), and on
 * any failure schedule the legacy Google path for the same row.
 *
 * `finally` always calls `finalizeLlmTranslationJob` so slot/claim state stays
 * in sync with the queue.
 */
export const processLlmTranslationForCard = internalAction({
  args: llmJobArgsValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    // Tracks whether we handed the row off to the Google fallback. When true,
    // `finalize` keeps the LLM claim alive so a concurrent scheduleMissingContent
    // can't re-route the same (textId, lang) through the LLM before the Google
    // action's storeTranslationAndScheduleTTS lands.
    let scheduledFallback = false;
    try {
      // Read metadata off the texts row — the worker is the single source of
      // truth for "what speaker/addressee/referent fields land in the prompt".
      const text = await ctx.runQuery(
        internal.features.llmTranslationQueue.getTextRowForTranslation,
        { textId: args.textId },
      );
      if (!text) {
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
      const mixed = resolveMixedVariant(args.targetLanguage, args.textId as string);
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
        // Misrouted: the queue worker should only ever receive openrouter
        // languages. Fall back to Google so the row still gets translated.
        console.warn('[llmTranslationQueue] non-openrouter language reached worker — falling back', {
          targetLanguage: args.targetLanguage,
          resolvedSubCode: cfgLanguageCode,
          stageCount: stages.length,
        });
        await scheduleGoogleFallback(ctx, args);
        scheduledFallback = true;
        return null;
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
      // fallback. After the chain exhausts the worker schedules Google
      // Translate as the final safety net. Track which stage produced the
      // winning result so it can be persisted as `translationSource`.
      let result: Awaited<ReturnType<typeof translateTextWithLLM>> | null = null;
      let winningStage: (typeof stages)[number] | null = null;
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        result = await translateTextWithLLM({
          ...promptArgs,
          model: stage.model,
          reasoning: stage.reasoning as ReasoningEffort | undefined,
          maxOutputTokens: stage.maxOutputTokens,
        });
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
        // Truncation / empty / HTTP error — fall back to Google for this row.
        console.warn('[llmTranslationQueue] LLM result not ok — falling back to Google', {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          reason: result.reason,
          detail: result.detail,
        });
        await scheduleGoogleFallback(ctx, args);
        scheduledFallback = true;
        return null;
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
          priority: args.priority,
          replaceExisting: args.replaceExisting,
          speakerGender: asVoiceGender(args.audioSpeakerGender),
        },
      );
    } catch (err) {
      console.error('[llmTranslationQueue] unhandled error', {
        textId: args.textId,
        targetLanguage: args.targetLanguage,
        error: err instanceof Error ? err.message : String(err),
      });
      // Try to fall back to Google so the user still gets a translation.
      try {
        await scheduleGoogleFallback(ctx, args);
        scheduledFallback = true;
      } catch (fallbackErr) {
        console.error('[llmTranslationQueue] fallback scheduling also failed', {
          error:
            fallbackErr instanceof Error
              ? fallbackErr.message
              : String(fallbackErr),
        });
      }
    } finally {
      await ctx.runMutation(
        internal.features.llmTranslationQueue.finalizeLlmTranslationJob,
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          keepClaim: scheduledFallback,
        },
      );
    }
    return null;
  },
});

async function scheduleGoogleFallback(
  ctx: ActionCtx,
  args: {
    textId: Id<'texts'>;
    sourceLanguage: string;
    targetLanguage: string;
    text: string;
    audioSpeakerGender?: string;
    priority?: 0 | 1 | 2;
    replaceExisting?: boolean;
  },
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.features.decks.processTranslationForCard,
    {
      textId: args.textId,
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
      text: args.text,
      audioSpeakerGender: args.audioSpeakerGender,
      priority: args.priority,
      replaceExisting: args.replaceExisting,
    },
  );
}

/**
 * Stable male/female pick for legacy rows missing `referentGender`.
 *
 * MUST match the backfill's seeding rule in
 * `convex/admin/backfillTextMetadata.ts:stableCoinFlip(pickSeedKey(doc), 'referent')`
 * so a row translated pre-backfill and re-translated post-backfill (with a
 * persisted value) lines up on the same gender. The seed key is the row's
 * `externalId` when present (stable across dataset re-uploads), else its `_id`.
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
