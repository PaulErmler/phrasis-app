/**
 * Central definitions for LLM / speech models used by Convex AI features.
 * OpenRouter strings are deployment slugs as documented by OpenRouter.
 */

import { GEMINI_35_FLASH_NITRO_MINIMAL } from '../../lib/languages';

/** OpenRouter model IDs by agent or task */
export const OPENROUTER_MODELS = {
  /** Main language-tutor chat (tools, streaming) — high thinking */
  languageTeacher: 'z-ai/glm-5.2:nitro',
  /** Bulk translation JSON for custom card auto-fill. Reuses the
   *  single-sentence pipeline's stage so model + `minimal` reasoning can't
   *  drift apart; the reasoning effort is set at the call site in
   *  customTexts.ts (also from the stage). */
  translationAutoFill: GEMINI_35_FLASH_NITRO_MINIMAL.model,
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

/** Reasoning effort for the language-tutor chat agent (GLM 5.2: `high` | `xhigh`). */
export const OPENROUTER_CHAT_REASONING = 'high' as const;

/** Extra OpenRouter body for the chat agent.
 *  `usage.include` makes OpenRouter report the actual USD cost of each
 *  request (providerMetadata.openrouter.usage.cost), which drives the
 *  per-message credit charge in chat. `max_price.completion` caps output
 *  at $5/M tokens; requests fail if no provider qualifies. preferred_*
 *  deprioritize endpoints slower than 2s p50 / under 50 tok/s p50.
 *  `require_parameters` restricts routing to providers that support every
 *  request parameter — critically `tools`, which createCard depends on;
 *  without it a fallback provider without tool calling silently breaks
 *  flashcard proposals. */
export const OPENROUTER_CHAT_EXTRA_BODY = {
  usage: { include: true },
  provider: {
    allow_fallbacks: true,
    require_parameters: true,
    max_price: {
      completion: 5,
    },
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
