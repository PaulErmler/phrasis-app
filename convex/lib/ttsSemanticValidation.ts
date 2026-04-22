/**
 * Gemini-backed lenient validator for TTS transcriptions.
 *
 * Strict `textsMatch` (Levenshtein ≤1) rejects cosmetically-different
 * transcriptions that are actually correct audio — names spelled phonetically
 * by Scribe, digits spoken as words, and the like. This validator asks a
 * small Gemini model whether the transcription is semantically equivalent to
 * the original, so those cases pass.
 */

import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_MODELS } from '../config/aiModels';

export type SemanticMatchResult = 'match' | 'mismatch' | 'error';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SYSTEM_PROMPT = `You validate TTS audio by comparing the original text to a transcription produced by an automatic speech-to-text model.

Decide whether the transcription is faithful to the original. Respond "match" when they are the same sentence, even if the transcription differs in cosmetic ways:

- Names spelled phonetically (e.g., "Paul" vs "Pol", "Siobhán" vs "Shuh-vawn")
- Numbers written as digits vs words (e.g., "5" vs "five", "2024" vs "twenty twenty-four", "1st" vs "first")
- Abbreviations vs full forms (e.g., "Mr." vs "mister", "Dr." vs "doctor", "km" vs "kilometres")
- Punctuation, capitalization, or whitespace differences
- Minor diacritic, accent, or script-variant differences (e.g., "café" vs "cafe")
- A single character off — one Latin letter inserted, dropped, or swapped, OR a single CJK/Chinese character differing from the original. One-character differences are almost always Scribe noise, not a genuinely wrong word.
- For Chinese / Japanese / Korean text: homophone swaps where the transcribed character has the same pronunciation as the original (e.g., Mandarin 在 vs 再, 做 vs 作, 他 vs 她 vs 它). Scribe transcribes by sound, so same-sound-different-character is almost always a transcription artifact, not a reading error.

Respond "mismatch" when the words actually differ in meaning — missing words, added words, or substituted words/characters that change what was said. For CJK specifically: two or more differing characters in a row, or a substitution that is NOT a homophone, is a mismatch.

Output ONLY a single JSON object and nothing else, in exactly this shape:
{"verdict":"match"}
or
{"verdict":"mismatch"}

No prose. No markdown. No code fences.`;

/**
 * Ask Gemini whether the transcription matches the original semantically.
 * Returns `'error'` on any network/parse failure so callers can fall back
 * to a stricter comparison rather than counting the failure as a verdict.
 */
export async function textsMatchSemantic(
  original: string,
  transcribed: string,
  language: string,
): Promise<SemanticMatchResult> {
  try {
    const { text } = await generateText({
      model: openrouter(OPENROUTER_MODELS.ttsValidation),
      system: SYSTEM_PROMPT,
      prompt: `Language: ${language}\nOriginal: ${original}\nTranscribed: ${transcribed}`,
    });

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    const parsed: unknown = JSON.parse(cleaned);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'verdict' in parsed &&
      (parsed as { verdict: unknown }).verdict === 'match'
    ) {
      return 'match';
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      'verdict' in parsed &&
      (parsed as { verdict: unknown }).verdict === 'mismatch'
    ) {
      return 'mismatch';
    }
    return 'error';
  } catch (err) {
    console.warn('[textsMatchSemantic] Gemini validator failed:', err);
    return 'error';
  }
}
