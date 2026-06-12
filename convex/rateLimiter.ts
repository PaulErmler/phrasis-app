import { RateLimiter, MINUTE } from '@convex-dev/rate-limiter';
import { components } from './_generated/api';
import type { TtsProvider } from './types';

// Token-bucket configured to behave like a 60s rolling budget: `capacity ==
// rate`, `period = 1 minute`, so a fresh limiter holds one minute's worth of
// tokens and refills continuously. Sharded with the power-of-two-choices
// trick to absorb concurrent `pumpQueue` mutations without OCC retries.
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // 25% headroom under Google's 200 req/min Text-to-Speech quota — lowered
  // from 190 after still seeing 429s. TTS retries (validation re-synthesis)
  // and clock drift between Convex and Google account for the gap.
  googleTts: {
    kind: 'token bucket',
    rate: 150,
    period: MINUTE,
    capacity: 150,
    shards: 8,
  },
  elevenlabsTts: {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 60,
    shards: 3,
  },
  azureTts: {
    kind: 'token bucket',
    rate: 200,
    period: MINUTE,
    capacity: 200,
    shards: 10,
  },
  // Gemini 3.1 Flash TTS via OpenRouter (/audio/speech). Conservative starting
  // budget — OpenRouter per-key limits vary by credit balance; raise once we've
  // observed real throughput without 429s.
  geminiTts: {
    kind: 'token bucket',
    rate: 240,
    period: MINUTE,
    capacity: 240,
    shards: 32,
  },
  // Azure Speech-to-Text Fast Transcription S0 tier — same 200 req/min cap as
  // azureTts. Hit by TTS validation (synthesizeAndValidate), word-timing
  // backfill, and chat voice transcription. If 429s persist after this lands,
  // consider dropping rate to ~180 — clock drift + parallel retries can push
  // instantaneous load over the cap, same reasoning as googleTts → 150.
  azureStt: {
    kind: 'token bucket',
    rate: 200,
    period: MINUTE,
    capacity: 200,
    shards: 10,
  },
});

export const TTS_RATE_LIMIT_BY_PROVIDER: Record<
  TtsProvider,
  'googleTts' | 'elevenlabsTts' | 'azureTts' | 'geminiTts'
> = {
  google: 'googleTts',
  elevenlabs: 'elevenlabsTts',
  azure: 'azureTts',
  gemini: 'geminiTts',
};
