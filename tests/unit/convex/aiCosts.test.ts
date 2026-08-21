import { describe, expect, it } from 'vitest';

import {
  AI_COST_RATES,
  costForAudioMs,
  costForCharacters,
} from '@/convex/config/aiCosts';

describe('aiCosts', () => {
  describe('costForCharacters', () => {
    it('prices a million characters at exactly the published rate', () => {
      expect(costForCharacters('googleTts', 1_000_000)).toBe(
        AI_COST_RATES.googleTts.usdPerUnit,
      );
      expect(costForCharacters('googleTranslate', 1_000_000)).toBe(
        AI_COST_RATES.googleTranslate.usdPerUnit,
      );
    });

    it('scales linearly below a million characters', () => {
      // A typical sentence. The realistic unit of work in this app.
      expect(costForCharacters('googleTts', 100)).toBeCloseTo(
        (100 / 1_000_000) * AI_COST_RATES.googleTts.usdPerUnit,
        12,
      );
    });

    it('returns zero rather than NaN for degenerate inputs', () => {
      expect(costForCharacters('googleTts', 0)).toBe(0);
      expect(costForCharacters('googleTts', -5)).toBe(0);
      expect(costForCharacters('googleTts', Number.NaN)).toBe(0);
    });
  });

  describe('costForAudioMs', () => {
    it('prices one hour of audio at exactly the published rate', () => {
      expect(costForAudioMs('azureStt', 3_600_000)).toBe(
        AI_COST_RATES.azureStt.usdPerUnit,
      );
    });

    it('scales linearly for a short clip', () => {
      // ~3s is the length of a synthesized sentence, which is what the TTS
      // validation pass round-trips through Azure for every single clip.
      expect(costForAudioMs('azureStt', 3_000)).toBeCloseTo(
        (3_000 / 3_600_000) * AI_COST_RATES.azureStt.usdPerUnit,
        12,
      );
    });

    it('returns zero rather than NaN for degenerate inputs', () => {
      expect(costForAudioMs('azureStt', 0)).toBe(0);
      expect(costForAudioMs('azureStt', -1)).toBe(0);
      expect(costForAudioMs('azureStt', Number.NaN)).toBe(0);
    });
  });

  it('records provenance for every rate so they can be re-verified', () => {
    for (const [name, rate] of Object.entries(AI_COST_RATES)) {
      expect(rate.usdPerUnit, name).toBeGreaterThan(0);
      expect(rate.sourceUrl, name).toMatch(/^https:\/\//);
      expect(rate.lastVerified, name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
