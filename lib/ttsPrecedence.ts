/**
 * Declarative rules for when a language's NEW active TTS provider should
 * overwrite existing audio rows produced by an OLD provider.
 *
 * For each provider key, the value is the list of other providers whose
 * existing `audioRecordings` rows should be deleted + re-synthesized when
 * the language is switched to this provider. Providers not listed are kept
 * as-is (existing audio still plays; no regen).
 *
 * Read by `scheduleMissingContent` in convex/features/decks.ts. Legacy rows
 * with no `ttsProvider` field are treated as 'google' there before this
 * function sees them.
 */
import type { TtsProvider } from './languages';

export const TTS_PROVIDER_OVERRIDES: Record<TtsProvider, readonly TtsProvider[]> = {
  google: ['azure'],
  elevenlabs: [],
  azure: ['elevenlabs'],
  // Gemini is the top provider for every language routed to it (a growing set —
  // English/Spanish/Arabic variants, pt_pt, de, sv, fil, fa, …): a switch to
  // Gemini deletes + re-synthesizes any prior audio from every other provider.
  // Nothing lists 'gemini' as overridable, so Gemini audio is never clobbered by
  // google/azure/elevenlabs.
  gemini: ['google', 'azure', 'elevenlabs'],
};

export function shouldOverwriteProvider(
  current: TtsProvider,
  existing: TtsProvider,
): boolean {
  if (current === existing) return false;
  return TTS_PROVIDER_OVERRIDES[current].includes(existing);
}
