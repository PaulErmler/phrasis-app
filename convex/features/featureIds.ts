/**
 * Single source of truth for feature IDs used in quota checks and Autumn config.
 * Keep in sync with autumn.config.ts feature definitions.
 */
export const FEATURE_IDS = {
  CHAT_MESSAGES: 'chat_messages',
  COURSES: 'courses',
  SENTENCES: 'sentences',
  CUSTOM_SENTENCES: 'custom_sentences',
} as const;

export type FeatureId = (typeof FEATURE_IDS)[keyof typeof FEATURE_IDS];
