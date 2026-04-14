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

/** Provider routing for the chat agent via OpenRouter */
export const OPENROUTER_CHAT_EXTRA_BODY = {
  provider: {
    order: ['io-net/fp8', 'together', 'inceptron/fp8'],
    allow_fallbacks: true,
  },
} as const;

/** OpenAI Audio API — speech-to-text */
export const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
