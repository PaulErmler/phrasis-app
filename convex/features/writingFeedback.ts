import { ConvexError, v, type Infer } from 'convex/values';
import { action, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import { generateText } from 'ai';
import { requireAuthUserId } from '../db/users';
import { consumeQuota, quotaErrorCode, releaseQuota } from '../usage/helpers';
import {
  AI_FEEDBACK_FREE_GRANT,
  AI_FEEDBACK_PAID_GRANT,
  FEATURE_IDS,
} from './featureIds';
import { autumnFetchRaw } from '../usage/autumnClient';
import { storeWritingAlternative } from './writingAlternatives';
import { getOpenRouter } from '../lib/openrouter';
import { OPENROUTER_USAGE_ACCOUNTING } from '../config/aiModels';
import { openrouterCallOptions } from './translationLLM';
import {
  MAX_CARD_TEXT_LENGTH,
  WRITING_ALTERNATIVES_MAX,
} from '../../lib/constants/learning';
import {
  normalizeForComparison,
  textsMatchForLanguage,
} from '../lib/textComparison';
import {
  captureGeneration,
  openrouterCostUsd,
  openrouterGenerationId,
} from '../lib/posthogAi';
import {
  buildGraderUserPrompt,
  buildTranscribeGraderUserPrompt,
  GRADER_MAX_OUTPUT_TOKENS,
  GRADER_MODEL,
  GRADER_PROVIDER,
  GRADER_REASONING,
  GRADER_RESPONSE_FORMAT,
  GRADER_SYSTEM_PROMPT,
  parseFeedbackResponse,
  TRANSCRIBE_GRADER_RESPONSE_FORMAT,
  TRANSCRIBE_GRADER_SYSTEM_PROMPT,
} from '../lib/writingFeedbackPrompt';

/**
 * AI feedback for writing mode. One stateless grader call scores the user's
 * typed (or dictated) answer against the card's expected translation and
 * returns a compact verdict + up to two notes + a minimally-corrected
 * sentence. Exact matches — against the primary translation or any of the
 * user's stored accepted alternatives — are decided locally and consume no
 * quota and no LLM call.
 *
 * Both writing styles grade here: Translate judges the answer as a
 * translation (alternatives count, 'alsoCorrect' can store one), Transcribe
 * as a reproduction of the target audio (primary-only gate, transcription
 * prompt/schema, no alternatives in or out). See `mode` on the action.
 *
 * Latency is the design constraint (JIVX-parity is ~2s): single sample, no
 * judge. Visible notes stay short; the 2k output cap is headroom for
 * gpt-oss hidden reasoning at `low` effort.
 *
 * The prompt, the response schema, and the reply parser live in
 * lib/writingFeedbackPrompt.ts so scripts/eval-writing-feedback.ts can grade
 * through the exact production path without importing this module's Convex
 * and AI SDK dependencies.
 */

// Re-exported so the convex tests and callers keep one import site; the
// value lives in lib/constants so getCardForReview can use it without
// pulling this module's AI SDK imports into the hot query path.
export { WRITING_ALTERNATIVES_MAX } from '../../lib/constants/learning';
export {
  GRADER_SYSTEM_PROMPT,
  parseFeedbackResponse,
} from '../lib/writingFeedbackPrompt';

const feedbackNoteValidator = v.object({
  type: v.union(
    v.literal('grammar'),
    v.literal('wordChoice'),
    v.literal('vocab'),
    v.literal('spelling'),
    v.literal('punctuation'),
    v.literal('register'),
    v.literal('wordOrder'),
    v.literal('naturalness'),
  ),
  text: v.string(),
});

export const writingFeedbackResultValidator = v.object({
  verdict: v.union(
    v.literal('correct'),
    v.literal('alsoCorrect'),
    v.literal('minor'),
    v.literal('partial'),
    v.literal('wrong'),
    v.literal('error'),
  ),
  // For 'correct': which stored text the answer matched.
  matched: v.optional(v.union(v.literal('primary'), v.literal('alternative'))),
  corrected: v.optional(v.string()),
  notes: v.optional(v.array(feedbackNoteValidator)),
  /** alsoCorrect + matching register/gender/addressee: `corrected` was stored
   * as an accepted alternative automatically. */
  savedAlternative: v.optional(v.boolean()),
});

export type WritingFeedbackResult = Infer<
  typeof writingFeedbackResultValidator
>;

/**
 * "Same answer" for the local gate: punctuation/case/whitespace-insensitive
 * equality, plus romanized equality for zh/ko so homophone-character swaps
 * (在 vs 再) count as matches — `textsMatchForLanguage`'s romanize flow with
 * an exact-equality leaf. Deliberately NOT edit-distance tolerant: a
 * one-character typo should reach the LLM and come back as a 'minor'
 * verdict with the typo named, not silently pass.
 */
export function writingAnswersMatch(
  expected: string,
  answer: string,
  language: string,
): boolean {
  return textsMatchForLanguage(
    expected,
    answer,
    language,
    (a, b) => normalizeForComparison(a) === normalizeForComparison(b),
  );
}

/**
 * Ownership walk + everything the grading prompt needs, in one query.
 * Mirrors `resolveCardContext` (chat/cardContext.ts) but adds the text row's
 * linguistic metadata and the user's stored alternatives, and resolves just
 * the one graded language.
 */
export const getGradingContext = internalQuery({
  args: {
    userId: v.string(),
    cardId: v.id('cards'),
    language: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      baseText: v.string(),
      baseLanguage: v.string(),
      notesLanguage: v.string(),
      expected: v.string(),
      alternatives: v.array(v.string()),
      metadata: v.object({
        register: v.optional(v.string()),
        speakerGender: v.optional(v.string()),
        addresseeGender: v.optional(v.string()),
        addresseeNumber: v.optional(v.string()),
        addressesSomeone: v.optional(v.boolean()),
      }),
    }),
  ),
  handler: async (ctx, { userId, cardId, language }) => {
    const card = await ctx.db.get(cardId);
    if (!card) return null;
    const deck = await ctx.db.get(card.deckId);
    if (!deck) return null;
    const course = await ctx.db.get(deck.courseId);
    if (!course || course.userId !== userId) return null;
    const text = await ctx.db.get(card.textId);
    if (!text) return null;

    let expected: string | null;
    if (text.language === language) {
      expected = text.text;
    } else {
      const row = await ctx.db
        .query('translations')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', card.textId).eq('targetLanguage', language),
        )
        .first();
      expected = row?.translatedText ?? null;
    }
    if (expected === null) return null;

    const alternativeRows = await ctx.db
      .query('writingAlternatives')
      .withIndex('by_cardId_and_language', (q) =>
        q.eq('cardId', cardId).eq('language', language),
      )
      .take(WRITING_ALTERNATIVES_MAX * 2);

    return {
      baseText: text.text,
      baseLanguage: text.language,
      notesLanguage: course.baseLanguages[0] ?? text.language,
      expected,
      alternatives: alternativeRows.map((r) => r.text),
      metadata: {
        register: text.register,
        speakerGender: text.speakerGender,
        addresseeGender: text.addresseeGender,
        addresseeNumber: text.addresseeNumber,
        addressesSomeone: text.addressesSomeone,
      },
    };
  },
});

