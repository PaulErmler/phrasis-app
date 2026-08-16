/**
 * Central definitions for LLM / speech models used by Convex AI features.
 * OpenRouter strings are deployment slugs as documented by OpenRouter.
 */

import { LUNA_BO3, LUNA_PROVIDER_CONSTRAINTS } from '../../lib/languages';

/** OpenRouter model IDs by agent or task */
export const OPENROUTER_MODELS = {
  /** Main language-tutor chat (tools, streaming) — Luna nitro, adaptive
   *  max thinking (see OPENROUTER_CHAT_REASONING). */
  languageTeacher: 'openai/gpt-5.6-luna:nitro',
  /** Bulk translation JSON for custom card auto-fill. Reuses the
   *  single-sentence pipeline's stage (`LUNA_BO3`) so model + no-thinking
   *  reasoning can't drift apart; autofill is a SINGLE call (no sampling,
   *  no judge — that part of the stage is ignored here). Reasoning and the
   *  Luna price cap are set at the call site in customTexts.ts (also from
   *  the stage). */
  translationAutoFill: LUNA_BO3.model,
  /** Linguistic metadata inference (register, gender, addresseeNumber) for
   *  newly-created cards. Runs once per row, including during bulk import,
   *  so we stay on the lite tier. 3.5 Flash Lite is a tier up from 3.1
   *  ($0.30/$2.50 per M vs $0.25/$1.50) — ~33% more per call at identical
   *  token counts, taken for the newer model's accuracy on cross-lingual
   *  gender/register inference. */
  sentenceMetadata: 'google/gemini-3.5-flash-lite',
  /** Short thread title from first user message. Left on 3.1 Flash Lite —
   *  a 4-word title in the user's own language is the one job here where
   *  the newer model buys nothing. */
  threadTitle: 'google/gemini-3.1-flash-lite',
  /** Lenient TTS validation — decides whether an STT transcription is
   *  semantically equivalent to the original (ignores phonetic name
   *  spellings, digits-vs-words, punctuation, etc.). Only invoked after the
   *  strict Levenshtein check already failed, so every call is a judgment
   *  call on a near-miss.
   *
   *  DELIBERATELY held on 3.1 Flash Lite while sentenceMetadata moved to
   *  3.5 (Jul 2026). A 35-case eval found both models perfect on ordinary
   *  artifacts (diacritics, kana/kanji, 他/她, matra drift, dropped
   *  negations), but on cases where the audio spoke different words for the
   *  same meaning — a word-order swap, a dropped Japanese copula — 3.5
   *  answered "match" where 3.1 answered "mismatch". 3.5 reasons about
   *  semantic equivalence; the question here is whether the TTS spoke THIS
   *  text, so that regression would ship broken audio. Re-test before
   *  moving this off 3.1. */
  ttsValidation: 'google/gemini-3.1-flash-lite',
} as const;

/**
 * Reasoning effort for the language-tutor chat agent. GPT-5.6 Luna reasons
 * ADAPTIVELY in its (default) standard mode: trivial prompts still get 0
 * reasoning tokens regardless of effort; substantive tutoring questions
 * think under `max` (OpenAI's highest single-pass effort, below `pro`
 * mode). Do NOT switch to `reasoning.mode: 'pro'` for chat: Bedrock
 * silently ignores it, and on OpenAI/Azure it forces heavy multi-pass
 * reasoning on every reply (28–60 s at high effort), unusable interactively.
 */
export const OPENROUTER_CHAT_REASONING = 'max' as const;

/**
 * Per-model OpenRouter settings for the chat agent. Sequential tool calls
 * are a product requirement, not a workaround: the tutor prompt interleaves
 * prose explanation between createCard calls (explain → card → explain →
 * card), which only works when cards are emitted one step at a time.
 * (Historically this also dodged a Gemini-3 thought_signature bug with
 * parallel functionCalls; that model is gone but the setting stays.)
 */
export const OPENROUTER_CHAT_MODEL_SETTINGS = {
  parallelToolCalls: false,
} as const;

/** Extra OpenRouter body for the chat agent.
 *  `usage.include` makes OpenRouter report the actual USD cost of each
 *  request (providerMetadata.openrouter.usage.cost), which drives the
 *  per-message credit charge in chat. `sort: "throughput"` ranks remaining
 *  endpoints after `order` (same as the `:nitro` model suffix).
 *  Luna routing (`order` + `max_price`) is shared with translation via
 *  `LUNA_PROVIDER_CONSTRAINTS` — Bedrock us-east-1 first, $2/M-out ceiling.
 *  preferred_* deprioritize endpoints slower than 2s p50 / under 50 tok/s.
 *
 *  Do NOT set `require_parameters: true` here — verified 2026-08-04 that it
 *  404s ("No endpoints found that can handle the requested parameters") for
 *  gpt-5.6-luna with tools even WITHOUT a reasoning field. Sequential tool
 *  calls are enforced separately via
 *  OPENROUTER_CHAT_MODEL_SETTINGS.parallelToolCalls. */
export const OPENROUTER_CHAT_EXTRA_BODY = {
  usage: { include: true },
  provider: {
    sort: 'throughput',
    allow_fallbacks: true,
    ...LUNA_PROVIDER_CONSTRAINTS,
    preferred_max_latency: 2,
    preferred_min_throughput: 50,
  },
} as const;

/**
 * Minimal OpenRouter body that turns on usage accounting.
 *
 * Every non-chat OpenRouter call spreads this in so its real USD cost lands on
 * `providerMetadata.openrouter.usage.cost` and can be reported to PostHog. Chat
 * uses `OPENROUTER_CHAT_EXTRA_BODY` above, which already includes it alongside
 * the routing constraints chat specifically needs.
 */
export const OPENROUTER_USAGE_ACCOUNTING = {
  usage: { include: true },
} as const;

/** Default OpenRouter provider options for the chat agent. */
export const OPENROUTER_CHAT_PROVIDER_OPTIONS = {
  openrouter: {
    reasoning: { effort: OPENROUTER_CHAT_REASONING },
  },
} as const;

/**
 * Marks stable prompt prefix blocks for explicit prompt caching on providers
 * that need annotations (Anthropic, Gemini). Attach via
 * `providerOptions.openrouter.cacheControl` — message-level works for
 * `role: 'system'` messages (the provider emits message-level cache_control
 * there); content-block-level is only required for user/assistant roles.
 *
 * NOTE: for the current OpenAI-family chat model this marker is inert —
 * OpenAI prefix caching is automatic for stable ≥1k-token prefixes and
 * ignores cache_control. It's kept so a future swap back to an
 * Anthropic/Gemini chat model keeps its caching without anyone remembering
 * to re-add the annotation; the real work on OpenAI is done by prefix
 * stability + the `session_id` sticky-routing key in messages.ts.
 */
export const OPENROUTER_INPUT_CACHE_CONTROL = {
  type: 'ephemeral',
} as const;
