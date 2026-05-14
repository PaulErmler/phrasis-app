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
  getVoiceForLanguage,
  getVoiceForLanguageVariant,
  resolveMixedVariant,
  resolveTranslationStages,
  ROMANIZATION_LANGUAGES,
} from '../../lib/languages';
import { romanizeText } from './translation';

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

const MAX_LLM_CONCURRENCY = 200;
const SLOT_STALE_MS = 60 * 1000; // 1 minute — longer than the longest API call
const CLAIM_STALE_MS = 30 * 1000;

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
  // Active-collection priority forwarded by the originating scheduling
  // mutation. Used to keep prioritization intact when the worker hands off
  // to storeTranslationAndScheduleTTS (downstream TTS) or to the Google
  // fallback path. Defaults to 0 (normal) when missing.
  priority: v.optional(v.union(v.literal(0), v.literal(1))),
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
      // Priority drain: high-priority (1, active collection) first, then
      // normal (0), then any pre-priority rows (undefined) left over from a
      // deploy. FIFO within each level via the queuedAt suffix in the index.
      const next =
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
    priority: v.optional(v.union(v.literal(0), v.literal(1))),
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
    // Release one slot — pick the oldest. With 200 in-flight calls this is
    // bounded reading, so `.first()` is fine.
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
      const stages = resolveTranslationStages(cfgLanguageCode, text.text.length);
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
      } as const;

      // Run each stage of the resolved translation rule in order. The first
      // success wins; on truncated / empty / HTTP error we try the next
      // fallback. After the chain exhausts the worker schedules Google
      // Translate as the final safety net.
      let result: Awaited<ReturnType<typeof translateTextWithLLM>> | null = null;
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        result = await translateTextWithLLM({
          ...promptArgs,
          model: stage.model,
          reasoning: stage.reasoning as ReasoningEffort | undefined,
          maxOutputTokens: stage.maxOutputTokens,
        });
        if (result.ok) break;
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

      // Success: optionally romanize the translation (non-fatal), then write.
      let romanizedText: string | undefined;
      if (ROMANIZATION_LANGUAGES.has(args.targetLanguage)) {
        try {
          romanizedText = await romanizeText(result.text, args.targetLanguage);
        } catch {
          // Non-fatal; downstream backfill action will retry on demand.
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

      await ctx.runMutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          translatedText: result.text,
          voiceName,
          romanizedText,
          regionVariant,
          priority: args.priority,
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
    priority?: 0 | 1;
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
    };
  },
});
