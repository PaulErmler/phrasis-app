/**
 * Central definitions for LLM / speech models used by Convex AI features.
 * OpenRouter strings are deployment slugs as documented by OpenRouter.
 */

import { LUNA_BO3 } from '../../lib/languages';

/** OpenRouter model IDs by agent or task */
export const OPENROUTER_MODELS = {
  /** Main language-tutor chat (tools, streaming), Gemini 3.7 Flash.
   *  No `:nitro` suffix: nitro re-ranks endpoints each step, and Gemini 3
   *  thought signatures are not portable across Google backends (see
   *  OPENROUTER_CHAT_EXTRA_BODY). */
  languageTeacher: 'google/gemini-3.7-flash',
  /** Bulk translation JSON for custom card auto-fill. Reuses the
   *  single-sentence pipeline's stage (`LUNA_BO3`) so model + no-thinking
   *  reasoning can't drift apart; autofill is a SINGLE call (no sampling,
   *  no judge, that part of the stage is ignored here). Reasoning, the Luna
   *  price cap, and the prompt live in lib/translationAutofillPrompt.ts
   *  (also from the stage), shared with scripts/eval-translation-autofill.ts.
   *  Held on Luna by the Aug 2026 autofill eval: 95% case accuracy vs 100%
   *  for gemini-3.7-flash minimal, but at ~1/18 the cost and half the
   *  latency; Gemini cannot run thinking-free (its reasoning floor is
   *  `minimal`, billed). Re-run `pnpm eval:autofill` before switching. */
  translationAutoFill: LUNA_BO3.model,
  /** Linguistic metadata inference (register, gender, addresseeNumber) for
   *  newly-created cards. Runs once per row, including during bulk import,
   *  so we stay on the lite tier. 3.5 Flash Lite is a tier up from 3.1
   *  ($0.30/$2.50 per M vs $0.25/$1.50), ~33% more per call at identical
   *  token counts, taken for the newer model's accuracy on cross-lingual
   *  gender/register inference. */
  sentenceMetadata: 'google/gemini-3.5-flash-lite',
  /** Short thread title from first user message. Left on 3.1 Flash Lite.
   *  A 4-word title in the user's own language is the one job here where
   *  the newer model buys nothing. */
  threadTitle: 'google/gemini-3.1-flash-lite',
  /** Lenient TTS validation. Decides whether an STT transcription is
   *  semantically equivalent to the original (ignores phonetic name
   *  spellings, digits-vs-words, punctuation, etc.). Only invoked after the
   *  strict Levenshtein check already failed, so every call is a judgment
   *  call on a near-miss.
   *
   *  DELIBERATELY held on 3.1 Flash Lite while sentenceMetadata moved to
   *  3.5 (Jul 2026). A 35-case eval found both models perfect on ordinary
   *  artifacts (diacritics, kana/kanji, 他/她, matra drift, dropped
   *  negations), but on cases where the audio spoke different words for the
   *  same meaning, such as a word-order swap or a dropped Japanese copula, 3.5
   *  answered "match" where 3.1 answered "mismatch". 3.5 reasons about
   *  semantic equivalence; the question here is whether the TTS spoke THIS
   *  text, so that regression would ship broken audio. Re-test before
   *  moving this off 3.1. */
  ttsValidation: 'google/gemini-3.1-flash-lite',
} as const;

/**
 * Reasoning effort for the language-tutor chat agent. Gemini 3.7 Flash
 * thinking levels are minimal / low / medium / high. Chat uses `medium`.
 */
export const OPENROUTER_CHAT_REASONING = 'medium' as const;

/** Headroom for medium thinking + a multi-card tutor reply (explanation
 *  prose, several createCard calls). Thinking tokens count against this
 *  cap; too low and the model finishes its thoughts with no visible reply. */
export const OPENROUTER_CHAT_MAX_OUTPUT_TOKENS = 16_384;

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
 *  per-message credit charge in chat.
 *
 *  Provider routing is load-bearing for Gemini 3 tool loops: each
 *  createCard step echoes an encrypted thought signature that is only
 *  valid on the Google backend that issued it. `:nitro` / fallbacks
 *  hop Studio ↔ Vertex after a 429 and Google then 400s with
 *  "Invalid thought signature." `sort: 'throughput'` still prefers a
 *  fast endpoint on the first step; `allow_fallbacks: false` plus
 *  `session_id` (set per-thread in messages.ts) keep later steps there.
 *  A 429 then fails retryably instead of corrupting the loop. */
export const OPENROUTER_CHAT_EXTRA_BODY = {
  usage: { include: true },
  provider: {
    sort: 'throughput' as const,
    allow_fallbacks: false,
  },
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
 *  Reasoning is streamed (exclude: false) so Gemini thought signatures
 *  survive the tool loop; the chat UI never renders those tokens. It
 *  only shows a Thinking indicator until visible reply text arrives. */
export const OPENROUTER_CHAT_PROVIDER_OPTIONS = {
  openrouter: {
    reasoning: { effort: OPENROUTER_CHAT_REASONING, exclude: false },
  },
} as const;

/**
 * Marks stable prompt prefix blocks for explicit prompt caching on providers
 * that need annotations (Anthropic, Gemini). Attach via
 * `providerOptions.openrouter.cacheControl`. Message-level works for
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
