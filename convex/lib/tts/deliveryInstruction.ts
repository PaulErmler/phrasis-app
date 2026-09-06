/**
 * The delivery instruction every Gemini TTS request carries, templated on the
 * language name Gemini should lock pronunciation to. Prompt "F" from the
 * 2026-09-04 listening test (.scratch/tts-intonation): the earlier instruction
 * plus an explicit no-performing clause, after a user found the delivery
 * "over-the-top and uncanny". Calmer variants that also asked for a relaxed
 * pace came out too quiet; this one leaves volume and pace alone. Wording kept
 * exactly as tested (including "an everyday conversations").
 *
 * Own module with no imports so `scripts/generate-landing-audio.mts` can
 * share it: the landing demo clips must sound like the in-app audio. Changing
 * this text does not regenerate stored app audio without a `ttsVersion` bump
 * (lib/languages.ts); the landing script hashes it into its filenames and
 * regenerates on its own.
 */
export function ttsDeliveryInstruction(languageName: string): string {
  return `Speak the following text in a natural way like a native ${languageName} speaker would in a way that fits the sentence in an everyday conversations. Do not act it out or perform it. No dramatic emphasis, no exaggerated emotion, no presenter or audiobook voice.`;
}
