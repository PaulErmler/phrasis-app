import { EVENTS, track, type SchedulerCtx } from '../analytics';

/**
 * Which product surface caused the spend. This is the dimension that answers
 * "what is each feature costing us", so it is a closed union rather than a free
 * string. A typo would quietly create a second, half-empty cost bucket.
 */
export type AiFeature =
  | 'chat'
  | 'chat_title'
  | 'chat_voice_input'
  | 'translation'
  | 'translation_autofill'
  | 'sentence_metadata'
  | 'tts_synthesis'
  | 'tts_validation_judge'
  | 'word_timing_backfill'
  | 'machine_translation'
  | 'writing_feedback';

/**
 * Features routed to the plain `ai_cost` event instead of `$ai_generation`.
 *
 * PostHog meters `$ai_generation` per event under AI Observability (100K
 * free/month, then paid), while ordinary events ride the product-analytics
 * tier (1M free/month). The content pipeline fires per *sentence*, not per
 * user action, and pushed the metered product past its free tier for a UI
 * (conversation view, auto model pricing) these events never use: they carry
 * no prompts/responses and compute `costUsd` themselves. Rerouted Aug 2026;
 * same fields, just non-reserved property names.
 */
const PIPELINE_FEATURES: ReadonlySet<AiFeature> = new Set([
  'translation',
  'machine_translation',
  'sentence_metadata',
  'tts_synthesis',
  'tts_validation_judge',
  'word_timing_backfill',
]);

export type CaptureGenerationArgs = {
  /**
   * The user this spend is attributed to.
   *
   * Content is shared by design. A translation generated for one user is
   * reused by every other user who reaches the same sentence, so this is the
   * *requesting* user, paired with `sharedContent` below. Per-user cost then
   * reads as "spend this user caused", and the app-wide total stays exact
   * because nothing is counted twice.
   *
   * Omitted for work with no identifiable requester; the event still counts
   * toward totals, just not toward a person.
   */
  distinctId?: string;
  feature: AiFeature;
  model: string;
  provider: string;
  latencyMs: number;

  inputTokens?: number;
  outputTokens?: number;
  /**
   * Exact spend in USD when the provider reports it (OpenRouter with
   * `usage: { include: true }`) or when we compute it from a published rate
   * (see `convex/config/aiCosts.ts`).
   *
   * PostHog's automatic pricing (from token counts + model name) only runs on
   * `$ai_generation`, so leaving this undefined is acceptable ONLY for
   * conversational features. Pipeline features (see `PIPELINE_FEATURES`) emit
   * the plain `ai_cost` event, where an undefined cost is an unpriceable gap.
   */
  costUsd?: number;

  /** Prompt, in PostHog's chat-message shape. */
  input?: Array<{ role: string; content: string }>;
  /** Completion, same shape wrapped as choices. */
  outputChoices?: Array<{ role: string; content: string }>;

  /** OpenRouter generation id where available. The join key back to their dashboard. */
  traceId?: string;
  isError?: boolean;
  error?: string;
  /** True when the artifact produced is reusable across users. */
  sharedContent?: boolean;
  /** Anything feature-specific: language, courseId, character counts, thread position. */
  extra?: Record<string, unknown>;
};

/**
 * Shape OpenRouter returns on `providerMetadata` when `usage: { include: true }`
 * is set. Typed locally because the AI SDK models provider metadata as
 * `Record<string, JSONValue>` and gives us nothing to narrow against.
 */
type OpenRouterProviderMetadata = {
  openrouter?: {
    id?: string;
    usage?: { cost?: number };
  };
};

/** Actual USD cost of an OpenRouter call, or undefined if usage accounting was off. */
export function openrouterCostUsd(
  providerMetadata: unknown,
): number | undefined {
  return (providerMetadata as OpenRouterProviderMetadata | undefined)
    ?.openrouter?.usage?.cost;
}

/** OpenRouter's generation id. The join key back to their dashboard for reconciliation. */
export function openrouterGenerationId(
  providerMetadata: unknown,
): string | undefined {
  return (providerMetadata as OpenRouterProviderMetadata | undefined)
    ?.openrouter?.id;
}

/**
 * Emit one AI-spend event.
 *
 * Two wire formats behind one call site contract (see `PIPELINE_FEATURES`):
 *
 *  - Conversational features emit `$ai_generation`. `$ai_*` is PostHog's
 *    reserved LLM-analytics schema: those property names are what make the
 *    spend show up in the LLM analytics product with cost, latency and token
 *    charts, and what lets chat attach consented prompts/responses.
 *  - Pipeline features emit the plain `ai_cost` event with the same fields
 *    under non-reserved names (`model`, `cost_usd`, `latency_ms`, …), so they
 *    bill as ordinary product analytics. Cost dashboards for these are plain
 *    insights over `ai_cost`; PostHog's automatic model pricing does not run,
 *    so pipeline call sites must pass `costUsd` whenever they can compute it.
 */
export async function captureGeneration(
  ctx: SchedulerCtx,
  args: CaptureGenerationArgs,
): Promise<void> {
  const {
    distinctId,
    feature,
    model,
    provider,
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd,
    input,
    outputChoices,
    traceId,
    isError,
    error,
    sharedContent,
    extra,
  } = args;

  // Dimensions shared by both wire formats. The ones dashboards slice by.
  const dimensions = {
    feature,
    shared_content: sharedContent ?? false,
    attributed: distinctId !== undefined,
    ...extra,
  };

  // PostHog requires a distinct id. Unattributable background work is bucketed
  // under one synthetic id rather than dropped. The money was still spent.
  const eventDistinctId = distinctId ?? 'system:content-pipeline';

  if (PIPELINE_FEATURES.has(feature)) {
    await track(ctx, eventDistinctId, EVENTS.AI_COST, {
      model,
      provider,
      latency_ms: latencyMs,
      ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
      ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
      ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
      ...(isError ? { is_error: true } : {}),
      ...(error ? { error } : {}),
      ...dimensions,
    });
    return;
  }

  await track(ctx, eventDistinctId, EVENTS.AI_GENERATION, {
    $ai_model: model,
    $ai_provider: provider,
    // PostHog measures latency in seconds.
    $ai_latency: latencyMs / 1000,
    ...(inputTokens !== undefined ? { $ai_input_tokens: inputTokens } : {}),
    ...(outputTokens !== undefined ? { $ai_output_tokens: outputTokens } : {}),
    ...(costUsd !== undefined ? { $ai_total_cost_usd: costUsd } : {}),
    ...(input ? { $ai_input: input } : {}),
    ...(outputChoices ? { $ai_output_choices: outputChoices } : {}),
    ...(traceId ? { $ai_trace_id: traceId } : {}),
    ...(isError ? { $ai_is_error: true } : {}),
    ...(error ? { $ai_error: error } : {}),
    ...dimensions,
  });
}
