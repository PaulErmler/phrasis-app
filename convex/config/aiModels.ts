/**
 * Central definitions for LLM / speech models used by Convex AI features.
 * OpenRouter strings are deployment slugs as documented by OpenRouter.
 */

/** OpenRouter model IDs by agent or task */
export const OPENROUTER_MODELS = {
  /** Main language-tutor chat (tools, streaming) */
  languageTeacher: 'moonshotai/kimi-k2.5:nitro',
  /** Bulk translation JSON for custom card auto-fill */
  translationAutoFill: 'google/gemini-3-flash-preview',
  /** Short thread title from first user message */
  threadTitle: 'google/gemini-3.1-flash-lite-preview',
} as const;

/** Routed first to Fireworks for the chat agent; falls back per OpenRouter */
export const OPENROUTER_CHAT_EXTRA_BODY = {
  provider: {
    order: ['fireworks'],
    allow_fallbacks: true,
  },
} as const;

/** OpenAI Audio API — speech-to-text */
export const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
