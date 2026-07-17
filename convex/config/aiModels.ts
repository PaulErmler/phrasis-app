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
   *  so we pick the cheaper/faster lite tier. */
  sentenceMetadata: 'google/gemini-3.1-flash-lite',
  /** Short thread title from first user message */
  threadTitle: 'google/gemini-3.1-flash-lite',
  /** Lenient TTS validation — decides whether an STT transcription is
   *  semantically equivalent to the original (ignores phonetic name
   *  spellings, digits-vs-words, punctuation, etc.). */
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

/** Default OpenRouter provider options for the chat agent. */
export const OPENROUTER_CHAT_PROVIDER_OPTIONS = {
  openrouter: {
    reasoning: { effort: OPENROUTER_CHAT_REASONING },
  },
} as const;
