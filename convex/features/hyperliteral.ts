import { v } from 'convex/values';
import { generateText } from 'ai';
import { internal } from '../_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from '../_generated/server';
import { tryGetOpenRouter } from '../lib/openrouter';
import { HYPERLITERAL_REASONING, OPENROUTER_MODELS } from '../config/aiModels';
import {
  buildHyperliteralSystemPrompt,
  parseHyperliteral,
} from '../lib/hyperliteralPrompt';
import { TransientAnnotationError } from '../lib/textAnnotations';
import { isTransientLlmFailure } from './translation';
import {
  captureGeneration,
  openrouterCostUsd,
  openrouterGenerationId,
} from '../lib/posthogAi';
import { hyperliteralApplies } from '../../lib/languages';

/**
 * The hyperliteral gloss engine: one model call per (sentence, gloss
 * language), written into the `hyperliterals` table.
 *
 * Shaped like `romanizeViaLlm` in features/translation.ts, which is the other
 * model-backed annotation, and follows its two hard-won rules. A failure that
 * says nothing about the sentence — no API key, a rate limit, a 5xx — throws
 * `TransientAnnotationError` and leaves the claim open so the cooldown retries
 * it; a failure that IS about the sentence writes the `''` sentinel, so the
 * same doomed call is not paid for on every view.
 *
 * No `"use node"`: this file is plain fetch through the AI SDK and must stay
 * in the default runtime, because it also exports queries and mutations.
 */

const MAX_OUTPUT_TOKENS = 700;
const MAX_ATTEMPTS = 2;

/**
 * Gloss one sentence. Throws `TransientAnnotationError` when the failure is
 * not about the text, and returns `''` never — an unusable reply is the
 * caller's to sentinel, so the decision lives in one place.
 */
export async function hyperliteralForText(
  ctx: ActionCtx,
  args: {
    text: string;
    language: string;
    glossLanguage: string;
    userId?: string;
  },
): Promise<string | null> {
  const openrouter = tryGetOpenRouter();
  if (openrouter === null) {
    throw new TransientAnnotationError('OPENROUTER_API_KEY is not set');
  }
  if (!hyperliteralApplies(args.language, args.glossLanguage)) {
    // A routing mistake, not a fact about the sentence: keep the row open
    // rather than stamping the pair as unglossable.
    throw new TransientAnnotationError(
      `Hyperliteral gloss not applicable for ${args.language} into ${args.glossLanguage}`,
    );
  }
  const system = buildHyperliteralSystemPrompt(
    args.language,
    args.glossLanguage,
  );
  const model = OPENROUTER_MODELS.hyperliteral;
  let lastReply = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    let result;
    try {
      result = await generateText({
        model: openrouter(model),
        system,
        prompt: args.text,
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // No `provider` block: the slug carries `:floor`, which sorts the
        // endpoints by price and makes the flex tier eligible. Pinning one
        // endpoint with `allow_fallbacks: false` used to fail the row outright
        // whenever flex was busy (see romanizeViaLlm, 2026-09-09).
        providerOptions: {
          openrouter: { reasoning: { effort: HYPERLITERAL_REASONING } },
        },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (isTransientLlmFailure(err)) {
        throw new TransientAnnotationError(`hyperliteralForText: ${detail}`);
      }
      throw err instanceof Error ? err : new Error(detail);
    }

    await captureGeneration(ctx, {
      distinctId: args.userId,
      feature: 'hyperliteral',
      model,
      provider: 'openrouter',
      latencyMs: Date.now() - startedAt,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      // `ai_cost` does not run PostHog's automatic model pricing, so the
      // pipeline features pass the billed figure themselves.
      costUsd: openrouterCostUsd(result.providerMetadata),
      traceId: openrouterGenerationId(result.providerMetadata),
    });

    const gloss = parseHyperliteral(result.text);
    if (gloss !== null) return gloss;
    lastReply = result.text;
    console.warn('[hyperliteral] unusable reply', {
      language: args.language,
      glossLanguage: args.glossLanguage,
      attempt,
      preview: result.text.slice(0, 120),
    });
  }
  console.warn('[hyperliteral] giving up', {
    language: args.language,
    preview: lastReply.slice(0, 120),
  });
  return null;
}

/** The claim row an action is about to work on. */
export const loadClaim = internalQuery({
  args: { hyperliteralId: v.id('hyperliterals') },
  returns: v.union(
    v.null(),
    v.object({
      language: v.string(),
      glossLanguage: v.string(),
      forText: v.string(),
      source: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get('hyperliterals', args.hyperliteralId);
    if (!row) return null;
    return {
      language: row.language,
      glossLanguage: row.glossLanguage,
      forText: row.forText,
      source: row.source,
    };
  },
});

/**
 * Store the result. Writes nothing when the row has moved on under the
 * action — a user edit that re-claimed it for a new wording, or an engine bump
 * — which is the same `forText` guard `storeSourceAnnotationHandler` uses.
 */
export const store = internalMutation({
  args: {
    hyperliteralId: v.id('hyperliterals'),
    forText: v.string(),
    source: v.string(),
    // `''` is the deliberate failure sentinel, not an empty result.
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get('hyperliterals', args.hyperliteralId);
    if (!row) return null;
    if (row.forText !== args.forText || row.source !== args.source) return null;
    await ctx.db.patch('hyperliterals', args.hyperliteralId, {
      text: args.text,
    });
    return null;
  },
});

/**
 * Generate one claimed gloss. Scheduled by the content sweep; never retried by
 * the scheduler, because a transient failure leaves the claim open and the
 * cooldown brings it back on the next view.
 */
export const process = internalAction({
  args: {
    hyperliteralId: v.id('hyperliterals'),
    userId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.runQuery(internal.features.hyperliteral.loadClaim, {
      hyperliteralId: args.hyperliteralId,
    });
    if (!claim) return null;

    let gloss: string | null;
    try {
      gloss = await hyperliteralForText(ctx, {
        text: claim.forText,
        language: claim.language,
        glossLanguage: claim.glossLanguage,
        userId: args.userId,
      });
    } catch (err) {
      if (err instanceof TransientAnnotationError) {
        // Says nothing about the sentence. Leave `text` undefined so the
        // cooldown retries it, rather than burning the sentinel.
        console.warn('[hyperliteral] transient failure', {
          language: claim.language,
          detail: err.message.slice(0, 200),
        });
        return null;
      }
      throw err;
    }

    await ctx.runMutation(internal.features.hyperliteral.store, {
      hyperliteralId: args.hyperliteralId,
      forText: claim.forText,
      source: claim.source,
      // '' records "this engine tried this sentence and failed", so the next
      // view does not pay for the same failure again.
      text: gloss ?? '',
    });
    return null;
  },
});

// ------------------------------------------------------------ public access
//
// Deliberately none yet.
//
// The plan called for a public `get` / `ensure` pair so a caller could ask for
// "the German gloss of text X". Both were written and then removed before
// shipping: nothing in the app calls them, and `ensure` as drafted was an
// internet-exposed mutation that scheduled a PAID model call for any
// caller-supplied `textId` and any `glossLanguage`, gated only by "is signed
// in" — no ownership check, no course check, no rate limit. An unused endpoint
// is not worth that.
//
// The capability the table exists for is intact: rows are keyed by gloss
// language, so a second one is new rows rather than a migration. Add the pair
// back with the caller that needs it, and give it the ownership check that
// caller implies.
