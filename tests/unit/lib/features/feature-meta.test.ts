import { describe, it, expect } from 'vitest';
import {
  FEATURE_META,
  getFeatureI18nKey,
  isFeatureConsumable,
  getFeatureDisplayCount,
  isFeatureDisplayedAsUnlimited,
  isFeatureHidden,
  getFeaturePaywallKey,
} from '@/lib/features/feature-meta';
import {
  FEATURE_IDS,
  isCreditBackedFeature,
} from '@/convex/features/featureIds';

describe('feature-meta helpers', () => {
  it('exposes metadata for every FEATURE_IDS entry', () => {
    for (const id of Object.values(FEATURE_IDS)) {
      expect(FEATURE_META[id as keyof typeof FEATURE_META]).toBeDefined();
    }
  });

  it('getFeatureI18nKey returns mapped key or falls back to id', () => {
    expect(getFeatureI18nKey(FEATURE_IDS.CHAT_MESSAGES)).toBe('chatMessages');
    expect(getFeatureI18nKey('unknown-feature')).toBe('unknown-feature');
  });

  it('isFeatureConsumable reports the configured flag', () => {
    expect(isFeatureConsumable(FEATURE_IDS.CHAT_MESSAGES)).toBe(true);
    expect(isFeatureConsumable(FEATURE_IDS.COURSES)).toBe(false);
    expect(isFeatureConsumable(FEATURE_IDS.MULTIPLE_LANGUAGES)).toBeUndefined();
  });

  it('getFeatureDisplayCount returns the override when present', () => {
    expect(getFeatureDisplayCount(FEATURE_IDS.MULTIPLE_LANGUAGES)).toBe(3);
    expect(getFeatureDisplayCount(FEATURE_IDS.CHAT_MESSAGES)).toBeUndefined();
  });

  it('isFeatureDisplayedAsUnlimited matches config', () => {
    expect(isFeatureDisplayedAsUnlimited(FEATURE_IDS.SENTENCES)).toBe(true);
    expect(isFeatureDisplayedAsUnlimited(FEATURE_IDS.CHAT_MESSAGES)).toBe(
      false,
    );
    expect(isFeatureDisplayedAsUnlimited('bogus')).toBe(false);
  });

  it('isFeatureHidden flags internal features', () => {
    expect(isFeatureHidden(FEATURE_IDS.TRANSCRIPTIONS)).toBe(true);
    expect(isFeatureHidden(FEATURE_IDS.COURSES)).toBe(false);
  });

  it('getFeaturePaywallKey returns override when present', () => {
    expect(getFeaturePaywallKey(FEATURE_IDS.COURSES)).toBe(
      'courseCapWithArchiveOption',
    );
    expect(getFeaturePaywallKey(FEATURE_IDS.CHAT_MESSAGES)).toBeUndefined();
  });

  it('isCreditBackedFeature matches CREDIT_COSTS entries', () => {
    expect(isCreditBackedFeature(FEATURE_IDS.CHAT_MESSAGES)).toBe(true);
    expect(isCreditBackedFeature(FEATURE_IDS.CUSTOM_SENTENCES)).toBe(true);
    expect(isCreditBackedFeature(FEATURE_IDS.TRANSLATION_AUTO_FILL)).toBe(true);
    expect(isCreditBackedFeature(FEATURE_IDS.COURSES)).toBe(false);
    expect(isCreditBackedFeature(FEATURE_IDS.TRANSCRIPTIONS)).toBe(false);
    expect(isCreditBackedFeature('bogus')).toBe(false);
  });
});
