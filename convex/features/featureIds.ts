/**
 * Single source of truth for feature IDs used in quota checks and Autumn config.
 * Keep in sync with autumn.config.ts feature definitions.
 */
export const FEATURE_IDS = {
  CHAT_MESSAGES: 'chat_messages',
  COURSES: 'courses',
  SENTENCES: 'sentences',
  CUSTOM_SENTENCES: 'custom_sentences',
  MULTIPLE_LANGUAGES: 'multiple_languages',
  TRANSCRIPTIONS: 'transcriptions',
  CARD_EDITS: 'card_edits',
  TRANSLATION_AUTO_FILL: 'translation_auto_fill',
  AUDIO_REGENERATIONS: 'audio_regenerations',
  TRANSLATION_FLAGS: 'translation_flags',
  CREDITS: 'credits',
} as const;

export type FeatureId = (typeof FEATURE_IDS)[keyof typeof FEATURE_IDS];

/**
 * Credit cost per unit of each credit-consuming feature. Must mirror the
 * `creditSchema` of the `credits` feature in autumn.config.ts: quota checks
 * and local balance updates convert feature amounts into credits with these
 * costs, while Autumn tracking still receives the underlying feature id.
 *
 * Users on legacy (pre-credits) plan versions have per-feature balances and
 * no `credits` balance; gating falls back to the per-feature path for them.
 */
export const CREDIT_COSTS: Partial<Record<FeatureId, number>> = {
  [FEATURE_IDS.CHAT_MESSAGES]: 1,
  [FEATURE_IDS.CUSTOM_SENTENCES]: 1,
  [FEATURE_IDS.TRANSLATION_AUTO_FILL]: 1,
};

/**
 * Chat billing step: 1 credit per started USD 0.005 of LLM cost. One credit
 * is consumed before generation; the remainder is charged after the
 * response based on actual OpenRouter cost.
 */
export const CHAT_CREDIT_USD_STEP = 0.005;