export const consumeAiFeedbackQuota = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await consumeQuota(ctx, args.userId, FEATURE_IDS.AI_FEEDBACK, 1);
    return null;
  },
});

/**
 * Compensation for the consume-before-call ordering: when the grader call
 * itself fails (provider outage, timeout), the user got nothing and the unit
 * comes back. Deliberately NOT called for an unparseable reply — the model
 * did run on the user's answer, so that unit stays spent (see the grade
 * action's parse-failure branch).
 */
export const refundAiFeedbackQuota = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await releaseQuota(ctx, args.userId, FEATURE_IDS.AI_FEEDBACK, 1);
    return null;
  },
});

/**
 * Self-heal for accounts that predate the ai_feedback feature. Their Autumn
 * customer was attached before the plans carried the item, so the plan push
 * never materialized a balance and `consumeQuota` reads the missing entry as
 * a hard USAGE_LIMIT. `checkAiFeedbackProvision` distinguishes that state
 * from a genuinely spent balance; the action then grants the plan's amount
 * via Autumn `balances.create`, mirrors it locally, and retries once.
 */
export const checkAiFeedbackProvision = internalQuery({
  args: { userId: v.string() },
  returns: v.object({
    provisioned: v.boolean(),
    planId: v.optional(v.string()),
  }),
  handler: async (ctx, { userId }) => {
    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    return {
      // No doc at all = QUOTA_NOT_SYNCED territory, not ours to heal.
      provisioned: !doc || doc.features[FEATURE_IDS.AI_FEEDBACK] !== undefined,
      planId: doc?.planId,
    };
  },
});

