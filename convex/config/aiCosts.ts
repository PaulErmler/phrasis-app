/**
 * Published list prices for the providers PostHog cannot price on its own.
 *
 * PostHog computes `$ai_total_cost_usd` automatically for LLM calls by matching
 * model + provider against OpenRouter's pricing table — which is exactly the
 * provider we bill against, so every OpenRouter path needs nothing here. The
 * providers below (speech synthesis, transcription, machine translation) have
 * no entry in that table, so we compute the cost ourselves and send it.
 *
 * ⚠️ These are list prices transcribed by hand, not values read from an invoice.
 * They should be reconciled against real billing before anyone makes a pricing
 * decision on top of them. Volume discounts, free tiers, and regional pricing
 * are all deliberately ignored — the goal is per-feature relative cost and a
 * defensible order of magnitude, not accounting.
 */

export type AiCostRate = {
  /** USD per `unit`. */
  readonly usdPerUnit: number;
  readonly unit: 'million_characters' | 'audio_hour';
  readonly sourceUrl: string;
  /** ISO date the rate was last checked against the provider's public pricing page. */
  readonly lastVerified: string;
};

export const AI_COST_RATES = {
  /** Chirp 3: HD voices. Billed per character of input text. */
  googleTts: {
    usdPerUnit: 30,
    unit: 'million_characters',
    sourceUrl: 'https://cloud.google.com/text-to-speech/pricing',
    lastVerified: '2026-07-28',
  },
  /** Cloud Translation v2, billed per character of source text. */
  googleTranslate: {
    usdPerUnit: 20,
    unit: 'million_characters',
    sourceUrl: 'https://cloud.google.com/translate/pricing',
    lastVerified: '2026-07-28',
  },
  /** Azure Speech — Fast Transcription, billed per hour of audio. */
  azureStt: {
    usdPerUnit: 0.36,
    unit: 'audio_hour',
    sourceUrl: 'https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/',
    lastVerified: '2026-07-28',
  },
} as const satisfies Record<string, AiCostRate>;

export type AiCostProvider = keyof typeof AI_COST_RATES;

/** Cost of synthesizing / translating `characterCount` characters. */
export function costForCharacters(
  provider: 'googleTts' | 'googleTranslate',
  characterCount: number,
): number {
  if (!Number.isFinite(characterCount) || characterCount <= 0) return 0;
  return (characterCount / 1_000_000) * AI_COST_RATES[provider].usdPerUnit;
}

/** Cost of transcribing `durationMs` of audio. */
export function costForAudioMs(provider: 'azureStt', durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return (durationMs / 3_600_000) * AI_COST_RATES[provider].usdPerUnit;
}
