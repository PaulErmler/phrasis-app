/**
 * Central definitions for LLM / speech models used by Convex AI features.
 * OpenRouter strings are deployment slugs as documented by OpenRouter.
 */

/** OpenRouter model IDs by agent or task */
export const OPENROUTER_MODELS = {
  /** Main language-tutor chat (tools, streaming) */
  languageTeacher: 'z-ai/glm-5.1:nitro',
  /** Bulk translation JSON for custom card auto-fill */
  translationAutoFill: 'google/gemini-3-flash-preview',
  /** Short thread title from first user message */
  threadTitle: 'google/gemini-3.1-flash-lite-preview',
} as const;

/** Provider routing for the chat agent via OpenRouter.
 *  `order` soft-forces io-net fp8 first, then together. `allow_fallbacks`
 *  is false because io-net/together don't expose tool-calling endpoints
 *  for GLM, and the chat agent needs the createCard tool — letting
 *  OpenRouter silently fall back to a non-tool provider would break
 *  createCard. preferred_* deprioritize endpoints slower than 2s p50 /
 *  under 50 tok/s p50. */
export const OPENROUTER_CHAT_EXTRA_BODY = {
  provider: {
    order: ['io-net/fp8', 'io-net', 'together'],
    allow_fallbacks: true,
    preferred_max_latency: 2,
    preferred_min_throughput: 40,
  },
} as const;

/** OpenAI Audio API — speech-to-text */
export const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
