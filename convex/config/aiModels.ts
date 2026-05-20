/**
 * Central definitions for LLM / speech models used by Convex AI features.
 * OpenRouter strings are deployment slugs as documented by OpenRouter.
 */

/** OpenRouter model IDs by agent or task */
export const OPENROUTER_MODELS = {
  /** Main language-tutor chat (tools, streaming) */
  languageTeacher: 'moonshotai/kimi-k2.6:nitro',
  /** Bulk translation JSON for custom card auto-fill */
  translationAutoFill: 'google/gemini-3.1-flash-lite',
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

/** Provider routing for the chat agent via OpenRouter.
 *  `order` soft-forces wandb fp4 first. preferred_* deprioritize endpoints
 *  slower than 2s p50 / under 40 tok/s p50. */
export const OPENROUTER_CHAT_EXTRA_BODY = {
  provider: {
    order: ['wandb/fp4'],
    allow_fallbacks: true,
    preferred_max_latency: 2,
    preferred_min_throughput: 40,
  },
} as const;
