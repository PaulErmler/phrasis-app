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

// 'azure' and 'elevenlabs' are retired (tombstones in TtsProvider); their rows
// only appear as EXISTING audio, never as the current provider. Their entries
// stay because this Record is keyed by the full TtsProvider union, and 'azure'
// must stay in gemini's list so legacy Azure audio regenerates on Gemini.
export const TTS_PROVIDER_OVERRIDES: Record<TtsProvider, readonly TtsProvider[]> = {
  google: ['azure'],
  elevenlabs: [],
  azure: ['elevenlabs'],
  // Gemini is the top provider for every language routed to it: a switch to
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
