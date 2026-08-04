import { RateLimiter, HOUR, MINUTE, SECOND } from '@convex-dev/rate-limiter';
import { components } from './_generated/api';
import type { TtsProvider } from './types';

// Token-bucket configured to behave like a 60s rolling budget: `capacity ==
// rate`, `period = 1 minute`, so a fresh limiter holds one minute's worth of
// tokens and refills continuously. Sharded with the power-of-two-choices
// trick to absorb concurrent enqueue mutations without OCC retries.
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
  // Gemini 3.1 Flash TTS via OpenRouter (/audio/speech). Capped BELOW the
  // azureStt budget (100 per 10s ≈ 600/min), not at OpenRouter's ceiling:
  // every gemini synthesis is STT-validated, so gemini demand converts 1:1
  // (2:1 on a validation retry) into azureStt demand, and that bucket is
  // shared with google validation, word-timing backfill, and chat voice.
  // 180 leaves headroom for those.
  geminiTts: {
    kind: 'token bucket',
    rate: 180,
    period: MINUTE,
    capacity: 180,
    shards: 32,
  },
  // Azure Speech-to-Text Fast Transcription S0 tier. Hit by TTS validation
  // (synthesizeAndValidate), word-timing backfill, and chat voice
  // transcription. 100 per 10s matches Microsoft's documented S0 cap of
  // 600 req/min per resource (adjustable via support ticket); the short
  // period keeps bursts smooth so Azure autoscaling doesn't 429 during
  // sharp ramps.
  azureStt: {
    kind: 'token bucket',
    rate: 100,
    period: 10 * SECOND,
    capacity: 100,
    shards: 10,
  },
  // Account-deletion requests send a real email to support@ (see
  // features/accountDeletion.ts). Keyed per user — the cap exists so a
  // scripted loop can't flood the inbox or burn Resend quota, while a human
  // double-checking their request still gets through.
  accountDeletionRequest: {
    kind: 'token bucket',
    rate: 2,
    period: HOUR,
    capacity: 2,
  },
  // Better Auth transactional email (verification + password reset, see
  // convex/auth.ts). Both are triggered by unauthenticated endpoints that
  // send real mail, and with requireEmailVerification every unverified
  // sign-in attempt re-sends the verification email — so this cap is
  // load-bearing, not defensive. Keyed per lowercased recipient address;
  // when the bucket is empty the callbacks silently skip sending (never
  // throw — a 500 there would leak whether the account exists).
  authEmail: {
    kind: 'token bucket',
    rate: 5,
    period: HOUR,
    capacity: 5,
  },
  // Global (unkeyed) backstop over the same sends: the per-address bucket
  // above doesn't bound aggregate volume, so scripted signups across many
  // distinct addresses could otherwise burn Resend quota and sender
  // reputation without limit. Sized far above legitimate traffic.
  authEmailGlobal: {
    kind: 'token bucket',
    rate: 100,
    period: HOUR,
    capacity: 50,
  },
  // Global cap on notification emails to the support inbox
  // (lib/adminEmails.ts): every signup fires one with no auth in front of
  // it, so mass signups would otherwise flood the inbox 1:1.
  adminEmail: {
    kind: 'token bucket',
    rate: 20,
    period: HOUR,
    capacity: 20,
  },
});

// Partial because 'azure' and 'elevenlabs' linger in `TtsProvider` only as
// stored-value tombstones — they are never dispatched, so they need no
// rate-limit bucket (Azure Speech keeps its separate `azureStt` bucket). The
// dispatch lookup falls back to 'googleTts' for any unmapped provider.
export const TTS_RATE_LIMIT_BY_PROVIDER: Partial<
  Record<TtsProvider, 'googleTts' | 'geminiTts'>
> = {
  google: 'googleTts',
  gemini: 'geminiTts',
};