export const mirrorAiFeedbackGrant = internalMutation({
  args: { userId: v.string(), included: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique();
    if (!doc || doc.features[FEATURE_IDS.AI_FEEDBACK] !== undefined)
      return null;
    await ctx.db.patch(doc._id, {
      features: {
        ...doc.features,
        [FEATURE_IDS.AI_FEEDBACK]: {
          balance: args.included,
          included: args.included,
          used: 0,
        },
      },
    });
    return null;
  },
});

/**
 * Store an accepted alternative after an `alsoCorrect + altOk` grade.
 * Re-verifies ownership (internal, but called from an action after time has
 * passed), then delegates to the shared store helper (dedupe, cap-evict,
 * annotation + audio generation) in features/writingAlternatives.ts.
 */
export const storeAlternative = internalMutation({
  args: {
    userId: v.string(),
    cardId: v.id('cards'),
    language: v.string(),
    text: v.string(),
    primary: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return false;
    const deck = await ctx.db.get(card.deckId);
    if (!deck) return false;
    const course = await ctx.db.get(deck.courseId);
    if (!course || course.userId !== args.userId) return false;

    return (await storeWritingAlternative(ctx, args)) !== null;
  },
});

/**
 * Grade one writing-mode answer. Returns `verdict: 'correct'` from the local
 * gate (free), a graded verdict from the LLM, or `verdict: 'error'` when the
 * model call or parse failed (the client then renders today's diff-only
 * view). Throws USAGE_LIMIT / PAYMENT_PAST_DUE from the quota check.
 *
 * `mode` picks the grading task: 'translate' (the default, so pre-mode
 * clients keep working) grades the answer as a translation of the base
 * sentence; 'transcribe' grades it as a transcription of the target audio —
 * only the card's exact sentence is correct there, so stored alternatives
 * grant no credit, the transcription prompt/schema is used (no
 * 'alsoCorrect'), and nothing is ever stored as an alternative.
 */
