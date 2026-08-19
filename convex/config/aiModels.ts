/**
 * Central definitions for LLM / speech models used by Convex AI features.
 * OpenRouter strings are deployment slugs as documented by OpenRouter.
 */

import { LUNA_BO3 } from '../../lib/languages';

/** OpenRouter model IDs by agent or task */
export const OPENROUTER_MODELS = {
  /** Main language-tutor chat (tools, streaming) — Gemini 3.7 Flash nitro
   *  (throughput routing via the `:nitro` suffix; see OPENROUTER_CHAT_REASONING). */
  languageTeacher: 'google/gemini-3.7-flash:nitro',
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
 * Reasoning effort for the language-tutor chat agent. Gemini 3.7 Flash
 * thinking levels are minimal / low / medium / high — chat uses `low`
 * for latency.
 */
export const OPENROUTER_CHAT_REASONING = 'low' as const;

/**
 * Per-model OpenRouter settings for the chat agent. Sequential tool calls
 * are a product requirement, not a workaround: the tutor prompt interleaves
 * prose explanation between createCard calls (explain → card → explain →
 * card), which only works when cards are emitted one step at a time.
 */
export const OPENROUTER_CHAT_MODEL_SETTINGS = {
  parallelToolCalls: false,
} as const;

/** Extra OpenRouter body for the chat agent.
 *  `usage.include` makes OpenRouter report the actual USD cost of each
 *  request (providerMetadata.openrouter.usage.cost), which drives the
 *  per-message credit charge in chat. Throughput routing is the `:nitro`
 *  model suffix — no `provider` pin (no Bedrock `order` / `max_price`).
 *  Sequential tool calls are enforced separately via
 *  OPENROUTER_CHAT_MODEL_SETTINGS.parallelToolCalls. */
export const OPENROUTER_CHAT_EXTRA_BODY = {
  usage: { include: true },
} as const;

/**
 * Minimal OpenRouter body that turns on usage accounting.
 *
 * Every non-chat OpenRouter call spreads this in so its real USD cost lands on
 * `providerMetadata.openrouter.usage.cost` and can be reported to PostHog. Chat
 * uses `OPENROUTER_CHAT_EXTRA_BODY` above, which already includes it.
 */
export const OPENROUTER_USAGE_ACCOUNTING = {
  usage: { include: true },
} as const;

/** Default OpenRouter provider options for the chat agent.
 *  `exclude: true` keeps thinking in the billed/hidden channel and out of
 *  the assistant text — without it, Gemini tool-loop steps can leak a
 *  stray reasoning token into the visible reply. */
export const OPENROUTER_CHAT_PROVIDER_OPTIONS = {
  openrouter: {
    reasoning: { effort: OPENROUTER_CHAT_REASONING, exclude: true },
  },
} as const;

/**
 * Marks stable prompt prefix blocks for explicit prompt caching on providers
 * that need annotations (Anthropic, Gemini). Attach via
 * `providerOptions.openrouter.cacheControl` — message-level works for
 * `role: 'system'` messages (the provider emits message-level cache_control
 * there); content-block-level is only required for user/assistant roles.
 *
 * NOTE: Gemini honors this annotation for explicit prefix caching. Keep it
 * on the static system block in messages.ts; `session_id` sticky routing
 * still helps the cache hit across the multi-step tool loop.
 */
export const OPENROUTER_INPUT_CACHE_CONTROL = {
  type: 'ephemeral',
} as const;
