import { FEATURE_IDS, type FeatureId } from '@/convex/features/featureIds';

/**
 * Maps each feature ID to its i18n key prefix under the "Features" namespace,
 * and whether the feature is consumable (resets periodically) or not.
 *
 * consumable = true  → resets monthly (chat messages, sentences, custom sentences)
 * consumable = false → permanent cap (courses)
 * consumable = undefined → boolean flag, not metered (multiple languages)
 *
 * displayCount → override for boolean features where included_usage is 0
 *                but the actual limit is a known constant (e.g. 5 languages).
 *
 * hidden = true → internal-only feature, excluded from pricing tables and
 *                 upgrade flows. Limit-reached UI shows a "contact us" dialog
 *                 instead of a paywall.
 */
export const FEATURE_META: Record<
  FeatureId,
  { i18nKey: string; consumable?: boolean; displayCount?: number; hidden?: boolean }
> = {
  [FEATURE_IDS.CHAT_MESSAGES]: { i18nKey: 'chatMessages', consumable: true },
  [FEATURE_IDS.COURSES]: { i18nKey: 'courses', consumable: false },
  [FEATURE_IDS.SENTENCES]: { i18nKey: 'sentences', consumable: true },
  [FEATURE_IDS.CUSTOM_SENTENCES]: { i18nKey: 'customSentences', consumable: true },
  [FEATURE_IDS.MULTIPLE_LANGUAGES]: { i18nKey: 'multipleLanguages', displayCount: 5 },
  [FEATURE_IDS.TRANSCRIPTIONS]: { i18nKey: 'transcriptions', consumable: true, hidden: true },
};

export function getFeatureI18nKey(featureId: string): string {
  return FEATURE_META[featureId as FeatureId]?.i18nKey ?? featureId;
}

export function isFeatureConsumable(featureId: string): boolean | undefined {
  return FEATURE_META[featureId as FeatureId]?.consumable;
}

export function getFeatureDisplayCount(featureId: string): number | undefined {
  return FEATURE_META[featureId as FeatureId]?.displayCount;
}

export function isFeatureHidden(featureId: string): boolean {
  return FEATURE_META[featureId as FeatureId]?.hidden === true;
}