export const gradeWritingAnswer = action({
  args: {
    cardId: v.id('cards'),
    language: v.string(),
    userAnswer: v.string(),
    mode: v.optional(v.union(v.literal('translate'), v.literal('transcribe'))),
  },
  returns: writingFeedbackResultValidator,
  handler: async (ctx, args): Promise<WritingFeedbackResult> => {
    const userId = await requireAuthUserId(ctx);
    const transcribe = args.mode === 'transcribe';

    const userAnswer = args.userAnswer.trim();
    if (!userAnswer) {
      throw new ConvexError({
        code: 'EMPTY_ANSWER',
        message: 'Answer is empty',
      });
    }
    // Same cap card text lives under; bounds the prompt against injection
    // payloads smuggled through the answer field.
    if (userAnswer.length > MAX_CARD_TEXT_LENGTH) {
      throw new ConvexError({
        code: 'TEXT_TOO_LONG',
        message: 'Answer exceeds the maximum length',
      });
    }

    // Explicit annotation: same-file function reference, see the circularity
    // note in convex/_generated/ai/guidelines.md.
    const context: {
      baseText: string;
      baseLanguage: string;
      notesLanguage: string;
      expected: string;
      alternatives: string[];
      metadata: {
        register?: string;
        speakerGender?: string;
        addresseeGender?: string;
        addresseeNumber?: string;
        addressesSomeone?: boolean;
      };
    } | null = await ctx.runQuery(
      internal.features.writingFeedback.getGradingContext,
      { userId, cardId: args.cardId, language: args.language },
    );
    if (!context) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Card not found' });
    }

    // Local gate: no quota, no LLM. In transcribe only the card's sentence
    // counts — an accepted alternative is a different sentence than the
    // audio, so it must not grant credit there.
    if (writingAnswersMatch(context.expected, userAnswer, args.language)) {
      return { verdict: 'correct' as const, matched: 'primary' as const };
    }
    if (!transcribe) {
      for (const alt of context.alternatives) {
        if (writingAnswersMatch(alt, userAnswer, args.language)) {
          return {
            verdict: 'correct' as const,
            matched: 'alternative' as const,
          };
        }
      }
    }

    // Build everything the grader call needs BEFORE consuming the quota
    // unit. The refund below only covers the LLM try; a throw in prompt or
    // option construction after the consume would charge the user for a
    // grade that never ran.
    const userPrompt = transcribe
      ? buildTranscribeGraderUserPrompt({
          targetLanguage: args.language,
          notesLanguage: context.notesLanguage,
          expected: context.expected,
          userAnswer,
        })
      : buildGraderUserPrompt({
          baseLanguage: context.baseLanguage,
          targetLanguage: args.language,
          notesLanguage: context.notesLanguage,
          baseText: context.baseText,
          expected: context.expected,
          metadata: context.metadata,
          userAnswer,
        });

    const providerOptions = openrouterCallOptions(
      GRADER_REASONING,
      GRADER_PROVIDER,
    );

    try {
      await ctx.runMutation(
        internal.features.writingFeedback.consumeAiFeedbackQuota,
        { userId },
      );
    } catch (error) {
      if (quotaErrorCode(error) !== 'USAGE_LIMIT') throw error;
      // USAGE_LIMIT with no ai_feedback entry at all means the account
      // predates the feature (see checkAiFeedbackProvision). Provision the
      // plan's grant in Autumn, mirror it, retry once; a genuinely spent
      // balance (entry present) rethrows to the paywall.
      const provision: { provisioned: boolean; planId?: string } =
        await ctx.runQuery(
          internal.features.writingFeedback.checkAiFeedbackProvision,
          { userId },
        );
      if (provision.provisioned) throw error;
      const paid =
        provision.planId !== undefined && provision.planId !== 'free';
      const included = paid ? AI_FEEDBACK_PAID_GRANT : AI_FEEDBACK_FREE_GRANT;
      try {
        const res = await autumnFetchRaw(
          'POST',
          '/balances.create',
          {
            customer_id: userId,
            feature_id: FEATURE_IDS.AI_FEEDBACK,
            included_grant: included,
            // Deterministic id: a concurrent double-heal upserts/collides
            // instead of granting twice.
            balance_id: `ai_feedback_backfill_${userId}`,
            ...(paid ? { reset: { interval: 'month' } } : {}),
          },
          '2.2',
        );
        if (!res.ok) {
          console.error(
            `writingFeedback: balances.create failed (${res.status}): ${res.text}`,
          );
          throw error;
        }
      } catch (healError) {
        // Autumn unreachable / misconfigured: surface the original limit.
        console.error('writingFeedback: self-heal failed', healError);
        throw error;
      }
      await ctx.runMutation(
        internal.features.writingFeedback.mirrorAiFeedbackGrant,
        { userId, included },
      );
      await ctx.runMutation(
        internal.features.writingFeedback.consumeAiFeedbackQuota,
        { userId },
      );
    }

    const startedAt = Date.now();
    let text: string;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    let providerMetadata: Record<string, unknown> | undefined;
    try {
      // Inside the try so a missing key refunds the quota unit like any
      // other transport failure. The response schema goes on extraBody, which
      // the OpenRouter provider spreads into the request body — the usage
      // accounting default has to be spread back in or cost telemetry dies.
      const openrouter = getOpenRouter({
        ...OPENROUTER_USAGE_ACCOUNTING,
        response_format: transcribe
          ? TRANSCRIBE_GRADER_RESPONSE_FORMAT
          : GRADER_RESPONSE_FORMAT,
      });
      ({ text, usage, providerMetadata } = await generateText({
        model: openrouter(GRADER_MODEL),
        system: transcribe
          ? TRANSCRIBE_GRADER_SYSTEM_PROMPT
          : GRADER_SYSTEM_PROMPT,
        prompt: userPrompt,
        maxOutputTokens: GRADER_MAX_OUTPUT_TOKENS,
        ...(providerOptions ? { providerOptions } : {}),
      }));
    } catch (error) {
      console.error('writingFeedback: LLM call failed', error);
      // Transport failure: the user got nothing, so the unit consumed above
      // comes back. The parse-failure branch below deliberately does NOT
      // refund — there the model ran on the answer, it just replied garbage.
      try {
        await ctx.runMutation(
          internal.features.writingFeedback.refundAiFeedbackQuota,
          { userId },
        );
      } catch (refundError) {
        console.error('writingFeedback: quota refund failed', refundError);
      }
      await captureGeneration(ctx, {
        distinctId: userId,
        feature: 'writing_feedback',
        model: GRADER_MODEL,
        provider: 'openrouter',
        latencyMs: Date.now() - startedAt,
        isError: true,
        error: error instanceof Error ? error.message : String(error),
      });
      return { verdict: 'error' as const };
    }

    await captureGeneration(ctx, {
      distinctId: userId,
      feature: 'writing_feedback',
      model: GRADER_MODEL,
      provider: 'openrouter',
      latencyMs: Date.now() - startedAt,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd: openrouterCostUsd(providerMetadata),
      traceId: openrouterGenerationId(providerMetadata),
      extra: {
        language: args.language,
        mode: transcribe ? 'transcribe' : 'translate',
      },
    });

    const parsed = parseFeedbackResponse(text);
    if (!parsed) {
      console.error(
        'writingFeedback: unparseable grader reply',
        text.slice(0, 300),
      );
      return { verdict: 'error' as const };
    }

    if (transcribe) {
      // No `corrected` (the diff target stays the card's sentence) and never
      // an alternative. The strict transcribe schema keeps 'alsoCorrect' out;
      // if an endpoint that ignored response_format produced it anyway, a
      // paraphrase is still not what the audio said — downgrade, don't praise.
      return {
        verdict:
          parsed.verdict === 'alsoCorrect'
            ? ('partial' as const)
            : parsed.verdict,
        notes: parsed.notes,
      };
    }

    let savedAlternative: boolean = false;
    if (parsed.verdict === 'alsoCorrect' && parsed.altOk) {
      savedAlternative = await ctx.runMutation(
        internal.features.writingFeedback.storeAlternative,
        {
          userId,
          cardId: args.cardId,
          language: args.language,
          // The polished form when the model produced one, else the raw answer.
          text: parsed.corrected ?? userAnswer,
          primary: context.expected,
        },
      );
    }

    return {
      verdict: parsed.verdict,
      corrected: parsed.corrected,
      notes: parsed.notes,
      savedAlternative,
    };
  },
});
