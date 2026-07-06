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
  azureTts: {
    kind: 'token bucket',
    rate: 200,
    period: MINUTE,
    capacity: 200,
    shards: 10,
  },
  // Gemini 3.1 Flash TTS via OpenRouter (/audio/speech). Capped BELOW the
  // azureStt budget (200/min), not at OpenRouter's ceiling: every gemini
  // synthesis is STT-validated, so gemini demand converts 1:1 (2:1 on a
  // validation retry) into azureStt demand, and that bucket is shared with
  // google/azure validation, word-timing backfill, and chat voice. 180
  // leaves headroom for those. If more gemini throughput is ever needed,
  // raise azureStt first — Microsoft's documented Fast Transcription cap on
  // S0 is 600 req/min per resource (learn.microsoft.com Speech quotas,
  // 2026-06), so the current 200 is a self-imposed third of the real limit.
  geminiTts: {
    kind: 'token bucket',
    rate: 180,
    period: MINUTE,
    capacity: 180,
    shards: 32,
  },
  // Azure Speech-to-Text Fast Transcription S0 tier. Hit by TTS validation
  // (synthesizeAndValidate), word-timing backfill, and chat voice
  // transcription. Microsoft's documented S0 cap is 600 req/min per resource
  // (adjustable via support ticket); 200 keeps us at a third of that because
  // Azure autoscaling can 429 below the cap during sharp ramps.
  azureStt: {
    kind: 'token bucket',
    rate: 200,
    period: MINUTE,
    capacity: 200,
    shards: 10,
  },
});

// Partial because 'elevenlabs' lingers in `TtsProvider` only as a stored-value
// tombstone — it is never dispatched, so it needs no rate-limit bucket. The
// dispatch lookup falls back to 'googleTts' for any unmapped provider.
export const TTS_RATE_LIMIT_BY_PROVIDER: Partial<
  Record<TtsProvider, 'googleTts' | 'azureTts' | 'geminiTts'>
> = {
  google: 'googleTts',
  azure: 'azureTts',
  gemini: 'geminiTts',
};
