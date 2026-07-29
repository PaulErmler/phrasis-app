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
import { OPENROUTER_MODELS, OPENROUTER_USAGE_ACCOUNTING } from '../config/aiModels';
import { openrouterCostUsd, openrouterGenerationId } from './posthogAi';

export type SemanticMatchResult = 'match' | 'mismatch' | 'error';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  extraBody: OPENROUTER_USAGE_ACCOUNTING,
});

/**
 * What one validator call cost. Reported through a caller-supplied sink rather
 * than the return value so the `SemanticMatchResult` contract — and the tests
 * that mock this function against it — stay unchanged.
 */
export type SemanticValidationTelemetry = {
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  generationId?: string;
};

const SYSTEM_PROMPT = `You validate TTS audio by comparing the original text to a transcription produced by an automatic speech-to-text model (Scribe). Scribe transcribes by sound, so cosmetic differences that reflect pronunciation rather than meaning should pass.

Respond "match" when the transcription is the same sentence, even if it differs in any of these ways:

GENERAL (any script):
- Names spelled phonetically (e.g., "Paul" vs "Pol", "Siobhán" vs "Shuh-vawn")
- Numbers as digits or words (e.g., "5" vs "five", "2024" vs "twenty twenty-four", "1st" vs "first")
- Abbreviations vs full forms (e.g., "Mr." vs "mister", "Dr." vs "doctor", "km" vs "kilometres")
- Punctuation, capitalization, whitespace, or quote-style differences
- One Latin letter inserted, dropped, or swapped — almost always Scribe noise

CJK (Chinese / Japanese / Korean):
- Homophone character swaps where the transcribed character has the same pronunciation as the original (e.g., Mandarin 在 vs 再, 做 vs 作, 他 vs 她 vs 它). Same sound, different character = transcription artifact, not a reading error.
- A single CJK character inserted, dropped, or swapped.
- Two or more differing characters in a row, OR a non-homophone substitution, IS a mismatch.

INDIC (Bengali, Hindi, Marathi, Tamil, Telugu, Gujarati, Punjabi, Kannada, Malayalam, Sinhala, Nepali, Odia):
- Matra (vowel-sign) drift on a single syllable (e.g., খুলেই vs খুলে, किताब vs कितब).
- Schwa drop or insertion at the end of a word.
- Single-character anusvara / chandrabindu / visarga drift.
- ZWJ / ZWNJ presence or absence (invisible joining marks).
- Conjunct simplification on a single cluster (e.g., विद्यालय vs विदयालय).
- Two or more differing aksharas (syllable units) in a row IS a mismatch.

ARABIC / HEBREW / PERSIAN / URDU:
- Missing or added short-vowel diacritics (haraka / niqqud) — almost never written or transcribed and do not change words.
- Hamza, tashkeel, shadda, sukun differences.
- A single similar-sound consonant swap (e.g., س vs ص, ت vs ط, د vs ض) — Scribe routinely confuses these.
- Final-form vs medial-form letter variants.
- Two or more changed letters in a row IS a mismatch.

THAI / LAO / KHMER / BURMESE:
- Word-boundary or spacing differences (these scripts have no inter-word spaces and Scribe segments words differently than humans).
- Single-character tone-mark drift.
- Two or more differing characters in the same syllable IS a mismatch.

Respond "mismatch" when words actually differ in meaning — missing words, added words, or substitutions that change what was said.

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
  onTelemetry?: (telemetry: SemanticValidationTelemetry) => void,
): Promise<SemanticMatchResult> {
  const startedAt = Date.now();
  try {
    const { text, usage, providerMetadata } = await generateText({
      model: openrouter(OPENROUTER_MODELS.ttsValidation),
      system: SYSTEM_PROMPT,
      prompt: `Language: ${language}\nOriginal: ${original}\nTranscribed: ${transcribed}`,
    });

    onTelemetry?.({
      latencyMs: Date.now() - startedAt,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd: openrouterCostUsd(providerMetadata),
      generationId: openrouterGenerationId(providerMetadata),
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
